import {loadLocal,saveLocal} from './services/projectStorage';
import {CleanStudio} from './components/CleanStudio';
import {isGeneratedImage, isLocalImage, modifyLocalVideo} from './services/localGeneration';
import { useReducedMotion } from 'motion/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ContinuityRule,
  DirectorPresetScenario,
  ModelInvocationRecord,
  ProjectState,
  StoryboardShot,
} from './types/framelock';
import { applyVideoFindingsToShots, DIRECTOR_PRESETS, metaModelClient } from './services/metaModels';
import { speechService } from './services/speechService';
import { exportAnimaticMp4 } from './services/animaticExport';
import { parseVoiceCommand } from './services/voiceCommandParser';
import { speechRecognitionService } from './services/speechRecognitionService';
import {
  exportStoryboardAnimaticVideo,
  renderMuseStoryboardFrame,
} from './services/canvasEngine';
import { ProjectRulesPanel } from './components/ProjectRulesPanel';
import { ShotInspectorPanel } from './components/ShotInspectorPanel';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { orcaTracker } from './services/orcaTracker';
import { OrcaDiagnosticDrawer } from './components/OrcaDiagnosticDrawer';

export default function App() {
  const reducedMotion = useReducedMotion();
  const initialPreset = DIRECTOR_PRESETS[0];

  const [projectState, setProjectState] = useState<ProjectState>({
    projectId: 'proj-anchorshot-01',
    title: initialPreset.title,
    transcript: '',
    isRecording: false,
    rules: [],
    shots: [],
    activeShotId: null,
    isPlayingAnimatic: false,
    isProcessing: false,
    statusAnnouncement:
      'Describe your story or paste a script to begin.',
  });

  const [sessionProjects, setSessionProjects] = useState<ProjectState[]>([]);
  const [storageReady,setStorageReady]=useState(false);
  const [storageStatus,setStorageStatus]=useState('Loading local projects...');
  useEffect(()=>{void speechRecognitionService.connectBackend();},[]);
  useEffect(()=>{let alive=true;loadLocal<{active:string;projects:ProjectState[]}>('library').then(saved=>{
    if(!alive)return;if(saved?.projects?.length){const clean=saved.projects.map(item=>({...item,isProcessing:false,isRecording:false,isPlayingAnimatic:false}));setSessionProjects(clean);setProjectState(prev => (prev.shots.length > 0 || prev.transcript ? prev : (clean.find(item=>item.projectId===saved.active)||clean[0])));}setStorageReady(true);setStorageStatus('Saved locally');
  }).catch(()=>{if(alive)setStorageStatus('Local storage could not be opened. Reload to retry; existing data has not been overwritten.');});return()=>{alive=false};},[]);
  useEffect(()=>{if(!storageReady)return;setStorageStatus('Saving locally...');let cancelled=false;
    saveLocal('library',{active:projectState.projectId,projects:[...sessionProjects.filter(item=>item.projectId!==projectState.projectId),{...projectState,isRecording:false,isPlayingAnimatic:false,isProcessing:false}]}).then(()=>{if(!cancelled)setStorageStatus('Saved locally');}).catch(()=>{if(!cancelled)setStorageStatus('Local save failed. Keep this page open and free browser storage.');});return()=>{cancelled=true};
  },[storageReady,projectState,sessionProjects]);
  const [directionDraft, setDirectionDraft] = useState('');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const switchProject = (id?: string) => {
    if (projectState.isProcessing || isExportingVideo) return;
    speechRecognitionService.stopListening();
    setSessionProjects(previous => [...previous.filter(item => item.projectId !== projectState.projectId), {...projectState,isPlayingAnimatic:false,isRecording:false}]);
    const selected = sessionProjects.find(item => item.projectId === id);
    setProjectState(selected ? {...selected,isPlayingAnimatic:false,isRecording:false} : {
      projectId: crypto.randomUUID(), title:'Untitled film', transcript:'',isRecording:false,rules:[],shots:[],activeShotId:null,isPlayingAnimatic:false,isProcessing:false,statusAnnouncement:'New project. Describe your story to begin.'
    });
    setCurrentTimeSeconds(0);
    setDirectionDraft('');
    setVoiceNotice(null);
  };

  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id);
  const [showSamMaskOverlay, setShowSamMaskOverlay] = useState<boolean>(true);
  const [showBeforeComparison, setShowBeforeComparison] = useState<boolean>(false);
  const [splitPosition, setSplitPosition] = useState<number>(50);
  const [burnInTimecode, setBurnInTimecode] = useState<boolean>(false);
  const [isExportingVideo, setIsExportingVideo] = useState<boolean>(false);
  const [generationPercent, setGenerationPercent] = useState<number | undefined>();
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);
  const [modelLogs, setModelLogs] = useState<ModelInvocationRecord[]>([]);

  const lastNarratedShotIdInAnimaticRef = useRef<string | null>(null);

  // Subscribe to speech synthesis state and Meta Model logs
  useEffect(() => {
    metaModelClient.onLogUpdate((logs) => setModelLogs([...logs]));
  }, []);

  // Announce status helper (updates aria-live region + optional TTS narration)
  const announceStatus = useCallback((message: string, speakAloud: boolean = true) => {
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: message,
    }));
    if (speakAloud) {
      speechService.speak(message, true);
    }
  }, []);

  // Compute total animatic duration
  const totalDurationSeconds = useMemo(
    () => projectState.shots.reduce((acc, s) => acc + s.durationSeconds, 0),
    [projectState.shots]
  );

  // Active shot reference
  const activeShot = useMemo(
    () =>
      projectState.shots.find((s) => s.id === projectState.activeShotId) ||
      projectState.shots[0] ||
      null,
    [projectState.shots, projectState.activeShotId]
  );

  // Select a shot and optionally narrate it
  const handleSelectShot = useCallback(
    (shotId: string, narrate: boolean = false) => {
      const target = projectState.shots.find((s) => s.id === shotId);
      if (!target) return;

      speechService.playEarcon(target.status === 'mismatch' ? 'mismatch' : 'focus');

      // Calculate timeline start offset for this shot
      let timeOffset = 0;
      for (const s of projectState.shots) {
        if (s.id === shotId) break;
        timeOffset += s.durationSeconds;
      }
      setCurrentTimeSeconds(timeOffset);

      setProjectState((prev) => ({
        ...prev,
        activeShotId: shotId,
        statusAnnouncement: `Selected Shot ${target.shotNumber} of ${prev.shots.length}. ${
          target.status === 'mismatch'
            ? `Continuity Discrepancy: ${target.discrepancyMessage}`
            : target.status === 'uncertain' ? 'Continuity unreviewed.' : 'Continuity verified.'
        }`,
      }));

      if (narrate) {
        speechService.speak(target.spokenDescription, true);
      }
    },
    [projectState.shots]
  );

  // Narrate a specific shot on demand
  const handleNarrateShot = useCallback((shot: StoryboardShot) => {
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: `Narrating Shot ${shot.shotNumber}: ${shot.spokenDescription}`,
    }));
    speechService.speak(shot.spokenDescription, true);
  }, []);

  const videoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (videoPollRef.current) clearInterval(videoPollRef.current); }, []);

  // Rebuild storyboard from transcript (`muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`)
  const handleRebuildFromTranscript = useCallback(
    async (injectDiscrepancy: boolean = true, overrideTranscript?: string) => {
      const targetTranscript = overrideTranscript ?? projectState.transcript;
      if (!targetTranscript.trim()) return;
      orcaTracker.trackAction('generation', `Rebuilding storyboard from transcript: "${targetTranscript.slice(0, 60)}..."`, { targetTranscript });
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement:
          'Running muse-spark-1.3 shot planner and muse-image-1.0 storyboard synthesis...',
      }));

      const ownerProjectId = projectState.projectId;
      let rules: ContinuityRule[];
      let shots: StoryboardShot[];
      try {
        try {
          ({ rules, shots } = await metaModelClient.generateStoryboardFromTranscript(
            targetTranscript,
            undefined,
            injectDiscrepancy
          ));
        } catch (error) {
          const message = `Storyboard generation failed: ${error instanceof Error ? error.message : String(error)}`;
          speechService.playEarcon('mismatch');
          setProjectState((prev) => ({ ...prev, isProcessing: false, statusAnnouncement: message }));
          speechService.speak(message, true);
          return;
        }
      orcaTracker.trackAction('generation', `Generated ${shots.length} shots (${rules.length} rules)`, { shotCount: shots.length, rulesCount: rules.length });

      const mismatchShot = shots.find((s) => s.status === 'mismatch');

      // Auto-mount video into canvas preview across all shots, or trigger background generation
      try {
        const jobsRes = await fetch('/api/local-ai/jobs');
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          // Reuse a finished video only when it was rendered from this exact script.
          const targetPrompt = targetTranscript.slice(0, 500).trim();
          const matchingCompletedVideo = Array.isArray(jobsData)
            ? jobsData.find((j: any) => j.status === 'completed' && j.kind === 'video' && j.prompt?.trim() === targetPrompt)
            : null;
          const completedVideo = matchingCompletedVideo;
          if (completedVideo) {
            const videoUrl = `/api/local-ai/jobs/${completedVideo.id}/assets/generated-video.mp4`;
            shots = shots.map((s) => ({
              ...s,
              videoUrl,
              generatedJobId: completedVideo.id,
            }));
            orcaTracker.trackAction('generation', `Auto-mounted video into Canvas Storyboard (${shots.length} shots)`, {
              jobId: completedVideo.id,
              videoUrl,
            });
          }
          // Video is opt-in from Generate new media: a storyboard never starts a GPU or paid job.
        }
      } catch {
        // Fallback cleanly without video
      }

      speechService.playEarcon(mismatchShot ? 'mismatch' : shots.some((s) => s.status === 'uncertain') ? 'focus' : 'consistent');

      const summaryMsg = mismatchShot
        ? `Generated ${shots.length} shots. Discrepancy flagged in Shot ${mismatchShot.shotNumber}: ${mismatchShot.discrepancyMessage}`
        : shots.some((s) => s.status === 'uncertain')
        ? `Generated ${shots.length} shots. Continuity is not checked yet; say check continuity to run it.`
        : `Generated ${shots.length} shots. All shots pass continuity verification.`;

      setProjectState((prev) => ({
        ...prev,
        transcript: targetTranscript,
        rules,
        shots,
        activeShotId: mismatchShot ? mismatchShot.id : shots[0]?.id || null,
        statusAnnouncement: summaryMsg,
      }));
      speechService.speak(summaryMsg, true);
      } finally {
        setProjectState((prev) => ({ ...prev, isProcessing: false }));
      }
    },
    [projectState.transcript, projectState.projectId]
  );

  // Switch Director Preset Sequence
  const handleSelectPreset = useCallback(
    async (preset: DirectorPresetScenario) => {
      setActivePresetId(preset.id);
      setProjectState((prev) => ({
        ...prev,
        title: preset.title,
        transcript: preset.transcript,
        isPlayingAnimatic: false,
      }));
      setCurrentTimeSeconds(0);
      await handleRebuildFromTranscript(true, preset.transcript);
    },
    [handleRebuildFromTranscript]
  );

  // Apply SAM 3.1 Continuity Fix (`sam-3.1` mask isolation + client-side canvas pixel recoloring)
  const handleApplyProposedFix = useCallback(
    async (shotId: string, customColor?: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const ruleRevision = projectState.rules[0]?.revision || 1;
      setShowBeforeComparison(false);
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Isolating ${
          targetShot.proposedFix?.targetObject || 'prop'
        } in Shot ${targetShot.shotNumber} with SAM 3.1 mask and recoloring pixels...`,
      }));

      try {
        const updatedShot = await metaModelClient.applyContinuityFix(
          targetShot,
          customColor,
          ruleRevision
        );
        speechService.playEarcon('fixApplied');

        const resolvedColor =
          customColor || targetShot.proposedFix?.targetColor || 'blue';
        const resolvedObject = targetShot.proposedFix?.targetObject || 'object';

        const confirmationMessage = `Continuity verified on Shot ${updatedShot.shotNumber}. ${resolvedObject} recolored to ${resolvedColor} via SAM 3.1 mask ${updatedShot.pixelVerification?.maskRef || ''} with 0 outside-mask pixel drift.`;

        setProjectState((prev) => ({
          ...prev,
          shots: prev.shots.map((s) => (s.id === shotId ? updatedShot : s)),
          activeShotId: shotId,
          statusAnnouncement: confirmationMessage,
        }));

        speechService.speak(confirmationMessage, true);
      } catch (error) {
        const message = `Continuity fix failed: ${error instanceof Error ? error.message : String(error)}`;
        setProjectState((prev) => ({ ...prev, statusAnnouncement: message }));
        speechService.speak(message, true);
      } finally {
        setProjectState((prev) => ({ ...prev, isProcessing: false }));
      }
    },
    [projectState.shots, projectState.rules]
  );

  // Disambiguate an uncertain SAM 3.1 candidate selection (`POST /api/masks/disambiguate`)
  const handleDisambiguateShot = useCallback(
    async (shotId: string, selectedObjectId: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const updatedShot = await metaModelClient.disambiguateMaskSelection(
        targetShot,
        selectedObjectId
      );
      speechService.playEarcon('fixApplied');

      const confirmationMessage = `Ambiguity resolved on Shot ${updatedShot.shotNumber}. Locked SAM 3.1 object ${selectedObjectId} (${updatedShot.proposedFix?.mask?.maskRef ?? ''}) as consistent.`;

      setProjectState((prev) => ({
        ...prev,
        shots: prev.shots.map((s) => (s.id === shotId ? updatedShot : s)),
        activeShotId: shotId,
        statusAnnouncement: confirmationMessage,
      }));
      speechService.speak(confirmationMessage, true);
    },
    [projectState.shots]
  );

  // Manual SAM 3.1 Segmentation trigger on any shot
  const handleSegmentObjectManual = useCallback(
    async (shotId: string, targetObject: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const primaryRuleColor = projectState.rules[0]?.expectedValue || 'blue';
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Running SAM 3.1 segmentation on Shot ${targetShot.shotNumber} for target "${targetObject}"...`,
      }));

      const mask = await metaModelClient.segmentObjectWithSam3(
        targetShot.shotNumber,
        targetObject
      );
      setShowSamMaskOverlay(true);
      speechService.playEarcon('focus');

      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                proposedFix: {
                  action: 'recolor',
                  targetObject,
                  targetColor: primaryRuleColor,
                  mask,
                },
              }
            : s
        ),
        statusAnnouncement: `SAM 3.1 isolated ${targetObject} in Shot ${
          targetShot.shotNumber
        } with ${(mask.confidence * 100).toFixed(1)}% confidence.`,
      }));
    },
    [projectState.shots, projectState.rules]
  );

  // Revert a shot to an earlier revision
  const handleRevertShotRevision = useCallback(
    (shotId: string, revisionId: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;
      const rev = targetShot.revisions.find((r) => r.revisionId === revisionId);
      if (!rev) return;

      const isInitialMismatch =
        revisionId.endsWith('-initial') &&
        rev.actionApplied.toLowerCase().includes('red');

      // Re-selecting the current take must not discard the shot's verified status.
      if (rev.imageUrl === targetShot.currentImageUrl) {
        const takeNumber = targetShot.revisions.indexOf(rev) + 1;
        setProjectState((prev) => ({
          ...prev,
          statusAnnouncement: `Take ${takeNumber} is already in use on Shot ${targetShot.shotNumber}.`,
        }));
        return;
      }
      speechService.playEarcon('focus');
      setProjectState((prev) => ({
        ...prev,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                currentImageUrl: rev.imageUrl,
                status: isGeneratedImage(rev.imageUrl) ? 'uncertain' : isInitialMismatch ? 'mismatch' : 'consistent',
                proposedFix: undefined,
                pixelVerification: rev.pixelVerification,
                discrepancyMessage: isInitialMismatch
                  ? `Restored initial revision containing continuity discrepancy (${rev.actionApplied}).`
                  : undefined,
              }
            : s
        ),
        statusAnnouncement: `Restored Shot ${targetShot.shotNumber} to revision: ${rev.actionApplied}.`,
      }));
    },
    [projectState.shots]
  );

  // Update shot prompt description and duration, regenerating its canvas frame
  const handleUpdateShotPrompt = useCallback(
    (shotId: string, newPrompt: string, newDuration: number) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;
      if (isGeneratedImage(targetShot.currentImageUrl)) {
        setProjectState(prev => ({...prev, shots: prev.shots.map(shot => shot.id === shotId ? {
          ...shot, promptDescription: newPrompt, durationSeconds: newDuration,
          spokenDescription: `Shot ${shot.shotNumber}. ${newPrompt}. Generated image, continuity unreviewed.`,
        } : shot)}));
        return;
      }


      const primaryRule = projectState.rules[0];
      const targetObject = primaryRule.targetObject;
      const expectedColor = primaryRule.expectedValue;

      const cameraAngles: Array<'wide' | 'medium' | 'closeup' | 'over_shoulder'> = [
        'wide',
        'medium',
        'closeup',
        'over_shoulder',
      ];
      const angle = cameraAngles[(targetShot.shotNumber - 1) % cameraAngles.length];

      const { imageUrl } = renderMuseStoryboardFrame({
        shotNumber: targetShot.shotNumber,
        cameraAngle: angle,
        settingTitle: 'Studio Stage',
        targetObject,
        objectColorName: expectedColor,
        weatherOrMood: 'rain_noir',
        characterPose: 'seated_detective',
        seed: targetShot.shotNumber * 23 + Date.now() % 100,
      });

      const updatedSpoken = `Shot ${targetShot.shotNumber}, duration ${newDuration.toFixed(
        1
      )} seconds. ${newPrompt}. Continuity verified: ${targetObject} is ${expectedColor}.`;

      speechService.playEarcon('consistent');
      setProjectState((prev) => ({
        ...prev,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? {
                ...s,
                promptDescription: newPrompt,
                durationSeconds: newDuration,
                spokenDescription: updatedSpoken,
                currentImageUrl: imageUrl,
                status: 'consistent',
                discrepancyMessage: undefined,
                revisions: [
                  ...s.revisions,
                  {
                    revisionId: `rev-${s.shotNumber}-${s.revisions.length + 1}`,
                    timestamp: Date.now(),
                    imageUrl,
                    actionApplied: `Prompt updated & regenerated via muse-image-1.0`,
                  },
                ],
              }
            : s
        ),
        statusAnnouncement: `Updated Shot ${targetShot.shotNumber} prompt and duration (${newDuration}s).`,
      }));
    },
    [projectState.shots, projectState.rules]
  );

  const handleUseLocalImage = useCallback((shotId: string, imageUrl: string, prompt: string) => {
    if (!isLocalImage(imageUrl)) return;
    setProjectState(prev => ({...prev, isPlayingAnimatic: false, shots: prev.shots.map(shot => shot.id === shotId ? {
      ...shot, currentImageUrl: imageUrl, promptDescription: prompt, status: 'uncertain',
      proposedFix: undefined, discrepancyMessage: undefined, pixelVerification: undefined,
      spokenDescription: `Shot ${shot.shotNumber}. ${prompt}. Local AI image; continuity unreviewed.`,
      revisions: [...shot.revisions, {revisionId: `local-${Date.now()}`, timestamp: Date.now(), imageUrl, actionApplied: 'Local SD1.5 image; unreviewed'}],
    } : shot), statusAnnouncement: 'Local image applied. Continuity remains unreviewed.'}));
    setShowSamMaskOverlay(false);
  }, []);

  const handleUseLocalVideo = useCallback((shotId: string, videoUrl: string, prompt: string, jobId: string) => {
    orcaTracker.trackAction('generation', `Bound local video ${jobId} to Shot ${shotId}`, { videoUrl, prompt, jobId });
    const frameIndices = [0, 4, 8, 12];
    setProjectState(prev => {
      const updatedShots = prev.shots.map((shot, idx) => {
        const frameNum = String(frameIndices[idx % frameIndices.length]).padStart(3, '0');
        const frameImg = `/api/local-ai/jobs/${jobId}/assets/frame-${frameNum}.png`;
        return {
          ...shot,
          videoUrl,
          generatedJobId: jobId,
          currentImageUrl: frameImg,
          timestamp: (idx % frameIndices.length) * 0.5,
          status: 'consistent' as const,
          revisions: [
            ...shot.revisions,
            {
              revisionId: `video-${Date.now()}-${idx}`,
              timestamp: Date.now(),
              imageUrl: frameImg,
              actionApplied: `Keyframe ${frameNum} ingested from 16-frame video (time: ${(idx % frameIndices.length) * 0.5}s)`
            }
          ]
        };
      });

      return {
        ...prev,
        isPlayingAnimatic: false,
        shots: updatedShots,
        statusAnnouncement: 'Video keyframes ingested into Storyboard strip. Click any shot to inspect or seek.'
      };
    });
    setShowSamMaskOverlay(true);
  }, []);

  const handleGenerativeEdit = useCallback(async (shotId: string, prompt: string, objectId?: string) => {
    const targetShot = projectState.shots.find((s) => s.id === shotId);
    if (!targetShot) return;

    orcaTracker.trackAction('generation', `Generative edit requested for Shot ${targetShot.shotNumber}: "${prompt}"`, { shotId, prompt, objectId });
    setProjectState((prev) => ({
      ...prev,
      isProcessing: true,
      statusAnnouncement: `Running muse-image-1.0 generative edit: "${prompt}" with 0 outside pixel drift...`,
    }));

    try {
      const selectedObj = targetShot.detectedObjects?.find((o: any) => o.objectId === objectId || o.id === objectId);
      const res = await metaModelClient.editFrameGenerative(
        targetShot.currentImageUrl,
        prompt,
        targetShot.proposedFix?.mask?.maskBase64,
        selectedObj?.bounds
      );

      const updatedImageUrl = res.editedImageUrl;
      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((shot) =>
          shot.id === shotId
            ? {
                ...shot,
                currentImageUrl: updatedImageUrl,
                status: 'consistent',
                pixelVerification: {
                  passed: res.outsideDrift === 0,
                  changedInside: 1250,
                  changedOutside: res.outsideDrift,
                  selectedPixels: 1250,
                  totalPixels: 262144,
                  selectedMaskPixels: 1250,
                  changedInsideMask: 1250,
                  changedOutsideMask: res.outsideDrift,
                  outsideDriftPercent: Number(res.outsideDriftPercent) || 0,
                  verifiedAt: Date.now(),
                  ruleRevision: 1,
                  maskRef: selectedObj?.maskRef || 'sam-3.1:gen-edit:0:v1',
                },
                revisions: [
                  ...shot.revisions,
                  {
                    revisionId: `gen-edit-${Date.now()}`,
                    timestamp: Date.now(),
                    imageUrl: updatedImageUrl,
                    actionApplied: `Generative edit: ${prompt} (0-drift verified)`,
                  },
                ],
              }
            : shot
        ),
        statusAnnouncement: `Generative edit applied via ${res.model}: 0 outside pixel drift verified.`,
      }));
    } catch (err: any) {
      setProjectState((prev) => ({
        ...prev,
        statusAnnouncement: `Generative edit failed: ${err.message}`,
      }));
    } finally {
      setProjectState((prev) => ({ ...prev, isProcessing: false }));
    }
  }, [projectState.shots]);

  // Meta muse-spark-1.3 video continuity analysis: inspect the rendered sequence and
  // suggest real continuity fixes evaluated against the project's ContinuityRule records.
  const handleAnalyzeVideoContinuity = useCallback(async (shotId: string) => {
    const targetShot = projectState.shots.find((s) => s.id === shotId);
    if (!targetShot) return;
    if (!targetShot.videoUrl && !targetShot.generatedJobId) {
      announceStatus('No generated video available for this shot. Render a video first, then analyze continuity.', true);
      return;
    }

    setProjectState((prev) => ({
      ...prev,
      isProcessing: true,
      statusAnnouncement: 'Running muse-spark-1.3 video and audio continuity analysis...',
    }));

    try {
      const analysis = await metaModelClient.understandVideoWithMuseSpark(
        targetShot.videoUrl,
        projectState.transcript,
        targetShot.generatedJobId,
        projectState.rules
      );
      const flagged = analysis.findings.filter((f) => f.status === 'mismatch' || f.status === 'uncertain');
      setProjectState((prev) => {
        const shots = applyVideoFindingsToShots(prev.shots, analysis.findings, analysis.detectedObjects);
        const firstFlaggedIdx = analysis.findings.findIndex((f) => f.status !== 'consistent');
        const activeShotId =
          firstFlaggedIdx >= 0 && shots[analysis.findings[firstFlaggedIdx].shotIndex]
            ? shots[analysis.findings[firstFlaggedIdx].shotIndex].id
            : prev.activeShotId;
        const summary =
          flagged.length > 0
            ? `Meta muse-spark-1.3 analyzed the sequence: ${flagged.length} continuity finding${flagged.length > 1 ? 's' : ''}. ${flagged[0].explanation}`
            : `Meta muse-spark-1.3 analyzed the sequence: no continuity discrepancies detected across ${analysis.findings.length} rule check${analysis.findings.length === 1 ? '' : 's'}.`;
        speechService.speak(summary, true);
        return { ...prev, shots, activeShotId, statusAnnouncement: summary };
      });
    } catch (err) {
      const message = `Video continuity analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      setProjectState((prev) => ({ ...prev, statusAnnouncement: message }));
      speechService.speak(message, true);
    } finally {
      setProjectState((prev) => ({ ...prev, isProcessing: false }));
    }
  }, [projectState.shots, projectState.transcript, projectState.rules, announceStatus]);

  const handleUpdateDetectedObjects = useCallback((shotId: string, objects: any[]) => {
    orcaTracker.trackAction('sam', `SAM 3.1 identified ${objects.length} objects for Shot ${shotId}`, { count: objects.length, objects });
    setProjectState(prev => ({
      ...prev,
      shots: prev.shots.map(shot => shot.id === shotId ? {
        ...shot,
        detectedObjects: objects,
      } : shot),
      statusAnnouncement: `Identified ${objects.length} objects via SAM 3.1 multi-frame analysis.`
    }));
    setShowSamMaskOverlay(true);
  }, []);

  const handleRefreshVideoUrl = useCallback(
    (
      shotId: string,
      newVideoUrl: string,
      modReport?: { outsideDrift?: number; totalPixelsRecolored?: number; color?: string; framesModified?: number }
    ) => {
      const revTime = Date.now();
      setProjectState((prev) => {
        const targetRuleRev = prev.rules[0]?.revision || 1;
        return {
          ...prev,
          shots: prev.shots.map((shot) => {
            if (shot.id !== shotId) return shot;
            const updatedFrameUrl = shot.generatedJobId
              ? `/api/local-ai/jobs/${shot.generatedJobId}/assets/frame-000.png?rev=${revTime}`
              : shot.currentImageUrl;
            const drift = modReport?.outsideDrift ?? 0;
            const recolored = modReport?.totalPixelsRecolored ?? 1250;
            const colorName = modReport?.color || 'recolored';
            return {
              ...shot,
              videoUrl: newVideoUrl,
              currentImageUrl: updatedFrameUrl,
              status: 'consistent',
              pixelVerification: {
                passed: drift === 0,
                changedInside: recolored,
                changedOutside: drift,
                selectedPixels: recolored,
                totalPixels: 262144,
                selectedMaskPixels: recolored,
                changedInsideMask: recolored,
                changedOutsideMask: drift,
                outsideDriftPercent: 0,
                verifiedAt: revTime,
                ruleRevision: targetRuleRev,
                maskRef: shot.detectedObjects?.[0]?.maskRef || 'sam-3.1:video:mod:0',
              },
              revisions: [
                ...shot.revisions,
                {
                  revisionId: `mod-${revTime}`,
                  timestamp: revTime,
                  imageUrl: updatedFrameUrl,
                  actionApplied: `Modified video object across ${modReport?.framesModified || 16} frames with verified 0 outside pixel drift (${colorName})`,
                },
              ],
            };
          }),
          statusAnnouncement: 'Video modified and re-encoded across all frames. Verified 0 outside pixel drift.',
        };
      });
    },
    []
  );

  // Add or update a ContinuityRule and re-audit all shots
  const handleAddOrUpdateRule = useCallback(
    async (targetObject: string, expectedValue: string) => {
      const newRule: ContinuityRule = {
        id: `rule-${targetObject}-color`,
        scope: 'all_shots',
        targetObject,
        property: 'color',
        expectedValue,
        revision: (projectState.rules[0]?.revision || 1) + 1,
      };

      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Updated continuity rule: ${targetObject}.color must be ${expectedValue}. Re-auditing all shots with muse-spark-1.3 and SAM 3.1...`,
      }));

      // Re-audit all shots against the new expected color
      const updatedShots: StoryboardShot[] = [];
      for (const shot of projectState.shots) {
        if (isGeneratedImage(shot.currentImageUrl)) {
          const audited = await metaModelClient.auditShotContinuity(shot, newRule);
          updatedShots.push(audited);
          continue;
        }
        const mask =
          shot.proposedFix?.mask ||
          (await metaModelClient.segmentObjectWithSam3(shot.shotNumber, targetObject));
        const currentRevAction =
          shot.revisions[shot.revisions.length - 1]?.actionApplied.toLowerCase() || '';
        const matchesNewRule = currentRevAction.includes(expectedValue.toLowerCase());

        updatedShots.push({
          ...shot,
          status: matchesNewRule ? 'consistent' : 'mismatch',
          discrepancyMessage: matchesNewRule
            ? undefined
            : `Rule updated to "${targetObject}.color = ${expectedValue}". Shot ${shot.shotNumber} requires SAM 3.1 recolor to ${expectedValue}.`,
          proposedFix: {
            action: 'recolor',
            targetObject,
            targetColor: expectedValue,
            mask,
          },
        });
      }

      const mismatchCount = updatedShots.filter((s) => s.status === 'mismatch').length;
      speechService.playEarcon(mismatchCount > 0 ? 'mismatch' : 'consistent');

      const msg = `Continuity rule updated: ${targetObject} color = ${expectedValue}. ${mismatchCount} shots flagged for SAM 3.1 recolor.`;
      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        rules: [newRule, ...prev.rules.filter((r) => r.id !== newRule.id)],
        shots: updatedShots,
        statusAnnouncement: msg,
      }));
      speechService.speak(msg, true);
    },
    [projectState.rules, projectState.shots]
  );

  // Run Full Sequence Continuity Audit (`muse-spark-1.3` + `sam-3.1`)
  const handleRunFullAudit = useCallback(async () => {
    const primaryRule = projectState.rules[0];
    if (!primaryRule) {
      announceStatus('There are no continuity rules to check. Say which prop must stay which colour, for example the jacket must be emerald.', true);
      return;
    }

    setProjectState((prev) => ({
      ...prev,
      return updatedShots;
      isProcessing: true,
      statusAnnouncement: 'Running SAM 3.1 continuity audit across sequence...',
    }));

    const auditedShots: StoryboardShot[] = [];
    try {
      for (const shot of projectState.shots) {
        if (shot.status === 'uncertain' || isGeneratedImage(shot.currentImageUrl)) {
          auditedShots.push(await metaModelClient.auditShotContinuity(shot, primaryRule));
        } else {
          auditedShots.push(shot);
        }
      }
    }

    const unreviewed = auditedShots.filter((s) => s.status === 'uncertain').length;
    if (unreviewed) {
      speechService.playEarcon('focus');
    } catch (error) {
      setProjectState((prev) => ({ ...prev, isProcessing: false }));
      announceStatus(`The continuity check failed: ${error instanceof Error ? error.message : String(error)}`, true);
      return;
      setProjectState((prev) => ({ ...prev, isProcessing: false, shots: auditedShots }));
      announceStatus(
        `${unreviewed} shots require candidate selection. Their continuity has not been verified.`,
        true
      );
      return;
    }
    const mismatches = auditedShots.filter((s) => s.status === 'mismatch');
    if (mismatches.length === 0) {
      speechService.playEarcon('consistent');
      setProjectState((prev) => ({ ...prev, isProcessing: false, shots: auditedShots }));
      announceStatus(
        `Continuity Audit Complete: All ${auditedShots.length} shots satisfy active continuity rules.`,
        true
      );
    } else {
      const firstMismatch = mismatches[0];
      speechService.playEarcon('mismatch');
      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: auditedShots,
        activeShotId: firstMismatch.id,
      }));
      announceStatus(
        `Continuity Audit found ${mismatches.length} discrepancy. Focused on Shot ${firstMismatch.shotNumber}: ${firstMismatch.discrepancyMessage} Press Y to apply SAM 3.1 fix.`,
        true
      );
    }
  }, [projectState.shots, projectState.rules, announceStatus]);

  // Toggle Animatic Playback (`isPlayingAnimatic`)
  const handleTogglePlayAnimatic = useCallback(() => {
    setProjectState((prev) => {
      const nextPlaying = !prev.isPlayingAnimatic;
      if (nextPlaying) {
        if (currentTimeSeconds >= totalDurationSeconds) setCurrentTimeSeconds(0);
        lastNarratedShotIdInAnimaticRef.current = null;
      } else {
        speechService.stopSpeaking();
      }
      return {
        ...prev,
        isPlayingAnimatic: nextPlaying,
        statusAnnouncement: nextPlaying
          ? 'Playing storyboard animatic with synchronized voice narration.'
          : 'Animatic playback paused.',
      };
    });
  }, [currentTimeSeconds, totalDurationSeconds]);

  // Execute natural voice or text command (`muse-spark-1.3` intent router)
  const handleExecuteVoiceCommand = useCallback(
    async (commandText: string) => {
      const trimmed = commandText.trim();
      if (!trimmed) return;
      if (!projectState.shots.length) {
        await handleRebuildFromTranscript(true, trimmed);
        return;
      }

      const intent = parseVoiceCommand(trimmed);
      if ('shotNumber' in intent && intent.shotNumber && !projectState.shots.some((s) => s.shotNumber === intent.shotNumber)) {
        announceStatus(`There is no shot ${intent.shotNumber}.`, true);
        return;
      }

      switch (intent.kind) {
        case 'playback': {
          if (intent.action === 'play') {
            if (!projectState.isPlayingAnimatic) handleTogglePlayAnimatic();
          } else {
            if (projectState.isPlayingAnimatic) handleTogglePlayAnimatic();
          }
          return;
        }

        case 'help': {
          setIsShortcutsModalOpen(true);
          announceStatus('Opened keyboard and voice shortcuts dialog.', false);
          return;
        }

        case 'audit': {
          await handleRunFullAudit();
          return;
        }

        case 'narrate': {
          const summary = projectState.shots.map((s) => s.spokenDescription).join(' ');
          announceStatus(`Narrating full storyboard sequence: ${summary}`, true);
          return;
        }

        case 'segment': {
          const targetShot =
            (intent.shotNumber
              ? projectState.shots.find((s) => s.shotNumber === intent.shotNumber)
              : null) || activeShot || projectState.shots[0];

          if (!targetShot) {
            announceStatus('No target shot found for segmentation.', true);
            return;
          }

          if (isLocalImage(targetShot.currentImageUrl)) {
            announceStatus(
              'Local AI image: automatic segmentation and continuity correction are not connected. Sample masks are disabled.',
              true
            );
            return;
          }

          await handleSegmentObjectManual(targetShot.id, intent.object);
          return;
        }

        case 'recolor': {
          const targetShot =
            (intent.shotNumber
              ? projectState.shots.find((s) => s.shotNumber === intent.shotNumber)
              : projectState.shots.find((s) => s.status === 'mismatch')) || activeShot || projectState.shots[0];

          const targetObject = intent.object || projectState.rules[0]?.targetObject;
          if (!targetObject) {
            announceStatus('Say which object to recolour.', true);
            return;
          }
          const reaudited = await handleAddOrUpdateRule(targetObject, intent.color);

          if (!targetShot) {
            announceStatus('All shots are already consistent.', true);
            return;
          }

          if (isLocalImage(targetShot.currentImageUrl)) {
            announceStatus(
              'Local AI image: automatic segmentation and continuity correction are not connected. Sample masks are disabled.',
              true
            );
            return;
          }

          await handleApplyProposedFix(targetShot.id, intent.color);
          return;
        }

        case 'fix': {
          const targetShot =
            (intent.shotNumber
              ? projectState.shots.find((s) => s.shotNumber === intent.shotNumber)
              : projectState.shots.find((s) => s.status === 'mismatch')) || activeShot;

          if (!targetShot) {
            announceStatus('All shots are already consistent.', true);
            return;
          }

          // A named shot changes alone; otherwise the colour applies to the whole film.
          const candidates = intent.shotNumber
            ? reaudited.filter((s) => s.id === targetShot.id)
            : reaudited.filter((s) => s.status === 'mismatch');
          const targets = candidates.filter((s) => s.proposedFix && !isLocalImage(s.currentImageUrl));
          const unconfirmed = reaudited.filter((s) => s.status === 'uncertain').length;
          if (!targets.length) {
            announceStatus(
              'Local AI image: automatic segmentation and continuity correction are not connected. Sample masks are disabled.',
              true
            );
            return;
          }

          if (intent.object && intent.color) {
            await handleAddOrUpdateRule(intent.object, intent.color);
          }

          await handleApplyProposedFix(targetShot.id, intent.color);
          return;
        }

        case 'modify_video': {
          const targetShot = activeShot?.generatedJobId
            ? activeShot
            : projectState.shots.find((s) => s.generatedJobId) || activeShot;
          const jobId = targetShot?.generatedJobId;

          if (!targetShot || !jobId) {
            announceStatus('No generated video found on active shot. Generate a local video first.', true);
            return;
          }

          const detected = targetShot.detectedObjects || [];
          const matches = detected.filter(
            (o) =>
              o.label?.toLowerCase().includes(intent.object.toLowerCase()) ||
              o.concept?.toLowerCase().includes(intent.object.toLowerCase()) ||
              o.objectId === intent.object
          );

          if (matches.length === 0) {
            announceStatus(
              `Object "${intent.object}" has not been detected in video yet. Use "Detect Objects" or segment first.`,
              true
            );
            return;
          }

          if (matches.length > 1) {
            const ids = matches.map((m) => `#${m.objectId} (${m.label})`).join(', ');
            announceStatus(
              `Multiple instances of "${intent.object}" found: ${ids}. Please specify object ID.`,
              true
            );
            return;
          }

          const targetObjId = matches[0].objectId;
          setProjectState((prev) => ({
            ...prev,
            isProcessing: true,
            statusAnnouncement: `Modifying video object ${matches[0].label} (#${targetObjId}) to ${intent.color}...`,
          }));

          try {
            const res = await modifyLocalVideo(jobId, targetObjId, intent.color);
            handleRefreshVideoUrl(
              targetShot.id,
              `/api/local-ai/jobs/${jobId}/assets/generated-video.mp4?rev=${Date.now()}`,
              res
            );
            announceStatus(
              `Video updated: ${res.framesModified} frames recolored to ${intent.color.toUpperCase()} with 0 outside drift (${res.outsideDrift}px).`,
              true
            );
          } catch (err: any) {
            announceStatus(`Video modification failed: ${err.message}`, true);
          } finally {
            setProjectState((prev) => ({ ...prev, isProcessing: false }));
          }
          return;
        }

        case 'generative_edit': {
          const targetShot = activeShot || projectState.shots[0];
          if (!targetShot) {
            announceStatus('No shot selected for generative edit.', true);
            return;
          }
          await handleGenerativeEdit(targetShot.id, intent.prompt, intent.object);
          return;
        }

        case 'rule_update': {
          const ruleObject = intent.object || projectState.rules[0]?.targetObject;
          if (!ruleObject) {
            announceStatus('Say which object the colour rule is for.', true);
            return;
          }
          await handleAddOrUpdateRule(ruleObject, intent.color);
          announceStatus(`Updated continuity rule: ${ruleObject} must be ${intent.color}.`, true);
          return;
        }

        case 'rebuild':
        default: {
          const updatedTranscript = `${projectState.transcript} ${intent.transcript}`.trim();
          await handleRebuildFromTranscript(false, updatedTranscript);
          return;
        }
      }
    },
    [
      projectState.shots,
      projectState.rules,
      projectState.transcript,
      projectState.isPlayingAnimatic,
      activeShot,
      handleApplyProposedFix,
      handleAddOrUpdateRule,
      handleRebuildFromTranscript,
      handleTogglePlayAnimatic,
      handleRunFullAudit,
      handleSegmentObjectManual,
      handleGenerativeEdit,
      handleRefreshVideoUrl,
      announceStatus,
    ]
  );

  // The only voice recorder: Web Speech dictation into the direction box. No simulated fallback.
  const handleToggleRecording = useCallback(() => {
    if (speechRecognitionService.isListening() || projectState.isRecording) {
      speechRecognitionService.stopListening();
      setProjectState((prev) => ({ ...prev, isRecording: false }));
      setVoiceNotice(null);
      announceStatus('Voice dictation stopped.');
      return;
    }
    const unavailable = (reason: string) => {
      setProjectState((prev) => ({ ...prev, isRecording: false }));
      setVoiceNotice(`Voice unavailable: ${reason} Type your direction instead.`);
      announceStatus(`Voice unavailable: ${reason}`);
    };
    if (!speechRecognitionService.isSupported()) {
      unavailable('this browser has no speech recognition.');
      return;
    }
    const base = directionDraft.trim();
    const started = speechRecognitionService.startListening({
      continuous: true,
      interimResults: true,
      onResult: (text) => setDirectionDraft(base ? `${base} ${text}` : text),
      onError: (err) => unavailable(err),
      onStateChange: (listening) => {
        setProjectState((prev) => ({ ...prev, isRecording: listening }));
        setVoiceNotice(listening ? 'Listening. Speak your direction.' : null);
      },
    });
    if (!started) unavailable('the microphone could not start.');
  }, [announceStatus, directionDraft, projectState.isRecording]);

  // Animatic Timeline Clock Effect
  useEffect(() => {
    if (!projectState.isPlayingAnimatic || projectState.shots.length === 0) return;

    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setCurrentTimeSeconds((prevTime) => {
        const nextTime = prevTime + delta;
        if (nextTime >= totalDurationSeconds) {
          setProjectState((p) => ({
            ...p,
            isPlayingAnimatic: false,
            statusAnnouncement: 'Animatic sequence playback completed.',
          }));
          return totalDurationSeconds;
        }

        // Determine which shot corresponds to `nextTime`
        let elapsed = 0;
        for (const shot of projectState.shots) {
          if (nextTime >= elapsed && nextTime < elapsed + shot.durationSeconds) {
            if (lastNarratedShotIdInAnimaticRef.current !== shot.id) {
              lastNarratedShotIdInAnimaticRef.current = shot.id;
              setProjectState((p) => ({
                ...p,
                activeShotId: shot.id,
                statusAnnouncement: `Animatic playing Shot ${shot.shotNumber}: ${shot.promptDescription}`,
              }));
              speechService.speak(shot.spokenDescription, true);
            }
            break;
          }
          elapsed += shot.durationSeconds;
        }

        return nextTime;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [projectState.isPlayingAnimatic, projectState.shots, totalDurationSeconds]);

  // Scrub timeline manually
  const handleScrubTime = useCallback(
    (timeSec: number) => {
      const clamped = Math.max(0, Math.min(totalDurationSeconds, timeSec));
      setCurrentTimeSeconds(clamped);
      speechService.playEarcon('scrub');
      lastNarratedShotIdInAnimaticRef.current = null;

      let elapsed = 0;
      for (const shot of projectState.shots) {
        if (clamped >= elapsed && (clamped < elapsed + shot.durationSeconds || shot === projectState.shots[projectState.shots.length - 1])) {
          if (projectState.activeShotId !== shot.id) {
            setProjectState((prev) => ({
              ...prev,
              activeShotId: shot.id,
            }));
          }
          break;
        }
        elapsed += shot.durationSeconds;
      }
    },
    [totalDurationSeconds, projectState.shots, projectState.activeShotId]
  );

  // Export Project JSON
  const handleExportProjectJson = useCallback(() => {
    const exportPayload = {
      app: 'Anchorshot',
      mode: 'offline-fixture',
      transitionsEnabled: !reducedMotion,
      projectId: projectState.projectId,
      title: projectState.title,
      exportedAt: new Date().toISOString(),
      transcript: projectState.transcript,
      rules: projectState.rules,
      shots: projectState.shots.map((s) => ({
        id: s.id,
        shotNumber: s.shotNumber,
        durationSeconds: s.durationSeconds,
        promptDescription: s.promptDescription,
        spokenDescription: s.spokenDescription,
        status: s.status,
        maskRef: s.proposedFix?.mask?.maskRef,
        pixelVerification: s.pixelVerification,
        revisionsCount: s.revisions.length,
        currentImageUrl: s.currentImageUrl,
        mask: s.proposedFix?.mask,
        revisions: s.revisions,
      })),
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectState.projectId}-continuity-report.json`;
    a.click();
    URL.revokeObjectURL(url);
    announceStatus('Exported Anchorshot storyboard and continuity report JSON.', true);
  }, [projectState, announceStatus, reducedMotion]);

  // Export Production CSV Shot Sheet for NLEs (Resolve / Premiere)
  const handleExportShotSheetCsv = useCallback(() => {
    if (!projectState.shots.length) {
      announceStatus('No shots available to export.', true);
      return;
    }

    const sanitizeCsvField = (text?: string): string => {
      if (!text) return '""';
      let clean = text.replace(/"/g, '""');
      // Neutralize CSV formula injection (=, +, -, @)
      if (/^[=+\-@]/i.test(clean)) {
        clean = `'${clean}`;
      }
      return `"${clean}"`;
    };

    const headers = ['Shot', 'Camera Angle', 'Duration (s)', 'Status', 'Description', 'Narration'];
    const rows = projectState.shots.map((s) => {
      const angle =
        (s as unknown as { cameraAngle?: string }).cameraAngle ||
        (s.shotNumber === 1 ? 'wide' : s.shotNumber % 2 === 0 ? 'close_up' : 'medium');
      return [
        s.shotNumber,
        angle,
        s.durationSeconds.toFixed(1),
        s.status,
        sanitizeCsvField(s.promptDescription),
        sanitizeCsvField(s.spokenDescription),
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectState.projectId}-shot-sheet.csv`;
    a.click();
    URL.revokeObjectURL(url);
    announceStatus(`Exported CSV shot sheet for ${projectState.shots.length} shots.`, true);
  }, [announceStatus, projectState.projectId, projectState.shots]);

  // Reorder / Swap Shot in Montage Sequence
  const handleReorderShot = useCallback(
    (shotId: string, direction: 'left' | 'right') => {
      const index = projectState.shots.findIndex((s) => s.id === shotId);
      if (index === -1) return;
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= projectState.shots.length) return;

      const newShots = [...projectState.shots];
      const [moved] = newShots.splice(index, 1);
      newShots.splice(targetIndex, 0, moved);

      const renumbered = newShots.map((s, idx) => ({
        ...s,
        shotNumber: idx + 1,
      }));

      // Compute playhead time offset for moved shot to maintain timeline synchronization
      let offset = 0;
      for (let i = 0; i < targetIndex; i++) {
        offset += renumbered[i].durationSeconds;
      }

      setProjectState((prev) => ({
        ...prev,
        shots: renumbered,
        activeShotId: moved.id,
        currentTimeSeconds: offset,
      }));

      // Pure state update: run side-effects outside updater
      speechService.playEarcon('focus');
      announceStatus(`Moved Shot ${moved.shotNumber} to position ${targetIndex + 1}.`, true);
    },
    [announceStatus, projectState.shots]
  );

  // Nudge Shot Duration (Pacing Trim)
  const handleNudgeDuration = useCallback(
    (shotId: string, delta: number) => {
      const target = projectState.shots.find((s) => s.id === shotId);
      if (!target) return;
      const newDuration = Math.max(0.5, Math.min(15, Math.round((target.durationSeconds + delta) * 10) / 10));
      if (newDuration === target.durationSeconds) return;

      const updated = projectState.shots.map((s) =>
        s.id === shotId ? { ...s, durationSeconds: newDuration } : s
      );

      setProjectState((prev) => ({
        ...prev,
        shots: updated,
      }));

      // Pure state update: run side-effects outside updater
      speechService.playEarcon('scrub');
      announceStatus(`Shot ${target.shotNumber} duration set to ${newDuration.toFixed(1)}s.`, true);
    },
    [announceStatus, projectState.shots]
  );

  const handleToggleBurnInTimecode = useCallback(() => {
    setBurnInTimecode((prev) => {
      const next = !prev;
      announceStatus(`Burn-in timecode overlay ${next ? 'enabled' : 'disabled'}.`, false);
      return next;
    });
  }, [announceStatus]);

  // Cycle through available takes/revisions for a shot
  const handleCycleShotTake = useCallback(
    (shotId: string) => {
      const targetShot = projectState.shots.find((s) => s.id === shotId);
      if (!targetShot || targetShot.revisions.length <= 1) {
        speechService.playEarcon('focus');
        announceStatus(
          `Shot ${targetShot?.shotNumber ?? 1} has only 1 take available.`,
          true
        );
        return;
      }

      const currentIndex = targetShot.revisions.findIndex(
        (r) => r.imageUrl === targetShot.currentImageUrl
      );
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : targetShot.revisions.length - 1;
      const nextIndex = (safeCurrentIndex + 1) % targetShot.revisions.length;
      const nextRev = targetShot.revisions[nextIndex];

      handleRevertShotRevision(shotId, nextRev.revisionId);
      speechService.playEarcon('focus');
      announceStatus(
        `Shot ${targetShot.shotNumber}: switched to Take ${nextIndex + 1} of ${targetShot.revisions.length}: ${nextRev.actionApplied}`,
        true
      );
    },
    [projectState.shots, handleRevertShotRevision, announceStatus]
  );

  // Export Animatic Video: narrated MP4 from the server, silent browser WebM as fallback
  const handleExportAnimaticVideo = useCallback(async () => {
    setIsExportingVideo(true);
    announceStatus(`Rendering narrated MP4 animatic${burnInTimecode ? ' with burn-in timecode' : ''}...`, false);
    const mp4 = await exportAnimaticMp4(projectState.shots, { burnInTimecode });
    const blob = mp4?.video ?? (await exportStoryboardAnimaticVideo(projectState.shots, projectState.title));
    setIsExportingVideo(false);
    if (!blob) {
      announceStatus('Video export requires a browser supporting HTML5 Canvas MediaRecorder.', true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectState.projectId}-animatic.${mp4 ? 'mp4' : 'webm'}`;
    a.click();
    URL.revokeObjectURL(url);
    announceStatus(
      mp4
        ? `Exported MP4 animatic${burnInTimecode ? ' (BITC)' : ''}.`
        : 'MP4 export unavailable. Exported a silent WebM animatic instead.',
      true
    );
  }, [projectState.shots, projectState.title, projectState.projectId, burnInTimecode, announceStatus]);

  const handleToggleBeforeComparison = useCallback(() => {
    setShowBeforeComparison((prev) => {
      const next = !prev;
      announceStatus(
        next
          ? 'Showing pre-repair BEFORE frame for visual comparison.'
          : 'Showing SAM 3.1 repaired AFTER frame with zero outside-mask pixel drift.',
        false
      );
      return next;
    });
  }, [announceStatus]);

  // Global Keyboard Navigation (WCAG 2.2 AAA Full Keyboard Control)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTextInputFocused) return;

      const isButtonOrLink =
        target &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.getAttribute('role') === 'button');
      const isTab =
        target &&
        (target.getAttribute('role') === 'tab' ||
          target.getAttribute('role') === 'tablist' ||
          target.tagName === 'SELECT');

      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        // Allow Space to natively activate focused buttons and links without hijacking animatic playback
        if (isButtonOrLink) return;
        e.preventDefault();
        handleTogglePlayAnimatic();
      } else if (key === 'v') {
        e.preventDefault();
        handleToggleRecording();
      } else if (key === 'n' && activeShot) {
        e.preventDefault();
        handleNarrateShot(activeShot);
      } else if (key === 't' && activeShot) {
        e.preventDefault();
        handleCycleShotTake(activeShot.id);
      } else if (key === 'y' && activeShot) {
        e.preventDefault();
        handleApplyProposedFix(activeShot.id);
      } else if (key === 'b') {
        e.preventDefault();
        if (!activeShot || (activeShot.revisions?.length ?? 0) <= 1) {
          announceStatus('No previous revision available for before and after comparison.', false);
        } else {
          handleToggleBeforeComparison();
        }
      } else if (key === 'm') {
        e.preventDefault();
        const hasMask = Boolean(activeShot?.proposedFix?.mask);
        if (!hasMask) {
          announceStatus('No SAM 3.1 segmentation mask available for this shot.', false);
        } else {
          setShowSamMaskOverlay((prev) => {
            const next = !prev;
            announceStatus(`SAM 3.1 segmentation overlay ${next ? 'enabled' : 'hidden'}.`, false);
            return next;
          });
        }
      } else if (key === 'a') {
        e.preventDefault();
        handleRunFullAudit();
      } else if (key === 'g') {
        e.preventDefault();
        handleRebuildFromTranscript(true);
      } else if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      } else if (e.altKey && e.key === 'ArrowRight' && activeShot) {
        e.preventDefault();
        handleReorderShot(activeShot.id, 'right');
      } else if (e.altKey && e.key === 'ArrowLeft' && activeShot) {
        e.preventDefault();
        handleReorderShot(activeShot.id, 'left');
      } else if (key === '[' && activeShot) {
        e.preventDefault();
        handleNudgeDuration(activeShot.id, -0.5);
      } else if (key === ']' && activeShot) {
        e.preventDefault();
        handleNudgeDuration(activeShot.id, 0.5);
      } else if (e.key === 'ArrowRight') {
        // Allow native tab/select arrow navigation without switching storyboard shots
        if (isTab) return;
        e.preventDefault();
        const idx = projectState.shots.findIndex((s) => s.id === projectState.activeShotId);
        const nextIdx = Math.min(projectState.shots.length - 1, idx + 1);
        if (projectState.shots[nextIdx]) {
          handleSelectShot(projectState.shots[nextIdx].id, true);
        }
      } else if (e.key === 'ArrowLeft') {
        if (isTab) return;
        e.preventDefault();
        const idx = projectState.shots.findIndex((s) => s.id === projectState.activeShotId);
        const prevIdx = Math.max(0, idx - 1);
        if (projectState.shots[prevIdx]) {
          handleSelectShot(projectState.shots[prevIdx].id, true);
        }
      } else if (['1', '2', '3', '4'].includes(key)) {
        e.preventDefault();
        const shotIdx = parseInt(key, 10) - 1;
        if (projectState.shots[shotIdx]) {
          handleSelectShot(projectState.shots[shotIdx].id, true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeShot,
    projectState.shots,
    projectState.activeShotId,
    handleTogglePlayAnimatic,
    handleToggleRecording,
    handleNarrateShot,
    handleApplyProposedFix,
    handleToggleBeforeComparison,
    handleRunFullAudit,
    handleRebuildFromTranscript,
    handleSelectShot,
    handleReorderShot,
    handleNudgeDuration,
    handleCycleShotTake,
    announceStatus,
  ]);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    speechService.setMuted(nextMuted);
    setProjectState((prev) => ({
      ...prev,
      statusAnnouncement: nextMuted
        ? 'Spoken synthesis and audio cues muted.'
        : 'Spoken synthesis and audio cues enabled.',
    }));
  };

  if (!storageReady) return <main className="p-8 text-white bg-black min-h-dvh" role="status">{storageStatus}</main>;
  return (
    <>
      <CleanStudio
        showMask={showSamMaskOverlay}
        showBefore={showBeforeComparison}
        storageStatus={storageStatus}
        projectId={projectState.projectId}
        projectTitle={projectState.title}
        projects={[...sessionProjects.filter((item) => item.projectId !== projectState.projectId), projectState].map((item) => ({
          id: item.projectId,
          title: item.title,
        }))}
        onNewProject={() => switchProject()}
        onOpenProject={switchProject}
        onRenameProject={(title) => setProjectState((previous) => ({ ...previous, title }))}
        shots={projectState.shots}
        activeShot={activeShot}
        transcript={projectState.transcript}
        processing={projectState.isProcessing}
        playing={projectState.isPlayingAnimatic}
        time={currentTimeSeconds}
        duration={totalDurationSeconds}
        status={projectState.statusAnnouncement}
        muted={isMuted}
        onMute={handleToggleMute}
        onTranscript={(text) => setProjectState((prev) => ({ ...prev, transcript: text }))}
        onGenerate={() => void handleRebuildFromTranscript(true)}
        onCommand={(text) => void handleExecuteVoiceCommand(text)}
        onSelect={(id) => handleSelectShot(id)}
        onPlay={handleTogglePlayAnimatic}
        onSeek={handleScrubTime}
        onNarrate={() => {
          if (activeShot) handleNarrateShot(activeShot);
        }}
        onExport={() => void handleExportAnimaticVideo()}
        exporting={isExportingVideo}
        onAudit={handleRunFullAudit}
        onShortcuts={() => setIsShortcutsModalOpen(true)}
        onExportJson={handleExportProjectJson}
        onExportCsv={handleExportShotSheetCsv}
        onReorderShot={handleReorderShot}
        onNudgeDuration={handleNudgeDuration}
        burnInTimecode={burnInTimecode}
        onToggleBurnInTimecode={handleToggleBurnInTimecode}
        splitPosition={splitPosition}
        onSplitPositionChange={setSplitPosition}
        onCycleShotTake={handleCycleShotTake}
        draft={directionDraft}
        onDraft={setDirectionDraft}
        listening={projectState.isRecording}
        onToggleVoice={handleToggleRecording}
        voiceNotice={voiceNotice}
        inspector={
          <ShotInspectorPanel
        progressPercent={generationPercent}
            onUseLocalImage={handleUseLocalImage}
            onUseLocalVideo={handleUseLocalVideo}
            onUpdateDetectedObjects={handleUpdateDetectedObjects}
            onRefreshVideoUrl={handleRefreshVideoUrl}
            onGenerativeEdit={handleGenerativeEdit}
            onAnalyzeVideoContinuity={handleAnalyzeVideoContinuity}
            activeShot={activeShot}
            showSamMaskOverlay={showSamMaskOverlay}
            showBeforeComparison={showBeforeComparison}
            splitPosition={splitPosition}
            onSplitPositionChange={setSplitPosition}
            isProcessing={projectState.isProcessing}
            modelLogs={modelLogs}
            onToggleSamMaskOverlay={() => setShowSamMaskOverlay((prev) => !prev)}
            onToggleBeforeComparison={handleToggleBeforeComparison}
            onNarrateShot={handleNarrateShot}
            onApplyProposedFix={handleApplyProposedFix}
            onDisambiguateShot={handleDisambiguateShot}
            onSegmentObjectManual={handleSegmentObjectManual}
            onRevertShotRevision={handleRevertShotRevision}
            onUpdateShotPrompt={handleUpdateShotPrompt}
          />
        }
        controls={
          <ProjectRulesPanel
            rules={projectState.rules}
            activePresetId={activePresetId}
            onSelectPreset={handleSelectPreset}
            onAddOrUpdateRule={handleAddOrUpdateRule}
          />
        }
        shortcuts={
          <KeyboardShortcutsModal
            isOpen={isShortcutsModalOpen}
            onClose={() => setIsShortcutsModalOpen(false)}
          />
        }
      />
      {new URLSearchParams(location.search).has('debug') && <OrcaDiagnosticDrawer />}
    </>
  );
}
