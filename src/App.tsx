import {correctReviewedVideoObject} from './services/videoTracking';
import {validNarrationUrl,type NarrationAttachment} from './services/narration';
import type {VideoTrackPlan} from './types/videoTracks';
import { updateShotDetails, restoreShotTake } from './lib/shotEdits';
import {loadLocal,saveLocal,localSaveError,flushLocalSaves,type ProjectLibrary} from './services/projectStorage';
import {CleanStudio} from './components/CleanStudio';
import {isGeneratedImage, isGeneratedShot, isLocalImage} from './services/localGeneration';
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
    projectId: crypto.randomUUID(),
    title: 'Untitled film',
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

  const currentProjectRef = useRef(projectState);
  currentProjectRef.current = projectState;
  const candidateRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>candidateRequest.current?.abort(),[projectState.projectId]);
  const videoReviewRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>videoReviewRequest.current?.abort(),[]);
  const generativeEditRequest = useRef<AbortController | null>(null);
  useEffect(() => () => generativeEditRequest.current?.abort(), []);

  const [sessionProjects, setSessionProjects] = useState<ProjectState[]>([]);
  const [storageReady,setStorageReady]=useState(false);
  const [storageStatus,setStorageStatus]=useState('Loading local projects...');
  useEffect(()=>{void speechRecognitionService.connectBackend();},[]);
  useEffect(()=>{let alive=true;loadLocal<ProjectLibrary>('library').then(saved=>{
    if(!alive)return;if(saved?.projects?.length){const clean=saved.projects.map(item=>({...item,isProcessing:false,isRecording:false,isPlayingAnimatic:false}));setSessionProjects(clean);setProjectState(prev => (prev.shots.length > 0 || prev.transcript ? prev : (clean.find(item=>item.projectId===saved.active)||clean[0])));}setStorageReady(true);setStorageStatus('Saved locally');
  }).catch(error=>{if(alive)setStorageStatus(localSaveError(error));});return()=>{alive=false};},[]);
  useEffect(()=>{if(!storageReady)return;setStorageStatus('Saving locally...');let cancelled=false;
    saveLocal('library',{active:projectState.projectId,projects:[...sessionProjects.filter(item=>item.projectId!==projectState.projectId),{...projectState,isRecording:false,isPlayingAnimatic:false,isProcessing:false}]}).then(()=>{if(!cancelled)setStorageStatus('Saved locally');}).catch(error=>{if(!cancelled)setStorageStatus(localSaveError(error));});return()=>{cancelled=true};
  },[storageReady,projectState,sessionProjects]);
  const [directionDraft, setDirectionDraft] = useState('');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const switchingProject = useRef(false);
  const archiveLock = useRef(false);
  const [archiveBusy,setArchiveBusy]=useState(false);
  const [archiveMessage,setArchiveMessage]=useState('');
  const switchProject = async (id?: string) => {
    if (!storageReady || switchingProject.current || archiveLock.current || projectState.isProcessing || isExportingVideo) return;
    switchingProject.current = true;
    setStorageStatus('Switching projects...');
    speechRecognitionService.cancelListening();
    try {
      // Flush current edits before switching, then read other tabs' latest projects.
      await saveLocal('library', {active: projectState.projectId, projects: [
        ...sessionProjects.filter(item => item.projectId !== projectState.projectId),
        {...projectState,isPlayingAnimatic:false,isRecording:false,isProcessing:false},
      ]});
      await flushLocalSaves();
      const saved = await loadLocal<ProjectLibrary>('library');
      const projects = saved?.projects ?? [];
      const selected = projects.find(item => item.projectId === id);
      if (id && !selected) throw new Error('This project could not be found. Your current edits are still open.');
      const nextProject: ProjectState = selected ? {...selected,isPlayingAnimatic:false,isRecording:false,isProcessing:false} : {
        projectId: crypto.randomUUID(), title:'Untitled film', transcript:'',isRecording:false,rules:[],shots:[],activeShotId:null,isPlayingAnimatic:false,isProcessing:false,statusAnnouncement:'New project. Describe your story to begin.'
      };
      await saveLocal('library', {active:nextProject.projectId,projects:[
        ...projects.filter(item => item.projectId !== nextProject.projectId),nextProject,
      ]});
      setSessionProjects(projects);
      setProjectState(nextProject);
      setStorageStatus('Saved locally');
      setCurrentTimeSeconds(0);
      setDirectionDraft('');
      setVoiceNotice(null);
    } catch (error) {
      setStorageStatus(localSaveError(error));
    } finally {
      switchingProject.current = false;
    }
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

  const storyboardGenerationActive = useRef(false);

  // Rebuild storyboard from transcript (`muse-spark-1.3` + `muse-image-1.0` + `sam-3.1`)
  const handleRebuildFromTranscript = useCallback(
    async (injectDiscrepancy: boolean = true, overrideTranscript?: string) => {
      const targetTranscript = overrideTranscript ?? projectState.transcript;
      if (!targetTranscript.trim()) return 'The script is empty, so nothing was generated.';
      if (storyboardGenerationActive.current || currentProjectRef.current.isProcessing) return 'Wait for the current operation to finish before generating another storyboard.';
      storyboardGenerationActive.current = true;
      orcaTracker.trackAction('generation', `Rebuilding storyboard from transcript: "${targetTranscript.slice(0, 60)}..."`, { targetTranscript });
      setProjectState((prev) => ({
        ...prev,
        transcript: targetTranscript,
        isProcessing: true,
        statusAnnouncement:
          'Preparing your prompt-to-video generation…',
      }));

      setCurrentTimeSeconds(0);
      let rules: ContinuityRule[];
      let shots: StoryboardShot[];
      try {
        try {
          ({ rules, shots } = await metaModelClient.generateFilmFromTranscript(
            targetTranscript,
            (message, percent) => {
              setGenerationPercent(percent);
              setProjectState((prev) => ({ ...prev, statusAnnouncement: message }));
            }
          ).finally(() => setGenerationPercent(undefined)));
        } catch (error) {
          const message = `Film generation failed: ${error instanceof Error ? error.message : String(error)}`;
          speechService.playEarcon('mismatch');
          setProjectState((prev) => ({ ...prev, isProcessing: false, statusAnnouncement: message }));
          speechService.speak(message, true);
          return message;
        }
      orcaTracker.trackAction('generation', `Generated ${shots.length} shots (${rules.length} rules)`, { shotCount: shots.length, rulesCount: rules.length });

      const mismatchShot = shots.find((s) => s.status === 'mismatch');

      // Prompt and voice generation return real clips already assembled into these shots.

      speechService.playEarcon(mismatchShot ? 'mismatch' : shots.some((s) => s.status === 'uncertain') ? 'focus' : 'consistent');

      const summaryMsg = mismatchShot
        ? `Generated ${shots.length} shots. Discrepancy flagged in Shot ${mismatchShot.shotNumber}: ${mismatchShot.discrepancyMessage}`
        : shots.some((s) => s.status === 'uncertain')
        ? `Generated ${shots.length} shots. Continuity is not checked yet; say check continuity to run it.`
        : `Generated ${shots.length} shots. All shots pass continuity verification.`;

      setProjectState((prev) => ({
        ...prev,
        transcript: targetTranscript,
        isPlayingAnimatic: false,
        rules,
        shots,
        activeShotId: mismatchShot ? mismatchShot.id : shots[0]?.id || null,
        statusAnnouncement: summaryMsg,
      }));
      speechService.speak(summaryMsg, true);
      return summaryMsg;
      } finally {
        storyboardGenerationActive.current = false;
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
      const sourceState = currentProjectRef.current;
      const targetShot = sourceState.shots.find((s) => s.id === shotId);
      if (!targetShot) return;

      const projectId = sourceState.projectId;
      const sourceMatches = (state: ProjectState) => state.projectId === projectId
        && state.shots.find(s => s.id === shotId) === targetShot && state.rules === sourceState.rules;
      const staleMessage = 'The scene changed during correction. Your edits were kept; apply the correction again.';
      const ruleRevision = sourceState.rules.find(rule => rule.targetObject === targetShot.proposedFix?.targetObject && rule.property === 'color')?.revision || 1;
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
        if (!sourceMatches(currentProjectRef.current)) {
          setProjectState(prev => prev.projectId === projectId ? { ...prev, statusAnnouncement: staleMessage } : prev);
          return;
        }
        speechService.playEarcon('fixApplied');

        const resolvedColor =
          customColor || targetShot.proposedFix?.targetColor || 'blue';
        const resolvedObject = targetShot.proposedFix?.targetObject || 'object';

        const confirmationMessage = `Shot ${updatedShot.shotNumber}: ${resolvedObject} recolored to ${resolvedColor} via SAM 3.1 mask ${updatedShot.pixelVerification?.maskRef || ''} with 0 outside-mask pixel drift. Continuity ${updatedShot.status}.`;

        setProjectState((prev) => prev.projectId !== projectId ? prev : !sourceMatches(prev) ? { ...prev, statusAnnouncement: staleMessage } : ({
          ...prev,
          shots: prev.shots.map((s) => (s.id === shotId ? updatedShot : s)),
          activeShotId: shotId,
          statusAnnouncement: confirmationMessage,
        }));

        speechService.speak(confirmationMessage, true);
      } catch (error) {
        const message = `Continuity fix failed: ${error instanceof Error ? error.message : String(error)}`;
        setProjectState((prev) => prev.projectId === projectId ? ({ ...prev, statusAnnouncement: message }) : prev);
        speechService.speak(message, true);
      } finally {
        setProjectState((prev) => prev.projectId === projectId ? ({ ...prev, isProcessing: false }) : prev);
      }
    },
    [projectState.shots, projectState.rules]
  );

  // Disambiguate an uncertain SAM 3.1 candidate selection (`POST /api/masks/disambiguate`)
  const handleDisambiguateShot = useCallback(async (shotId:string,selectedObjectId:string)=>{
    const targetShot=projectState.shots.find(shot=>shot.id===shotId);
    if(!targetShot||projectState.isProcessing)return;
    const projectId=projectState.projectId;
    candidateRequest.current?.abort();
    const controller=new AbortController();candidateRequest.current=controller;
    const unchanged=(state:ProjectState)=>state.projectId===projectId&&state.shots.find(shot=>shot.id===shotId)===targetShot;
    try{
      const updatedShot=await metaModelClient.disambiguateMaskSelection(targetShot,selectedObjectId,controller.signal);
      if(controller.signal.aborted||candidateRequest.current!==controller)return;
      if(!unchanged(currentProjectRef.current)){
        if(currentProjectRef.current.projectId===projectId)announceStatus('The scene changed. Confirm the object again.');
        return;
      }
      const message=`Ambiguity resolved on Shot ${updatedShot.shotNumber}. Selected object ${selectedObjectId}. Continuity is ${updatedShot.status}.`;
      setProjectState(prev=>unchanged(prev)?{...prev,shots:prev.shots.map(shot=>shot.id===shotId?updatedShot:shot),activeShotId:shotId,statusAnnouncement:message}:prev);
      speechService.playEarcon('fixApplied');speechService.speak(message,true);
    }catch(error){
      if(!controller.signal.aborted&&currentProjectRef.current.projectId===projectId)announceStatus(`Selection failed: ${(error as Error).message}`);
    }finally{if(candidateRequest.current===controller)candidateRequest.current=null;}
  },[projectState.shots,projectState.projectId,projectState.isProcessing,announceStatus]);

  // Segment the selected frame, including generated media. Never claim a fixture is a live mask.
  const handleSegmentObjectManual = useCallback(async (shotId: string, targetObject: string) => {
    const shot = projectState.shots.find(value => value.id === shotId);
    if (!shot || projectState.isProcessing) return;
    const rule = projectState.rules.find(value => value.targetObject === targetObject && value.property === 'color');
    setProjectState(prev => ({ ...prev, isProcessing: true, statusAnnouncement: `Selecting ${targetObject} in Shot ${shot.shotNumber}...` }));
    try {
      const mask = await metaModelClient.segmentObjectWithSam3(shot.shotNumber, targetObject, undefined, undefined, rule?.revision ?? 1, shot.currentImageUrl);
      if (isGeneratedShot(shot) && mask.provenance !== 'live-sam-3.1') throw new Error('No real segmentation provider is connected for this frame. A sample mask cannot select its object.');
      setShowSamMaskOverlay(true);
      setProjectState(prev => ({ ...prev, shots: prev.shots.map(value => value.id === shotId ? {
        ...value, status: 'uncertain', proposedFix: {action:'recolor',targetObject,targetColor:rule?.expectedValue ?? 'blue',mask,candidates:mask.candidates},
      } : value), statusAnnouncement: mask.provenance === 'live-sam-3.1'
        ? `SAM returned ${mask.candidateCount ?? 1} candidate masks for ${targetObject}. Confirm the selection before correction.`
        : `Sample ${targetObject} mask selected. No live segmentation was used.` }));
    } catch (error) {
      announceStatus(`Selection failed: ${(error as Error).message}`);
    } finally { setProjectState(prev => ({...prev,isProcessing:false})); }
  }, [projectState.shots, projectState.rules, projectState.isProcessing, announceStatus]);

  // Restore a take's media; old colour verdicts do not survive a take change.
  const handleRevertShotRevision = useCallback((shotId: string, revisionId: string) => {
    const shot = projectState.shots.find(value => value.id === shotId);
    if (!shot || projectState.isProcessing) return;
    try {
      const restored = restoreShotTake(shot, revisionId);
      setProjectState(prev => ({ ...prev, isPlayingAnimatic:false,
        shots:prev.shots.map(value => value.id === shotId ? restored : value),
        statusAnnouncement: restored === shot ? `This take is already in use on Shot ${shot.shotNumber}.` : `Restored Shot ${shot.shotNumber}. Continuity needs review.` }));
    } catch (error) { announceStatus((error as Error).message); }
  }, [projectState.shots, projectState.isProcessing, announceStatus]);

  // Save scene metadata without replacing selected media or masks.
  const handleUpdateShotPrompt = useCallback((shotId: string, newPrompt: string, newDuration: number) => {
    const target = projectState.shots.find(shot => shot.id === shotId);
    if (!target || projectState.isProcessing) return;
    try {
      const updated = updateShotDetails(target, newPrompt, newDuration);
      setCurrentTimeSeconds(0);
      setProjectState(prev => ({ ...prev, isPlayingAnimatic: false,
        shots: prev.shots.map(shot => shot.id === shotId ? updated : shot),
        statusAnnouncement: `Saved Shot ${target.shotNumber}. Image and masks were not regenerated.` }));
    } catch (error) { announceStatus((error as Error).message); }
  }, [projectState.shots, projectState.isProcessing, announceStatus]);

  const handleUseLocalImage = useCallback((shotId: string, imageUrl: string, prompt: string) => {
    if (!isLocalImage(imageUrl)) return;
    setProjectState(prev => ({...prev, isPlayingAnimatic: false, shots: prev.shots.map(shot => shot.id === shotId ? {
      ...shot, currentImageUrl: imageUrl, promptDescription: prompt, status: 'uncertain', mediaSource: 'generated',
      videoUrl: undefined, generatedJobId: undefined, videoMaskPlan: undefined, detectedObjects: undefined,
      proposedFix: undefined, discrepancyMessage: undefined, pixelVerification: undefined,
      spokenDescription: `Shot ${shot.shotNumber}. ${prompt}. Local AI image; continuity unreviewed.`,
      revisions: [...shot.revisions, {revisionId: `local-${Date.now()}`, timestamp: Date.now(), imageUrl, mediaSource: 'generated', actionApplied: 'Local SD1.5 image; unreviewed'}],
    } : shot), statusAnnouncement: 'Local image applied. Continuity remains unreviewed.'}));
    setShowSamMaskOverlay(false);
  }, []);

  const handleUpdateNarration=useCallback((shotId:string,value:NarrationAttachment|null)=>{
    if(value&&(!validNarrationUrl(value.dataUrl)||!Number.isFinite(value.durationSeconds)||value.durationSeconds<=0||value.durationSeconds>14.6))return;
    setProjectState(prev=>prev.projectId!==projectState.projectId?prev:{...prev,shots:prev.shots.map(shot=>shot.id!==shotId?shot:{...shot,narrationDataUrl:value?.dataUrl,narrationName:value?.name,narrationDurationSeconds:value?.durationSeconds,durationSeconds:value?Math.max(shot.durationSeconds,Math.ceil((value.durationSeconds+.4)*10)/10):shot.durationSeconds})});
  },[projectState.projectId]);

  const handleUpdateVideoMasks = useCallback((shotId:string,jobId:string,plan:VideoTrackPlan)=>{
    setProjectState(prev=>prev.projectId!==projectState.projectId || plan.sourceJobId!==jobId ? prev : {...prev,shots:prev.shots.map(shot=>shot.id!==shotId || shot.generatedJobId!==jobId ? shot : {...shot,videoMaskPlan:plan,revisions:shot.revisions.map(take=>take.generatedJobId===jobId?{...take,videoMaskPlan:plan}:take)})});
  },[projectState.projectId]);

  const handleUseLocalVideo = useCallback((shotId: string, videoUrl: string, prompt: string, jobId: string, expectedSourceJobId?:string) => {
    const frameImg = `/api/local-ai/jobs/${jobId}/assets/frame-000.png`;
    setProjectState(prev => prev.projectId !== projectState.projectId || !prev.shots.some(shot=>shot.id===shotId && (!expectedSourceJobId || shot.generatedJobId===expectedSourceJobId)) ? prev : ({ ...prev, isPlayingAnimatic: false,
      shots: prev.shots.map(shot => shot.id !== shotId || (expectedSourceJobId && shot.generatedJobId!==expectedSourceJobId) ? shot : {
        ...shot, videoMaskPlan: undefined, videoUrl, generatedJobId: jobId, mediaSource: 'generated', currentImageUrl: frameImg, continuityChecks: undefined,
        promptDescription: prompt, timestamp: 0, status: 'uncertain',
        proposedFix: undefined, discrepancyMessage: undefined, pixelVerification: undefined, detectedObjects: undefined,
        spokenDescription: `Shot ${shot.shotNumber}. ${prompt}. Local video; continuity unreviewed.`,
        revisions: [...shot.revisions, { revisionId: `video-${Date.now()}`, timestamp: Date.now(), imageUrl: frameImg, videoUrl, generatedJobId: jobId, sourceTime: 0, mediaSource: 'generated', actionApplied: 'Local video applied to this shot; unreviewed' }],
      }), statusAnnouncement: 'Video applied to the selected shot. Continuity needs review.' }));
    setShowSamMaskOverlay(false);
  }, [projectState.projectId]);

  const handleGenerativeEdit = useCallback(async (shotId: string, prompt: string, objectId?: string) => {
    const targetShot = projectState.shots.find((s) => s.id === shotId);
    if (!targetShot) throw new Error('Select a scene before editing.');
    if (generativeEditRequest.current || projectState.isProcessing) throw new Error('Wait for the current operation to finish.');
    const projectId=projectState.projectId;
    const controller=new AbortController();
    generativeEditRequest.current=controller;
    const sourceMatches=(state:ProjectState)=>state.projectId===projectId && state.shots.some(shot=>shot.id===shotId && shot.currentImageUrl===targetShot.currentImageUrl && shot.generatedJobId===targetShot.generatedJobId && shot.revisions.length===targetShot.revisions.length && shot.proposedFix?.mask?.maskRef===targetShot.proposedFix?.mask?.maskRef);


    orcaTracker.trackAction('generation', `Generative edit requested for Shot ${targetShot.shotNumber}: "${prompt}"`, { shotId, prompt, objectId });
    setProjectState((prev) => ({
      ...prev,
      isProcessing: true,
      statusAnnouncement: `Generating a masked edit: "${prompt}"...`,
    }));

    try {
      const selectedObj = targetShot.detectedObjects?.find((o: any) => o.objectId === objectId || o.id === objectId);
      const mask = targetShot.proposedFix?.mask;
      if (!mask?.maskBase64 || (objectId && mask.objectId !== objectId)) throw new Error('Select and confirm this object mask in the current frame first.');
      if (mask.sourceImageUrl !== targetShot.currentImageUrl) throw new Error('This mask belongs to another frame or has no source. Select the object in the current frame again.');
      if (isGeneratedShot(targetShot) && mask.provenance !== 'live-sam-3.1') throw new Error('A real object mask is required for this generated frame. Sample masks cannot be used.');
      if ((mask.candidateCount ?? 1) > 1) throw new Error('Multiple objects match. Confirm one object before editing.');
      const res = await metaModelClient.editFrameGenerative(
        targetShot.currentImageUrl,
        prompt,
        targetShot.proposedFix?.mask?.maskBase64,
        selectedObj?.bounds,
        controller.signal
      );

      controller.signal.throwIfAborted();
      if (!sourceMatches(currentProjectRef.current)) throw new Error('The scene changed while editing. The result was not applied.');
      const updatedImageUrl = res.editedImageUrl;
      setProjectState((prev) => !sourceMatches(prev) ? prev : ({
        ...prev,
        isProcessing: false,
        shots: prev.shots.map((shot) =>
          shot.id === shotId
            ? {
                ...shot,
                currentImageUrl: updatedImageUrl,
                status: 'uncertain', mediaSource: 'generated',
                videoUrl: undefined, generatedJobId: undefined, videoMaskPlan: undefined, detectedObjects: undefined, proposedFix: undefined, discrepancyMessage: undefined,
                pixelVerification: {
                  passed: res.verified,
                  changedInside: res.changedInside,
                  changedOutside: res.outsideDrift,
                  selectedPixels: res.selectedPixels,
                  totalPixels: res.totalPixels,
                  selectedMaskPixels: res.selectedPixels,
                  changedInsideMask: res.changedInside,
                  changedOutsideMask: res.outsideDrift,
                  outsideDriftPercent: Number(res.outsideDriftPercent) || 0,
                  verifiedAt: Date.now(),
                  ruleRevision: 1,
                  maskRef: targetShot.proposedFix!.mask!.maskRef,
                },
                revisions: [
                  ...shot.revisions,
                  {
                    revisionId: `gen-edit-${Date.now()}`,
                    timestamp: Date.now(),
                    imageUrl: updatedImageUrl, mediaSource: 'generated',
                    actionApplied: `Generative edit: ${prompt} (${res.outsideDrift} outside pixels changed; continuity unreviewed)`,
                  },
                ],
              }
            : shot
        ),
        statusAnnouncement: `Masked edit applied: ${res.changedInside} selected pixels changed, ${res.outsideDrift} outside. Continuity needs review.`,
      }));
    } catch (err: any) {
      setProjectState((prev) => prev.projectId!==projectId ? prev : ({
        ...prev,
        statusAnnouncement: `Generative edit failed: ${err.message}`,
      }));
      throw err;
    } finally {
      if(generativeEditRequest.current===controller)generativeEditRequest.current=null;
      setProjectState((prev) => prev.projectId!==projectId ? prev : ({ ...prev, isProcessing: false }));
    }
  }, [projectState.shots, projectState.projectId, projectState.isProcessing]);

  // Spoken object edit: find the named object with SAM, then change only its pixels.
  const handleEditObject = useCallback(async (object: string, instruction: string, shotNumber?: number) => {
    const source = currentProjectRef.current;
    const shot = shotNumber ? source.shots.find((s) => s.shotNumber === shotNumber) : source.shots.find((s) => s.id === source.activeShotId) ?? source.shots[0];
    if (!shot) return shotNumber ? `There is no shot ${shotNumber}.` : 'There is no shot to edit yet.';
    if (source.isProcessing) return 'Wait for the current operation to finish.';
    const sourceImage = shot.currentImageUrl;
    const unchanged = (state: ProjectState) => state.projectId === source.projectId && state.shots.find((s) => s.id === shot.id)?.currentImageUrl === sourceImage;
    setProjectState((prev) => ({ ...prev, isProcessing: true, activeShotId: shot.id, statusAnnouncement: `Finding the ${object} in Shot ${shot.shotNumber}...` }));
    try {
      const mask = await metaModelClient.segmentObjectWithSam3(shot.shotNumber, object, undefined, undefined, 1, sourceImage);
      if (mask.provenance !== 'live-sam-3.1' || !mask.maskBase64) throw new Error(`The ${object} could not be found in Shot ${shot.shotNumber}. Nothing was changed.`);
      setProjectState((prev) => ({ ...prev, statusAnnouncement: `Changing the ${object} in Shot ${shot.shotNumber}...` }));
      const res = await metaModelClient.editFrameGenerative(sourceImage, `${instruction}. Change only the ${object}. Keep the rest of the image identical.`, mask.maskBase64);
      if (!unchanged(currentProjectRef.current)) return 'The shot changed during the edit, so the result was not applied.';
      const message = `Changed the ${object} in Shot ${shot.shotNumber}. ${res.outsideDrift} pixels outside it changed. Continuity needs review.`;
      setProjectState((prev) => !unchanged(prev) ? prev : {
        ...prev,
        statusAnnouncement: message,
        shots: prev.shots.map((s) => s.id !== shot.id ? s : {
          ...s, currentImageUrl: res.editedImageUrl, status: 'uncertain', mediaSource: 'generated',
          videoUrl: undefined, generatedJobId: undefined, videoMaskPlan: undefined, detectedObjects: undefined, proposedFix: undefined, discrepancyMessage: undefined,
          revisions: [...s.revisions, { revisionId: `voice-edit-${Date.now()}`, timestamp: Date.now(), imageUrl: res.editedImageUrl, mediaSource: 'generated', actionApplied: `Object edit: ${object}, ${instruction}; continuity unreviewed` }],
        }),
      });
      speechService.playEarcon('fixApplied');
      return message;
    } catch (error) {
      const message = `The edit failed: ${(error as Error).message}`;
      setProjectState((prev) => ({ ...prev, statusAnnouncement: message }));
      return message;
    } finally {
      setProjectState((prev) => prev.projectId === source.projectId ? { ...prev, isProcessing: false } : prev);
    }
  }, []);

  // Meta muse-spark-1.3 video continuity analysis: inspect the rendered sequence and
  // suggest real continuity fixes evaluated against the project's ContinuityRule records.
  const handleAnalyzeVideoContinuity = useCallback(async (shotId: string) => {
    const targetShot = projectState.shots.find((s) => s.id === shotId);
    if (!targetShot || projectState.isProcessing || videoReviewRequest.current) return;
    if (!targetShot.videoUrl && !targetShot.generatedJobId) {
      announceStatus('No generated video available for this shot. Render a video first, then analyze continuity.', true);
      return;
    }

    const projectId=projectState.projectId;
    const index=projectState.shots.findIndex(shot=>shot.id===shotId);
    const rulesSnapshot=JSON.stringify(projectState.rules);
    const sourceMatches=(state:ProjectState)=>state.projectId===projectId && JSON.stringify(state.rules)===rulesSnapshot && state.shots[index]?.id===shotId && state.shots[index]?.generatedJobId===targetShot.generatedJobId && state.shots[index]?.videoUrl===targetShot.videoUrl && state.shots[index]?.currentImageUrl===targetShot.currentImageUrl;
    const controller=new AbortController();videoReviewRequest.current=controller;
    setProjectState((prev) => ({
      ...prev,
      isProcessing: true,
      statusAnnouncement: 'Reviewing saved local video evidence...',
    }));

    try {
      const analysis = await metaModelClient.understandVideoWithMuseSpark(
        targetShot.videoUrl,
        projectState.transcript,
        targetShot.generatedJobId,
        projectState.rules,
        index,
        controller.signal
      );
      controller.signal.throwIfAborted();
      if(!sourceMatches(currentProjectRef.current))throw new Error('The video or its rules changed. Run the review again.');
      // This endpoint reviewed one source, so findings cannot address other scenes.
      analysis.findings=analysis.findings.filter(f=>f.shotIndex===index);
      const flagged = analysis.findings.filter((f) => f.status === 'mismatch' || f.status === 'uncertain');
      setProjectState((prev) => {
        if(!sourceMatches(prev))return prev;
        const shots = applyVideoFindingsToShots(prev.shots, analysis.findings, analysis.detectedObjects);
        const firstFlaggedIdx = analysis.findings.findIndex((f) => f.status !== 'consistent');
        const activeShotId =
          firstFlaggedIdx >= 0 && shots[analysis.findings[firstFlaggedIdx].shotIndex]
            ? shots[analysis.findings[firstFlaggedIdx].shotIndex].id
            : prev.activeShotId;
        const summary =
          flagged.length > 0
            ? `Local video review: ${flagged.length} unverified rule finding${flagged.length > 1 ? 's' : ''}. ${flagged[0].explanation}`
            : 'No verified video continuity measurements are available. The video still needs review.';
        speechService.speak(summary, true);
        return { ...prev, shots, activeShotId, statusAnnouncement: summary };
      });
    } catch (err) {
      const message = `Video continuity analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      setProjectState((prev) => prev.projectId!==projectId?prev:({ ...prev, statusAnnouncement: message }));
      if(currentProjectRef.current.projectId===projectId&&!controller.signal.aborted)speechService.speak(message, true);
    } finally {
      if(videoReviewRequest.current===controller)videoReviewRequest.current=null;
      setProjectState((prev) => prev.projectId!==projectId?prev:({ ...prev, isProcessing: false }));
    }
  }, [projectState.shots, projectState.transcript, projectState.rules, projectState.projectId, projectState.isProcessing, announceStatus]);

  const handleUpdateDetectedObjects = useCallback((shotId: string, objects: NonNullable<StoryboardShot["detectedObjects"]>, jobId: string) => {
    orcaTracker.trackAction('sam', `Local proposal scan returned ${objects.length} regions for Shot ${shotId}`, { count: objects.length, objects });
    setProjectState(prev => {
      if (prev.projectId !== projectState.projectId || !prev.shots.some(shot => shot.id === shotId && shot.generatedJobId === jobId)) return prev;
      return { ...prev, shots: prev.shots.map(shot => shot.id === shotId ? { ...shot, detectedObjects: objects } : shot),
        statusAnnouncement: `Found ${objects.length} local region proposals. Object identity and tracking are unverified.` };
    });
  }, [projectState.projectId]);

  const handleRefreshVideoUrl = useCallback((shotId: string, newVideoUrl: string,
    modReport?: { outsideDrift?: number; totalPixelsRecolored?: number; color?: string; framesModified?: number }) => {
    setProjectState(prev => ({ ...prev, shots: prev.shots.map(shot => shot.id !== shotId ? shot : {
      ...shot, videoUrl: newVideoUrl, status: 'uncertain', pixelVerification: undefined,
      proposedFix: undefined, discrepancyMessage: undefined, detectedObjects: undefined,
      currentImageUrl: shot.generatedJobId ? `/api/local-ai/jobs/${shot.generatedJobId}/assets/frame-000.png?rev=${Date.now()}` : shot.currentImageUrl,
    }), statusAnnouncement: `Video updated${modReport?.framesModified ? ` (${modReport.framesModified} frames)` : ''}. Encoded video continuity needs review.` }));
  }, []);

  // Add or update a ContinuityRule and re-audit all shots
  const handleAddOrUpdateRule = useCallback(
    async (targetObject: string, expectedValue: string) => {
      const source = currentProjectRef.current;
      const sourceMatches = (state: ProjectState) => state.projectId === source.projectId
        && state.shots === source.shots && state.rules === source.rules;
      const staleMessage = 'The sequence changed during the rule update. Your edits were kept; try the rule again.';
      const newRule: ContinuityRule = {
        id: `rule-${targetObject}-color`,
        scope: 'all_shots',
        targetObject,
        property: 'color',
        expectedValue,
        revision: (source.rules.find(rule => rule.targetObject === targetObject && rule.property === 'color')?.revision ?? 0) + 1,
      };

      setProjectState((prev) => ({
        ...prev,
        isProcessing: true,
        statusAnnouncement: `Updated continuity rule: ${targetObject}.color must be ${expectedValue}. Re-auditing all shots with muse-spark-1.3 and SAM 3.1...`,
      }));

      let updatedShots: StoryboardShot[];
      try {
        updatedShots = await metaModelClient.auditAllShots(source.shots,
          [newRule, ...source.rules.filter(rule => rule.id !== newRule.id)]);
        if (!sourceMatches(currentProjectRef.current)) throw new Error(staleMessage);
      } catch (error) {
        setProjectState(prev => prev.projectId === source.projectId ? ({ ...prev, isProcessing: false }) : prev);
        if (currentProjectRef.current.projectId === source.projectId) announceStatus(`Rule update failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }

      const mismatchCount = updatedShots.filter((s) => s.status === 'mismatch').length;
      speechService.playEarcon(mismatchCount > 0 ? 'mismatch' : 'consistent');

      const msg = `Continuity rule updated: ${targetObject} color = ${expectedValue}. ${mismatchCount} shots flagged for SAM 3.1 recolor.`;
      setProjectState((prev) => prev.projectId !== source.projectId ? prev : !sourceMatches(prev) ? { ...prev, isProcessing: false, statusAnnouncement: staleMessage } : ({
        ...prev,
        isProcessing: false,
        rules: [newRule, ...prev.rules.filter((r) => r.id !== newRule.id)],
        shots: updatedShots,
        statusAnnouncement: msg,
      }));
      speechService.speak(msg, true);
      return updatedShots;
    },
    [announceStatus]
  );

  // Run Full Sequence Continuity Audit (`muse-spark-1.3` + `sam-3.1`)
  const handleRunFullAudit = useCallback(async () => {
    const projectId = projectState.projectId;
    const sourceMatches = (state: ProjectState) => state.projectId === projectId
      && state.shots === projectState.shots && state.rules === projectState.rules;
    const staleMessage = 'The sequence changed during the continuity check. Your edits were kept; run the check again.';
    const primaryRule = projectState.rules[0];
    if (!primaryRule) {
      announceStatus('There are no continuity rules to check. Say which prop must stay which colour, for example the jacket must be emerald.', true);
      return;
    }

    setProjectState((prev) => ({
      ...prev,
      isProcessing: true,
      statusAnnouncement: 'Running SAM 3.1 continuity audit across sequence...',
    }));

    let auditedShots: StoryboardShot[];
    try {
      auditedShots = await metaModelClient.auditAllShots(projectState.shots, projectState.rules);
    } catch (error) {
      setProjectState((prev) => ({ ...prev, isProcessing: false }));
      announceStatus(`The continuity check failed: ${error instanceof Error ? error.message : String(error)}`, true);
      return;
    }

    if (!sourceMatches(currentProjectRef.current)) {
      setProjectState(prev => prev.projectId === projectId
        ? { ...prev, isProcessing: false, statusAnnouncement: staleMessage } : prev);
      return;
    }

    const unreviewed = auditedShots.filter((s) => s.status === 'uncertain').length;
    const mismatches = auditedShots.filter((s) => s.status === 'mismatch');
    const firstMismatch = mismatches[0];
    const message = unreviewed
      ? `${unreviewed} shots require candidate selection. Their continuity has not been verified.`
      : !firstMismatch
      ? `Continuity Audit Complete: All ${auditedShots.length} shots pass the active colour checks.`
      : `Continuity Audit found ${mismatches.length} discrepancy. Focused on Shot ${firstMismatch.shotNumber}: ${firstMismatch.discrepancyMessage} Press Y to apply SAM 3.1 fix.`;
    setProjectState(prev => {
      if (prev.projectId !== projectId) return prev;
      // Recheck in the updater too: another edit may already be queued by React.
      if (!sourceMatches(prev)) return { ...prev, isProcessing: false, statusAnnouncement: staleMessage };
      return {
        ...prev, isProcessing: false, shots: auditedShots, statusAnnouncement: message,
        activeShotId: !unreviewed && firstMismatch ? firstMismatch.id : prev.activeShotId,
      };
    });
    speechService.playEarcon(unreviewed ? 'focus' : firstMismatch ? 'mismatch' : 'consistent');
    speechService.speak(message, true);
  }, [projectState.shots, projectState.rules, projectState.projectId, announceStatus]);

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
      const intent = parseVoiceCommand(trimmed);
      // Commands can also arrive from the voice agent, outside disabled form controls.
      if (currentProjectRef.current.isProcessing && !['playback', 'help', 'narrate', 'invalid_command'].includes(intent.kind)) {
        announceStatus('Wait for the current edit to finish before starting another change.', true);
        return;
      }
      if (!projectState.shots.length) {
        await handleRebuildFromTranscript(true, trimmed);
        return;
      }

      if ('shotNumber' in intent && intent.shotNumber && !projectState.shots.some((s) => s.shotNumber === intent.shotNumber)) {
        announceStatus(`There is no shot ${intent.shotNumber}.`, true);
        return;
      }

      try {
      switch (intent.kind) {
        case 'invalid_command':
          announceStatus(intent.message, true);
          return;
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

          // A named shot changes alone; otherwise the colour applies to the whole film.
          const candidates = intent.shotNumber
            ? reaudited.filter((s) => s.id === targetShot.id)
            : reaudited.filter((s) => s.status === 'mismatch');
          const targets = candidates.filter((s) => s.proposedFix?.targetObject === targetObject && !isLocalImage(s.currentImageUrl));
          const unconfirmed = reaudited.filter((s) => s.status === 'uncertain').length;
          if (!targets.length) {
            announceStatus(
              `Nothing was recoloured. The ${targetObject} rule is now ${intent.color}${unconfirmed ? `, and ${unconfirmed} shots could not be confirmed` : ''}.`,
              true
            );
            return;
          }

          const revision = (projectState.rules.find(rule => rule.targetObject === targetObject && rule.property === 'color')?.revision ?? 0) + 1;
          setShowBeforeComparison(false);
          setProjectState((prev) => ({ ...prev, isProcessing: true }));
          let recoloured = 0;
          let failed = 0;
          try {
            for (const [index, shot] of targets.entries()) {
              setGenerationPercent(Math.round((index / targets.length) * 100));
              setProjectState((prev) => ({
                ...prev,
                statusAnnouncement: `Recolouring the ${targetObject} in Shot ${shot.shotNumber}, ${index + 1} of ${targets.length}...`,
              }));
              try {
                const updated = await metaModelClient.applyContinuityFix(shot, intent.color, revision);
                recoloured++;
                setProjectState((prev) => ({
                  ...prev,
                  shots: prev.shots.map((s) => (s.id === updated.id ? updated : s)),
                }));
              } catch {
                failed++;
              }
            }
          } finally {
            setGenerationPercent(undefined);
            setProjectState((prev) => ({ ...prev, isProcessing: false }));
          }
          speechService.playEarcon(failed ? 'mismatch' : 'fixApplied');
          announceStatus(
            `Recoloured the ${targetObject} to ${intent.color} in ${recoloured} of ${targets.length} shots.${failed ? ` ${failed} failed.` : ''}${unconfirmed ? ` ${unconfirmed} could not be confirmed.` : ''}`,
            true
          );
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

          if (intent.object && intent.color) {
            await handleAddOrUpdateRule(intent.object, intent.color);
          }

          await handleApplyProposedFix(targetShot.id, intent.color);
          return;
        }

        case 'modify_video': {
          const targetShot=activeShot,jobId=targetShot?.generatedJobId;
          if(!targetShot?.videoUrl||!jobId){announceStatus('Select a generated video scene before correcting its objects.',true);return;}
          const projectId=projectState.projectId;
          setProjectState(prev=>({...prev,isProcessing:true,statusAnnouncement:`Checking approved ${intent.object} masks...`}));
          try{
            const result=await correctReviewedVideoObject(jobId,targetShot.videoMaskPlan,intent.object,intent.color,AbortSignal.timeout(90000));
            handleUseLocalVideo(targetShot.id,result.videoUrl,targetShot.promptDescription,result.id,jobId);
          }catch(error){
            const message=error instanceof Error?error.message:'Video correction failed.';
            setProjectState(prev=>prev.projectId===projectId?{...prev,statusAnnouncement:message}:prev);
            speechService.speak(message);
          }finally{setProjectState(prev=>prev.projectId===projectId?{...prev,isProcessing:false}:prev);}
          return;
        }

        case 'generative_edit': {
          const targetShot = activeShot || projectState.shots[0];
          if (!targetShot) {
            announceStatus('No shot selected for generative edit.', true);
            return;
          }
          try {
            await handleGenerativeEdit(targetShot.id, intent.prompt, intent.object);
          } catch (error) {
            // Inspector callers consume the rejection themselves; commands must do so too.
            announceStatus(`Generative edit failed: ${error instanceof Error ? error.message : String(error)}`, true);
          }
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
      } catch (error) {
        // Button submissions do not await this callback; consume failed rule/audit
        // operations here instead of leaving an unhandled rejection.
        announceStatus(`Command failed: ${error instanceof Error ? error.message : String(error)}`, true);
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
      handleUseLocalVideo,
      projectState.projectId,
      announceStatus,
    ]
  );

  // Dictation uses the configured server provider; unconfigured mode stays local.
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
      unavailable('transcription is not connected or microphone recording is unavailable.');
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

  // A hidden tab cannot keep canvas, media and spoken narration synchronized.
  useEffect(() => {
    const pauseHidden = () => {
      if (!document.hidden) return;
      speechService.stopSpeaking();
      setProjectState(previous => previous.isPlayingAnimatic ? {...previous,
        isPlayingAnimatic:false, statusAnnouncement:'Preview paused while this tab is hidden. Press Play to continue.'} : previous);
    };
    document.addEventListener('visibilitychange',pauseHidden);
    pauseHidden();
    return () => document.removeEventListener('visibilitychange',pauseHidden);
  }, [projectState.isPlayingAnimatic]);

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
              if(shot.narrationDataUrl)speechService.stopSpeaking();
              else speechService.speak(shot.spokenDescription, true);
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

  const handleProjectArchive = async (file?: File) => {
    if(archiveLock.current || !storageReady || projectState.isProcessing || isExportingVideo || switchingProject.current)return;
    archiveLock.current=true;setArchiveBusy(true);setArchiveMessage(file?'Restoring projectÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦':'Preparing backupÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦');
    speechRecognitionService.cancelListening();
    speechService.stopSpeaking();
    try {
      const {collectProjectArchive,serializeProjectArchive,restoreProjectArchive}=await import('./services/projectArchive');
      await flushLocalSaves();
      if(file) {
        if(file.size>200*1024*1024)throw new Error('Project backup exceeds the 200 MB limit.');
        const result=await restoreProjectArchive(await file.text());
        setSessionProjects(result.library.projects);
        setProjectState(result.project);
        setCurrentTimeSeconds(0);setDirectionDraft('');setVoiceNotice(null);
        setArchiveMessage(result.warning||'Project restored as a separate copy.');
      }else{
        const dream=await loadLocal(`dream:${projectState.projectId}`);
        const archive=await collectProjectArchive(projectState,dream);
        const url=URL.createObjectURL(new Blob([serializeProjectArchive(archive)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${projectState.projectId}.anchorshot.json`;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),10000);
        setArchiveMessage('Project backup downloaded. Keep this file to restore scenes and masks.');
      }
    }catch(error){setArchiveMessage(error instanceof Error?error.message:'Project backup operation failed.');}
    finally{archiveLock.current=false;setArchiveBusy(false);}
  };

  // Export Project JSON
  const handleExportProjectJson = useCallback(() => {
    const exportPayload = {
      app: 'Anchorshot',
      mode: 'continuity-report',
      portableBackup: false,
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
        isPlayingAnimatic: false,
      }));
      setCurrentTimeSeconds(offset);

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
      const minimumDuration = target.narrationDurationSeconds
        ? Math.ceil((target.narrationDurationSeconds + 0.4) * 10) / 10 : 0.5;
      const newDuration = Math.max(minimumDuration, Math.min(15, Math.round((target.durationSeconds + delta) * 10) / 10));
      if (newDuration === target.durationSeconds) return;
      let edited: StoryboardShot;
      try { edited = updateShotDetails(target, target.promptDescription, newDuration); }
      catch (error) { announceStatus((error as Error).message); return; }
      const updated = projectState.shots.map((s) => s.id === shotId ? edited : s);

      setProjectState((prev) => ({
        ...prev,
        shots: updated,
        isPlayingAnimatic: false,
      }));
      setCurrentTimeSeconds(0);

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
    if (isExportingVideo || !projectState.shots.length) return;
    setIsExportingVideo(true);
    try {
      const audioLabel = projectState.shots.some(shot=>shot.narrationDataUrl) ? 'narrated' : projectState.shots.some(shot=>shot.videoUrl) ? 'video' : 'silent';
      announceStatus(`Rendering ${audioLabel} MP4 film${burnInTimecode ? ' with burn-in timecode' : ''}...`, false);
      const mp4 = await exportAnimaticMp4(projectState.shots, { burnInTimecode });
      const blob = mp4?.video ?? (await exportStoryboardAnimaticVideo(projectState.shots, projectState.title));
      if (!blob) throw new Error('This browser cannot record a WebM fallback. Install ffmpeg for MP4 export.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectState.projectId}-animatic.${mp4 ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announceStatus(mp4 ? `Exported ${audioLabel} MP4 film${burnInTimecode ? ' (BITC)' : ''}.` : 'MP4 export unavailable. Exported a silent WebM animatic instead.');
    } catch (error) {
      announceStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setIsExportingVideo(false); }
  }, [projectState.shots, projectState.title, projectState.projectId, burnInTimecode, announceStatus, isExportingVideo]);

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
      if(archiveLock.current)return;
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
      // Disabled buttons do not disable global shortcuts. A second mutation can
      // overwrite the first result and clear its processing flag prematurely.
      const changesScene = ['y', 'a', 'g', 't', '[', ']'].includes(key)
        || (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key));
      if (currentProjectRef.current.isProcessing && changesScene) {
        e.preventDefault();
        announceStatus('Wait for the current edit to finish before starting another change.', false);
        return;
      }

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
      <div inert={archiveBusy} style={{display:"contents"}}>
      <CleanStudio
        onPlaybackError={message=>{setProjectState(previous=>({...previous,isPlayingAnimatic:false,statusAnnouncement:message}));}}
        onBackupProject={()=>void handleProjectArchive()}
        onRestoreProject={file=>void handleProjectArchive(file)}
        archiveMessage={archiveMessage}
        key={projectState.projectId}
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
        progressPercent={generationPercent}
        playing={projectState.isPlayingAnimatic}
        time={currentTimeSeconds}
        duration={totalDurationSeconds}
        status={projectState.statusAnnouncement}
        muted={isMuted}
        onMute={handleToggleMute}
        onTranscript={(text) => setProjectState((prev) => ({ ...prev, transcript: text }))}
        onGenerate={() => void handleRebuildFromTranscript(true)}
        onGenerateFrom={(script) => handleRebuildFromTranscript(true, script)}
        onCommand={(text) => handleExecuteVoiceCommand(text)}
        onEditObject={handleEditObject}
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
            key={`${projectState.projectId}:${activeShot?.id ?? "empty"}`}
            onUseLocalImage={handleUseLocalImage}
            onUseLocalVideo={handleUseLocalVideo}
            onUpdateVideoMasks={handleUpdateVideoMasks}
            onUpdateNarration={handleUpdateNarration}
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
            onAddOrUpdateRule={(object, color) => { void handleAddOrUpdateRule(object, color).catch(() => {}); }}
          />
        }
        shortcuts={
          <KeyboardShortcutsModal
            isOpen={isShortcutsModalOpen}
            onClose={() => setIsShortcutsModalOpen(false)}
          />
        }
      />
      </div>
      {archiveBusy && <div role="status" className="fixed inset-0 z-50 grid place-items-center bg-black/80 text-white">{archiveMessage}</div>}
      {new URLSearchParams(location.search).has('debug') && <OrcaDiagnosticDrawer />}
    </>
  );
}
