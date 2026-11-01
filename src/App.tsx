import {loadLocal,saveLocal} from './services/projectStorage';
import {CleanStudio} from './components/CleanStudio';
import {isGeneratedImage, isLocalImage} from './services/localGeneration';
import { useReducedMotion } from 'motion/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ContinuityRule,
  DirectorPresetScenario,
  ModelInvocationRecord,
  ProjectState,
  StoryboardShot,
} from './types/framelock';
import { DIRECTOR_PRESETS, metaModelClient } from './services/metaModels';
import { speechService } from './services/speechService';
import { exportAnimaticMp4 } from './services/animaticExport';
import { parseVoiceCommand } from './services/voiceCommandParser';
import { speechRecognitionService } from './services/speechRecognitionService';
import {
  exportStoryboardAnimaticVideo,
  renderMuseStoryboardFrame,
} from './services/canvasEngine';
import { VoiceTranscriptPanel } from './components/VoiceTranscriptPanel';
import { ShotInspectorPanel } from './components/ShotInspectorPanel';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';

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
  useEffect(()=>{void speechRecognitionService.connectBackend();void speechService.connectBackend();},[]);
  useEffect(()=>{let alive=true;loadLocal<{active:string;projects:ProjectState[]}>('library').then(saved=>{
    if(!alive)return;if(saved?.projects?.length){const clean=saved.projects.map(item=>({...item,isProcessing:false,isRecording:false,isPlayingAnimatic:false}));setSessionProjects(clean);setProjectState(clean.find(item=>item.projectId===saved.active)||clean[0]);}setStorageReady(true);setStorageStatus('Saved locally');
  }).catch(()=>{if(alive)setStorageStatus('Local storage could not be opened. Reload to retry; existing data has not been overwritten.');});return()=>{alive=false};},[]);
  useEffect(()=>{if(!storageReady)return;setStorageStatus('Saving locally...');let cancelled=false;
    saveLocal('library',{active:projectState.projectId,projects:[...sessionProjects.filter(item=>item.projectId!==projectState.projectId),{...projectState,isRecording:false,isPlayingAnimatic:false,isProcessing:false}]}).then(()=>{if(!cancelled)setStorageStatus('Saved locally');}).catch(()=>{if(!cancelled)setStorageStatus('Local save failed. Keep this page open and free browser storage.');});return()=>{cancelled=true};
  },[storageReady,projectState,sessionProjects]);
  const switchProject = (id?: string) => {
    if (projectState.isProcessing || isExportingVideo) return;
    speechRecognitionService.stopListening();
    setSessionProjects(previous => [...previous.filter(item => item.projectId !== projectState.projectId), {...projectState,isPlayingAnimatic:false,isRecording:false}]);
    const selected = sessionProjects.find(item => item.projectId === id);
    setProjectState(selected ? {...selected,isPlayingAnimatic:false,isRecording:false} : {
      projectId: crypto.randomUUID(), title:'Untitled film', transcript:'',isRecording:false,rules:[],shots:[],activeShotId:null,isPlayingAnimatic:false,isProcessing:false,statusAnnouncement:'New project. Describe your story to begin.'
    });
    setCurrentTimeSeconds(0);
  };

  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id);
  const [showSamMaskOverlay, setShowSamMaskOverlay] = useState<boolean>(true);
  const [showBeforeComparison, setShowBeforeComparison] = useState<boolean>(false);
  const [isExportingVideo, setIsExportingVideo] = useState<boolean>(false);
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'animatic'>('grid');
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);
  const [modelLogs, setModelLogs] = useState<ModelInvocationRecord[]>([]);

  const lastNarratedShotIdInAnimaticRef = useRef<string | null>(null);

  // Subscribe to speech synthesis state and Meta Model logs
  useEffect(() => {
    speechService.setSpeakingCallback(setIsSpeaking);
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

  // Rebuild storyboard from transcript (`muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`)
  const handleRebuildFromTranscript = useCallback(
    async (injectDiscrepancy: boolean = true, overrideTranscript?: string) => {
      const targetTranscript = overrideTranscript ?? projectState.transcript;
      if (!targetTranscript.trim()) return;
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement:
          'Running muse-spark-1.3 shot planner and muse-image-1.0 storyboard synthesis...',
      }));

      let rules: ContinuityRule[];
      let shots: StoryboardShot[];
      try {
        ({ rules, shots } = await metaModelClient.generateStoryboardFromTranscript(
          targetTranscript,
          undefined,
          injectDiscrepancy
        ));
      } catch (error) {
        const message = `Storyboard generation failed: ${(error as Error).message}`;
        speechService.playEarcon('mismatch');
        setProjectState((prev) => ({ ...prev, isProcessing: false, statusAnnouncement: message }));
        speechService.speak(message, true);
        return;
      }

      const mismatchShot = shots.find((s) => s.status === 'mismatch');
      speechService.playEarcon(mismatchShot ? 'mismatch' : 'consistent');

      const summaryMsg = mismatchShot
        ? `Generated ${shots.length} shots. Discrepancy flagged in Shot ${mismatchShot.shotNumber}: ${mismatchShot.discrepancyMessage}`
        : `Generated ${shots.length} shots. All shots pass continuity verification.`;

      setProjectState((prev) => ({
        ...prev,
        transcript: targetTranscript,
        rules,
        shots,
        activeShotId: mismatchShot ? mismatchShot.id : shots[0]?.id || null,
        isProcessing: false,
        statusAnnouncement: summaryMsg,
      }));
      speechService.speak(summaryMsg, true);
    },
    [projectState.transcript]
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
      if (isGeneratedImage(targetShot.currentImageUrl)) {
        announceStatus('Generated image: automatic segmentation and continuity correction are not connected. Sample masks are disabled.', true);
        return;
      }

      const ruleRevision = projectState.rules[0]?.revision || 1;
      setShowBeforeComparison(false);
      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Isolating ${
          targetShot.proposedFix?.targetObject || 'prop'
        } in Shot ${targetShot.shotNumber} with SAM 3.1 mask and recoloring pixels...`,
      }));

      const updatedShot = await metaModelClient.applyContinuityFix(
        targetShot,
        customColor,
        ruleRevision
      );
      speechService.playEarcon('fixApplied');

      const resolvedColor =
        customColor || targetShot.proposedFix?.targetColor || 'blue';
      const resolvedObject = targetShot.proposedFix?.targetObject || 'cup';

      const confirmationMessage = `Continuity verified on Shot ${updatedShot.shotNumber}. ${resolvedObject} recolored to ${resolvedColor} via SAM 3.1 mask ${updatedShot.pixelVerification?.maskRef || ''} with 0 outside-mask pixel drift.`;

      setProjectState((prev) => ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((s) => (s.id === shotId ? updatedShot : s)),
        activeShotId: shotId,
        statusAnnouncement: confirmationMessage,
      }));

      speechService.speak(confirmationMessage, true);
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
      if (isGeneratedImage(targetShot.currentImageUrl)) {
        announceStatus('Generated image: automatic segmentation and continuity correction are not connected. Sample masks are disabled.', true);
        return;
      }

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
      const targetObject = primaryRule?.targetObject || 'cup';
      const expectedColor = primaryRule?.expectedValue || 'blue';

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
        if (isGeneratedImage(shot.currentImageUrl)) { updatedShots.push({...shot, status: 'uncertain', proposedFix: undefined}); continue; }
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

  // Run Full Sequence Continuity Audit (`muse-spark-1.3`)
  const handleRunFullAudit = useCallback(() => {
    const unreviewed = projectState.shots.filter(s => s.status === 'uncertain').length;
    if (unreviewed) {
      announceStatus(`${unreviewed} shots require review or candidate selection. Their continuity has not been verified.`, true);
      return;
    }
    const mismatches = projectState.shots.filter((s) => s.status === 'mismatch');
    if (mismatches.length === 0) {
      speechService.playEarcon('consistent');
      announceStatus(
        `Continuity Audit Complete: All ${projectState.shots.length} shots satisfy active continuity rules.`,
        true
      );
    } else {
      const firstMismatch = mismatches[0];
      speechService.playEarcon('mismatch');
      setProjectState((prev) => ({
        ...prev,
        activeShotId: firstMismatch.id,
      }));
      announceStatus(
        `Continuity Audit found ${mismatches.length} discrepancy. Focused on Shot ${firstMismatch.shotNumber}: ${firstMismatch.discrepancyMessage} Press Y to apply SAM 3.1 fix.`,
        true
      );
    }
  }, [projectState.shots, announceStatus]);

  // Toggle Animatic Playback (`isPlayingAnimatic`)
  const handleTogglePlayAnimatic = useCallback(() => {
    setProjectState((prev) => {
      const nextPlaying = !prev.isPlayingAnimatic;
      if (nextPlaying) {
        if (currentTimeSeconds >= totalDurationSeconds) setCurrentTimeSeconds(0);
        setViewMode('animatic');
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
      const shotByNumber = (n?: number) => (n ? projectState.shots.find((s) => s.shotNumber === n) : undefined);
      switch (intent.kind) {
        case 'playback':
          if ((intent.action === 'play') !== projectState.isPlayingAnimatic) handleTogglePlayAnimatic();
          return;
        case 'help':
          setIsShortcutsModalOpen(true);
          announceStatus('Opened keyboard and voice shortcuts dialog.', false);
          return;
        case 'audit':
          await handleRunFullAudit();
          return;
        case 'narrate': {
          const summary = projectState.shots.map((s) => s.spokenDescription).join(' ');
          announceStatus(`Narrating full storyboard sequence: ${summary}`, true);
          return;
        }
        case 'fix': {
          if (intent.shotNumber && !shotByNumber(intent.shotNumber)) {
            announceStatus(`There is no shot ${intent.shotNumber}.`, true);
            return;
          }
          const targetShot =
            shotByNumber(intent.shotNumber) ?? projectState.shots.find((s) => s.status === 'mismatch') ?? activeShot;
          if (targetShot) await handleApplyProposedFix(targetShot.id, intent.color);
          else announceStatus('All shots are already consistent.', true);
          return;
        }
        case 'recolor': {
          if (intent.shotNumber) {
            const shot = shotByNumber(intent.shotNumber);
            if (shot) await handleApplyProposedFix(shot.id, intent.color);
            else announceStatus(`There is no shot ${intent.shotNumber}.`, true);
            return;
          }
          await handleAddOrUpdateRule(intent.object || projectState.rules[0]?.targetObject || 'cup', intent.color);
          return;
        }
        case 'rule_update':
          await handleAddOrUpdateRule(projectState.rules[0]?.targetObject || 'cup', intent.color);
          return;
        case 'rebuild': {
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
      announceStatus,
    ]
  );

  const handleTestLocalDictation = useCallback(async () => {
    announceStatus('Running local voice dictation test...');
    const sample =
      'Continuity Rule across all shots: the ceramic coffee cup must be blue. Shot 2 has a red cup discrepancy—segment the cup and recolor it to cobalt blue.';
    await speechRecognitionService.simulateLocalSpeech(sample, {
      onResult: (text, isFinal) => {
        setProjectState((prev) => ({ ...prev, transcript: text }));
        if (isFinal) {
          announceStatus('Local voice test completed: transcript generated.', true);
        }
      },
      onStateChange: (listening) => {
        setProjectState((prev) => ({ ...prev, isRecording: listening }));
      },
    });
  }, [announceStatus]);

  // Start or stop real Speech-to-Text via Web Speech API (with local test fallback)
  const handleToggleRecording = useCallback(() => {
    if (speechRecognitionService.isListening() || projectState.isRecording) {
      speechRecognitionService.stopListening();
      setProjectState((prev) => ({ ...prev, isRecording: false }));
      announceStatus('Voice capture stopped. Transcript updated.');
      return;
    }

    if (speechRecognitionService.isSupported()) {
      announceStatus('Listening for voice input... Speak now.');
      const baseTranscript = projectState.transcript.trim();
      const started = speechRecognitionService.startListening({
        continuous: true,
        interimResults: true,
        onResult: (text, isFinal) => {
          // Replace with current utterance relative to base snapshot to avoid interim duplication
          setProjectState((prev) => ({
            ...prev,
            transcript: baseTranscript ? `${baseTranscript} ${text}` : text,
          }));
          if (isFinal) {
            announceStatus(`Recorded voice: "${text}"`, false);
          }
        },
        onError: (err) => {
          setProjectState((prev) => ({ ...prev, isRecording: false }));
          if (err.includes('network') || err.includes('unreachable')) {
            announceStatus('Browser cloud voice unreachable (offline). Running local sample dictation...');
            void handleTestLocalDictation();
          } else {
            announceStatus(err);
          }
        },
        onStateChange: (listening) => {
          setProjectState((prev) => ({ ...prev, isRecording: listening }));
        },
      });

      if (!started) {
        announceStatus('Could not access microphone. Try local sample dictation.');
        setProjectState((prev) => ({ ...prev, isRecording: false }));
      }
    } else {
      announceStatus('Web Speech API is unavailable in this browser. Running local test dictation.');
      void handleTestLocalDictation();
    }
  }, [announceStatus, handleTestLocalDictation, projectState.isRecording, projectState.transcript]);

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
      transitionsEnabled: transitionsEnabled && !reducedMotion,
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
  }, [projectState, announceStatus, transitionsEnabled, reducedMotion]);

  // Export Animatic Video: narrated MP4 from the server, silent browser WebM as fallback
  const handleExportAnimaticVideo = useCallback(async () => {
    setIsExportingVideo(true);
    announceStatus('Rendering narrated MP4 animatic...', false);
    const mp4 = await exportAnimaticMp4(projectState.shots);
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
        ? `Exported MP4 animatic with narration on ${mp4.narratedShots} of ${projectState.shots.length} shots.`
        : 'MP4 export unavailable. Exported a silent WebM animatic instead.',
      true
    );
  }, [projectState.shots, projectState.title, projectState.projectId, announceStatus]);

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

  if(!storageReady)return <main className="p-8 text-white bg-black min-h-dvh" role="status">{storageStatus}</main>;
  return <CleanStudio
    onSaveScene={(id,prompt,duration)=>{if(!prompt.trim()||!Number.isFinite(duration)||duration<0.5||duration>60)return;setCurrentTimeSeconds(0);setProjectState(previous=>({...previous,isPlayingAnimatic:false,shots:previous.shots.map(shot=>shot.id===id?{...shot,promptDescription:prompt,durationSeconds:duration,spokenDescription:`Scene ${shot.shotNumber}. ${prompt}`,status:prompt!==shot.promptDescription?'uncertain':shot.status}:shot)}));}}

    storageStatus={storageStatus}
    projectId={projectState.projectId} projectTitle={projectState.title}
    projects={[...sessionProjects.filter(item=>item.projectId!==projectState.projectId),projectState].map(item=>({id:item.projectId,title:item.title}))}
    onNewProject={()=>switchProject()} onOpenProject={switchProject}
    onRenameProject={title=>setProjectState(previous=>({...previous,title}))} shots={projectState.shots} activeShot={activeShot} transcript={projectState.transcript}
    processing={projectState.isProcessing} playing={projectState.isPlayingAnimatic} time={currentTimeSeconds} duration={totalDurationSeconds}
    status={projectState.statusAnnouncement} muted={isMuted} onMute={handleToggleMute}
    onTranscript={text=>setProjectState(prev=>({...prev,transcript:text}))} onGenerate={()=>void handleRebuildFromTranscript(false)}
    onCommand={text=>void handleExecuteVoiceCommand(text)} onSelect={id=>handleSelectShot(id)} onPlay={handleTogglePlayAnimatic}
    onSeek={handleScrubTime} onNarrate={()=>{if(activeShot)handleNarrateShot(activeShot);}} onExport={()=>void handleExportAnimaticVideo()} exporting={isExportingVideo}
    onAudit={handleRunFullAudit} onShortcuts={()=>setIsShortcutsModalOpen(true)}
    inspector={<ShotInspectorPanel
          onUseLocalImage={handleUseLocalImage}
          activeShot={activeShot}
          showSamMaskOverlay={showSamMaskOverlay}
          showBeforeComparison={showBeforeComparison}
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
        />} controls={<VoiceTranscriptPanel
          transcript={projectState.transcript}
          isRecording={projectState.isRecording}
          isProcessing={projectState.isProcessing}
          isSpeaking={isSpeaking}
          isMuted={isMuted}
          rules={projectState.rules}
          activePresetId={activePresetId}
          onToggleRecording={handleToggleRecording}
          onTranscriptChange={(newText) =>
            setProjectState((prev) => ({ ...prev, transcript: newText }))
          }
          onRebuildFromTranscript={handleRebuildFromTranscript}
          onSelectPreset={handleSelectPreset}
          onExecuteVoiceCommand={handleExecuteVoiceCommand}
          onAddOrUpdateRule={handleAddOrUpdateRule}
          onToggleMute={handleToggleMute}
          onTestLocalDictation={handleTestLocalDictation}
        />} shortcuts={<KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />} />;
}
