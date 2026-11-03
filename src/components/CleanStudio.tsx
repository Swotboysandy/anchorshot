import {TimelineNarration} from './TimelineNarration';
import {DashboardLayout} from './DashboardLayout';
import { Tabs as BeTabs, TabsList as BeTabsList, TabsTrigger as BeTabsTrigger, TabsContent as BeTabsContent } from './ui/beui-tabs';
import { CreationComposer } from './CreationComposer';
import { VoiceOverlay } from './VoiceOverlay';
import type { AgentTools } from '../services/voiceAgent';
import { Progress } from './ui/progress';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Textarea } from './ui/textarea';

import {
  ArrowUpRight,
  ArrowUp,
  Mic,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Film,
  Layers,
  Check,
  Download,
  ChevronRight,
  Square,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { StudioTour } from './StudioTour';
import { DreamTransitionPanel } from './DreamTransitionPanel';
import { SceneTransition } from './SceneTransition';
import { transitionAt } from '../services/sceneTransitions';
import type { StoryboardShot } from '../types/framelock';
import { isLocalImage, isGeneratedImage } from '../services/localGeneration';

const hasVerifiedRepair = (shot: StoryboardShot) =>
  !isLocalImage(shot.currentImageUrl) && Boolean(shot.pixelVerification?.passed) &&
  shot.currentImageUrl !== shot.originalImageUrl;
import './cleanStudio.css';
type Props = {
  onBackupProject?:()=>void;
  onRestoreProject?:(file:File)=>void;
  archiveMessage?:string;
  storageStatus:string;
  projectId:string; projectTitle:string; projects:{id:string;title:string}[];
  onNewProject:()=>void; onOpenProject:(id:string)=>void; onRenameProject:(title:string)=>void;

  shots: StoryboardShot[];
  activeShot: StoryboardShot | null;
  transcript: string;
  processing: boolean;
  playing: boolean;
  time: number;
  duration: number;
  status: string;
  muted: boolean;
  progressPercent?: number;
  onTranscript: (s: string) => void;
  onGenerateFrom: (script: string) => Promise<string>;
  onGenerate: () => void;
  onCommand: (s: string) => void;
  onSelect: (id: string) => void;
  onPlay: () => void;
  onPlaybackError?: (message:string)=>void;
  onSeek: (t: number) => void;
  onNarrate: () => void;
  onMute: () => void;
  onExport: () => void;
  exporting: boolean;
  inspector: ReactNode;
  controls: ReactNode;
  onShortcuts: () => void;
  shortcuts: ReactNode;
  onAudit: () => void;
  showMask: boolean;
  showBefore: boolean;
  onExportJson: () => void;
  onExportCsv?: () => void;
  burnInTimecode?: boolean;
  onToggleBurnInTimecode?: () => void;
  splitPosition?: number;
  onSplitPositionChange?: (pos: number) => void;
  onCycleShotTake?: (shotId: string) => void;
  onReorderShot?: (shotId: string, direction: 'left' | 'right') => void;
  onNudgeDuration?: (shotId: string, delta: number) => void;
  draft: string;
  onDraft: (s: string) => void;
  listening: boolean;
  onToggleVoice: () => void;
  voiceNotice: string | null;
};
export function CleanStudio(p: Props) {
  const archiveInput=useRef<HTMLInputElement>(null);
  const [videoError,setVideoError]=useState('');
  const playbackError=useRef(p.onPlaybackError);playbackError.current=p.onPlaybackError;
  const [workspace, setWorkspace] = useState('create'),
    [inputMode, setInputMode] = useState('describe'),
    [focusDirection, setFocusDirection] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false);
  useEffect(()=>{setWorkspace('create');},[p.projectId]);
  const input = useRef<HTMLDivElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    if (!focusDirection || workspace !== 'create' || inputMode !== 'describe') return;
    const frame = requestAnimationFrame(() => {
      input.current?.querySelector('textarea')?.focus();
      setFocusDirection(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusDirection, workspace, inputMode]);
  const transition = transitionAt(
    p.shots.map((s) => s.durationSeconds),
    p.time,
    !reduced,
  );
  const hasStory = p.shots.length > 0;
  const firstMismatch = p.shots.find((s) => s.status === 'mismatch')?.shotNumber;
  const shot = p.playing ? p.shots[transition.index] : p.activeShot;
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [internalSplit, setInternalSplit] = useState(50);
  const [isWipeDragging, setIsWipeDragging] = useState(false);
  const currentSplit = p.splitPosition !== undefined ? p.splitPosition : internalSplit;

  const setSplit = useCallback(
    (pos: number) => {
      setInternalSplit(pos);
      p.onSplitPositionChange?.(pos);
    },
    [p.onSplitPositionChange]
  );

  const handleWipePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isWipeDragging || !previewFrameRef.current) return;
      const rect = previewFrameRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      setSplit(pct);
    },
    [isWipeDragging, setSplit]
  );

  const handleWipePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isWipeDragging) {
        setIsWipeDragging(false);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }
    },
    [isWipeDragging]
  );

  // Reject stale completions when the scene changes or the user pauses.
  useEffect(()=>{setVideoError('');},[shot?.videoUrl]);
  useEffect(() => {
    const video=videoRef.current;
    if(!video||!shot?.videoUrl)return;
    let active=true;
    if(p.playing && workspace==='create') {
      setVideoError('');
      void video.play().catch(()=>{
        if(!active||videoRef.current!==video)return;
        video.pause();
        const message='Video playback could not start. Press Play to retry or restore the source video.';
        setVideoError(message);playbackError.current?.(message);
      });
    }else video.pause();
    return()=>{active=false;video.pause();};
  },[p.playing,shot?.videoUrl,workspace]);

  // Synchronize master timeline seek position with video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shot?.videoUrl || !p.shots.length) return;

    // Calculate start offset of this shot within the total timeline
    let shotStartSeconds = 0;
    for (const s of p.shots) {
      if (s.id === shot.id) break;
      shotStartSeconds += s.durationSeconds;
    }

    const shotOffset = p.time - shotStartSeconds;
    if (shotOffset >= 0 && video.duration && !isNaN(video.duration)) {
      const targetTime = ((shot.timestamp ?? 0) + shotOffset) % video.duration;
      if (Math.abs(video.currentTime - targetTime) > 0.3) {
        video.currentTime = targetTime;
      }
    }
  }, [p.time, shot?.id, shot?.videoUrl, p.shots]);
  const selectWorkspace = (value: string) => {
    if (p.playing) p.onPlay();
    setWorkspace(value);
  };

  // Real studio actions the voice agent may call; each returns what happened so the agent can say it.
  const spokenDirection = useRef('');
  useEffect(() => {
    // This bridge exists only until the spoken script reaches React state.
    // Retaining it afterward would override a later manual script edit.
    if (spokenDirection.current === p.transcript) spokenDirection.current = '';
  }, [p.transcript]);
  const latestStatus = useRef(p.status);
  latestStatus.current = p.status;
  // Results are shown briefly as well as announced, so a finished action is visible.
  const [notice, setNotice] = useState('');
  const saveFailed = !['Saved locally', 'Saving locally...', 'Loading local projects...', 'Switching projects...'].includes(p.storageStatus);
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setNotice(p.status);
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [p.status]);
  const reviewTools = useRef<HTMLElement>(null);
  const agentTools: AgentTools = {
    set_direction: ({ text }) => {
      if (typeof text !== 'string' || !text.trim()) return 'No direction was given.';
      p.onTranscript(text.trim());
      spokenDirection.current = text.trim();
      return 'Direction saved to the script.';
    },
    generate_storyboard: async () => {
      if (p.processing) return 'A storyboard is already being generated.';
      // The script state may not have rendered yet when both tools run in one turn.
      const script = spokenDirection.current || p.transcript;
      spokenDirection.current = '';
      if (!script.trim()) return 'The script is empty, so nothing was generated. Ask the director for a scene.';
      return await p.onGenerateFrom(script);
    },
    run_command: async ({ command }) => {
      if (typeof command !== 'string' || !command.trim()) return 'No command was given.';
      await p.onCommand(command.trim());
      // Give the app a moment to publish the command's real result.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return latestStatus.current;
    },
    select_shot: ({ number }) => {
      const shot = p.shots.find((s) => s.shotNumber === Number(number));
      if (!shot) return `There is no shot ${number}.`;
      p.onSelect(shot.id);
      return shot.spokenDescription;
    },
    describe_storyboard: () =>
      p.shots.length
        ? p.shots.map((s) => `Shot ${s.shotNumber}, ${s.status}: ${s.promptDescription}`).join('\n')
        : 'The storyboard is empty.',
  };
  return (
    <div className={hasStory ? "clean-studio dark editor-shell" : "clean-studio dark"}>
      {shot?.narrationDataUrl && <TimelineNarration key={`${p.projectId}:${shot.id}:${shot.narrationDataUrl}`} src={shot.narrationDataUrl} offset={p.time-p.shots.slice(0,p.shots.findIndex(s=>s.id===shot.id)).reduce((sum,s)=>sum+s.durationSeconds,0)} playing={p.playing&&workspace==='create'} muted={p.muted} onPlaybackError={p.onPlaybackError}/>}
      <a className="clean-skip" href="#clean-main">
        Skip to workspace
      </a>
      <header className="clean-header">
        <button type="button" onClick={()=>selectWorkspace('create')} aria-label="Go to creation workspace" className="clean-brand">
          <span className="brand-symbol">
            <Square size={18} />
          </span>
          anchorshot<span className="brand-dot">.</span>
        </button>
        <nav className="project-navigation" aria-label="Project navigation">
          <select aria-label="Switch project" value={p.projectId} disabled={p.processing||p.exporting} onChange={event=>p.onOpenProject(event.target.value)}>
            {p.projects.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          {hasStory && <><ChevronRight size={12}/><button onClick={()=>selectWorkspace('create')}>Workspace</button><ChevronRight size={12}/><span aria-current="page">{workspace}</span></>}
        </nav>
        <div className="header-actions">
          {p.onRestoreProject && <details className="project-files"><summary>Files</summary><form onSubmit={event=>event.preventDefault()}>
            <Button type="button" variant="outline" size="sm" disabled={p.processing||p.exporting||!hasStory} onClick={p.onBackupProject}>Back up project</Button>
            <Button type="button" variant="outline" size="sm" disabled={p.processing||p.exporting} onClick={()=>archiveInput.current?.click()}>Restore backup</Button>
            <input ref={archiveInput} type="file" accept=".json,application/json" aria-label="Restore project backup" hidden onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)p.onRestoreProject?.(file);}}/>
          </form></details>}

          <Button variant="outline" size="sm" disabled={p.processing||p.exporting} onClick={p.onNewProject}>New project</Button>
          {hasStory && <details className="project-rename"><summary>Rename</summary><form onSubmit={event=>{event.preventDefault();const title=String(new FormData(event.currentTarget).get('title')||'').trim();if(title)p.onRenameProject(title);event.currentTarget.closest('details')?.removeAttribute('open');}}><input name="title" aria-label="Project name" defaultValue={p.projectTitle} key={p.projectTitle} maxLength={80} required/><Button size="sm" type="submit">Save name</Button></form></details>}

          <span className="local-label">
            <i /> {saveFailed ? 'Not saved locally' : p.storageStatus}
          </span>
          <StudioTour />
          <Button
            variant="ghost"
            size="icon"
            onClick={p.onMute}
            aria-label={p.muted ? 'Enable spoken feedback' : 'Mute spoken feedback'}
          >
            {p.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </Button>
        </div>
      </header>
      {p.archiveMessage && <p role="status" className="px-6 py-2 text-sm text-white">{p.archiveMessage}</p>}
      {(p.processing || p.exporting) && (
        <div className="studio-activity">
          <p>{p.exporting && !p.processing ? 'Exporting film...' : p.status}</p>
          <Progress value={p.progressPercent} aria-label="Work in progress" />
        </div>
      )}
      {saveFailed ? <p className="studio-notice" role="alert">{p.storageStatus}</p>
        : notice && !p.processing && !p.exporting && <p className="studio-notice" aria-hidden="true">{notice}</p>}
      <Tabs value={workspace} onValueChange={selectWorkspace}>
        <div className="workspace-nav">
          <TabsList aria-label="Workspace">
            <TabsTrigger value="create">
              <Film size={18} aria-hidden="true"/> Create
            </TabsTrigger>
            <TabsTrigger value="dream">
              <Layers size={18} aria-hidden="true"/> Dream
            </TabsTrigger>
            <TabsTrigger value="review">
              <Check size={18} aria-hidden="true"/> Review
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="shortcut-button" onClick={p.onShortcuts}>
            Keyboard shortcuts <span>?</span>
          </Button>
        </div>
        {hasStory && (
          <div className="editor-actionbar">
            <div>
              <span className="editor-section-label">
                {workspace === 'create'
                  ? 'FILM EDITOR · STORYBOARD'
                  : workspace === 'dream'
                  ? 'TRANSITIONS · COMPOSITING'
                  : 'CONTINUITY · QC'}
              </span>
              <h1>
                {workspace === 'create'
                  ? 'Storyboard'
                  : workspace === 'dream'
                  ? 'Dream studio'
                  : 'Scene review'}
              </h1>
            </div>
            <div className="editor-context-actions">
              <span>{p.shots.length} scenes · {(p.duration ?? 0).toFixed(1)}s</span>
              <Button variant="outline" size="sm" onClick={p.onAudit} disabled={p.processing}>
                Check continuity
              </Button>
              {p.onExportCsv && (
                <Button variant="outline" size="sm" onClick={p.onExportCsv} disabled={p.processing}>
                  Export CSV
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={p.onExportJson} disabled={p.processing}>
                Continuity report
              </Button>
              {p.onToggleBurnInTimecode && (
                <label className="flex items-center gap-1.5 text-xs font-mono text-[#94A3B8] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={p.burnInTimecode ?? false}
                    onChange={p.onToggleBurnInTimecode}
                    className="accent-[#38BDF8] rounded"
                  />
                  <span>BITC</span>
                </label>
              )}
              <Button size="sm" onClick={p.onExport} disabled={p.exporting || p.processing}>
                <Download size={15} />
                {p.exporting ? 'Exporting...' : p.burnInTimecode ? 'Export MP4 (BITC)' : 'Export film'}
              </Button>
            </div>
          </div>
        )}
        <main id="clean-main">
          <TabsContent value="create" forceMount hidden={workspace !== 'create'}>
            <DashboardLayout active={hasStory}>
              <section className="director-column" aria-label="Direct your film">
                {hasStory ? <div className="dashboard-direction-heading"><p className="eyebrow">DIRECTOR</p><h1>Direction</h1><p className="intro-copy">Edit the story with a prompt or your script.</p></div> : <>
                <p className="eyebrow">YOUR DIRECTOR'S CHAIR</p>
                <h1>
                  What would you like to create?
                </h1>
                <p className="intro-copy">
                  A thought, a memory, a whole new world. Start with what you can imagine.
                </p>
                </>}
                <BeTabs variant="segment" value={inputMode} onValueChange={setInputMode} className="input-tabs">
                  <BeTabsList aria-label="Story input" wrapperClassName="mx-auto !w-fit">
                    <BeTabsTrigger value="describe">Describe a video</BeTabsTrigger>
                    <BeTabsTrigger value="script">Paste a script</BeTabsTrigger>
                  </BeTabsList>
                  <BeTabsContent value="describe">
                    {p.voiceNotice && <p className="input-note" role="status">{p.voiceNotice}</p>}
                    <div ref={input} className="creation-composer-slot">
                      <CreationComposer
                        prompt={p.draft}
                        setPrompt={p.onDraft}
                        isLoading={p.processing}
                        onSubmit={p.onCommand}
                        onScript={() => setInputMode('script')}
                        hasStory={hasStory}
                        onReview={() => selectWorkspace('review')}
                        onTools={() => selectWorkspace('review')}
                        onVoice={p.onToggleVoice}
                        isListening={p.listening}
                      />
                    </div>
                    <p className="input-note">Type a direction, or open the voice preview.</p>
                    {!hasStory && <div className="starter-suggestions" aria-label="Story suggestions">
                      {[
                        ['Kitchen to ocean', 'I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.'],
                        ['A dream in space', 'I open my bedroom door and step onto the moon, still holding my favorite cup.'],
                        ['Rainy city escape', 'I walk through a rainy city under an amber umbrella. The street transforms into a quiet forest; the umbrella stays with me.'],
                        ['Bring a memory to life', 'Turn a memory of a quiet morning with my family into a short film, keeping the familiar objects consistent.'],
                      ].map(([label, idea]) => <Button key={label} variant="outline" size="sm" className="rounded-full"
                        onClick={() => { p.onDraft(idea); setFocusDirection(true); }}>
                        {label}<ArrowUpRight size={13} aria-hidden="true" />
                      </Button>)}
                    </div>}
                    {hasStory && (
                      <div className="starter-suggestions direction-suggestions" aria-label="Direction suggestions">
                        {firstMismatch && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => {
                            p.onDraft('');
                            p.onCommand(`Fix shot ${firstMismatch}`);
                          }}
                        >
                          Fix shot {firstMismatch}<ArrowUpRight size={13} aria-hidden="true" />
                        </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => {
                            p.onDraft('');
                            p.onCommand('Narrate the scene');
                          }}
                        >
                          Narrate the scene<ArrowUpRight size={13} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </BeTabsContent>
                  <BeTabsContent value="script">
                    <label className="script-label" htmlFor="film-script">
                      Your script
                    </label>
                    <Textarea
                      id="film-script"
                      aria-label="Scene Transcript"
                      className="min-h-64"
                      value={p.transcript}
                      onChange={(e) => p.onTranscript(e.target.value)}
                      rows={12}
                    />
                    <Button
                      className="w-full mt-3"
                      onClick={p.onGenerate}
                      disabled={p.processing || !p.transcript.trim()}
                    >
                      {p.processing ? 'Preparing storyboard...' : 'Create storyboard'}
                      <ArrowUpRight size={16} />
                    </Button>
                    <p className="input-note">
                      Offline sample planner. Your text stays in this session.
                    </p>
                  </BeTabsContent>
                </BeTabs>
              </section>
              {hasStory && <section className="film-column" aria-label="Film preview">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">PREVIEW</span>
                    <h2>Scene {shot?.shotNumber ?? 1}</h2>
                  </div>
                  <span className="sample-badge">{shot && (isGeneratedImage(shot.currentImageUrl) || shot.mediaSource === 'generated') ? 'Generated scene' : shot?.mediaSource === 'sample' ? 'Sample scene' : 'Scene media'}</span>
                </div>
                {videoError && <p role="alert" className="text-sm">{videoError}</p>}
                <div className="preview-frame">
                  {shot?.videoUrl ? (
                    <div className="relative w-full h-full flex items-center justify-center bg-black rounded overflow-hidden">
                      <video
                        ref={videoRef}
                        key={shot.videoUrl}
                        src={shot.videoUrl}
                        muted={p.muted || Boolean(shot.narrationDataUrl)}
                        loop
                        playsInline
                        onError={()=>{const message='This video could not be loaded. Restore its source file and retry.';setVideoError(message);playbackError.current?.(message);}}
                        className="w-full h-full object-contain cursor-pointer"
                        onClick={p.onPlay}
                        aria-label={`Video preview of shot ${shot.shotNumber}: ${shot.promptDescription}`}
                      />
                    </div>
                  ) : shot ? (
                    p.showBefore && hasVerifiedRepair(shot) ? (
                      <div
                        ref={previewFrameRef}
                        className="relative w-full h-full overflow-hidden select-none cursor-ew-resize"
                        onPointerDown={(e) => {
                          setIsWipeDragging(true);
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (rect.width > 0) {
                            const pct = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
                            setSplit(pct);
                          }
                        }}
                        onPointerMove={handleWipePointerMove}
                        onPointerUp={handleWipePointerUp}
                        onPointerCancel={handleWipePointerUp}
                        role="region"
                        aria-label={`Interactive Before and After split wipe for shot ${shot.shotNumber}. Split position ${currentSplit} percent.`}
                      >
                        {/* Repaired (After) Base Layer */}
                        <img
                          src={shot.currentImageUrl}
                          alt={`Repaired shot ${shot.shotNumber}`}
                          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                        />
                        {/* Original (Before) Clipped Layer */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            clipPath: `polygon(0 0, ${currentSplit}% 0, ${currentSplit}% 100%, 0 100%)`,
                          }}
                        >
                          <img
                            src={shot.originalImageUrl}
                            alt={`Original shot ${shot.shotNumber} before repair`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {/* Vertical Split Line & Handle */}
                        <div
                          className="absolute top-0 bottom-0 w-1 bg-[#38BDF8] shadow-[0_0_8px_rgba(56,189,248,0.8)] z-20 flex items-center justify-center -translate-x-1/2 pointer-events-none"
                          style={{ left: `${currentSplit}%` }}
                        >
                          <div className="px-2 py-0.5 bg-[#0A0D12]/90 border border-[#38BDF8] text-[#38BDF8] text-[10px] font-mono font-bold rounded shadow-lg whitespace-nowrap">
                            ◄ BEFORE | AFTER ►
                          </div>
                        </div>
                        {/* Corner labels */}
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-white text-black text-[10px] font-bold rounded shadow pointer-events-none">
                          BEFORE FIX
                        </div>
                        <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#10B981] text-black text-[10px] font-bold rounded shadow pointer-events-none">
                          AFTER FIX
                        </div>
                      </div>
                    ) : (
                      <>
                      <SceneTransition
                        source={shot.currentImageUrl}
                        destination={
                          p.playing ? p.shots[transition.index + 1]?.currentImageUrl : undefined
                        }
                        mask={shot.proposedFix?.mask?.maskBase64}
                        progress={p.playing ? transition.progress : 0}
                        description={`Preview of shot ${shot.shotNumber}`}
                      />
                      {p.showMask && shot.proposedFix?.mask && (
                        <>
                          <img src={shot.proposedFix.mask.maskBase64} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-80" />
                          <div aria-hidden="true" className="absolute pointer-events-none border-2 border-dashed border-white rounded" style={{left:`${shot.proposedFix.mask.box.x}%`,top:`${shot.proposedFix.mask.box.y}%`,width:`${shot.proposedFix.mask.box.width}%`,height:`${shot.proposedFix.mask.box.height}%`}} />
                        </>
                      )}
                      </>
                    )
                  ) : (
                    <div className="preview-empty">Preparing your storyboard...</div>
                  )}
                  <div className="preview-tag">
                    SHOT {String(shot?.shotNumber ?? 1).padStart(2, '0')}{' '}
                    <span>/ {String(p.shots.length).padStart(2, '0')}</span>
                  </div>
                  <Button
                    size="icon"
                    className={`preview-play ${p.playing && shot?.videoUrl ? 'opacity-0 hover:opacity-100 transition-opacity' : ''}`}
                    onClick={p.onPlay}
                    disabled={!p.shots.length}
                    aria-label={p.playing ? 'Pause preview' : 'Play preview'}
                  >
                    {p.playing ? <Pause size={26} /> : <Play size={26} />}
                  </Button>
                </div>
                <div className="preview-transport">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={p.onPlay}
                    disabled={!p.shots.length}
                    aria-label={p.playing ? 'Pause timeline' : 'Play timeline'}
                  >
                    {p.playing ? <Pause size={15} /> : <Play size={15} />}
                  </Button>
                  <output>{(p.time ?? 0).toFixed(1)}s</output>
                  <Slider
                    onKeyDown={event => event.stopPropagation()}
                    ref={node => { node?.querySelector('[role="slider"]')?.setAttribute("aria-label", "Preview time"); }}
                    min={0}
                    max={p.duration || 1}
                    step={0.1}
                    value={[p.time]}
                    onValueChange={([value]) => p.onSeek(value)}
                  />
                  <span>{(p.duration ?? 0).toFixed(1)}s</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Narrate selected shot"
                    onClick={p.onNarrate}
                    disabled={!shot}
                  >
                    <Volume2 size={17} />
                  </Button>
                </div>
                <div className="shots-heading">
                  <span>
                    Storyboard <span className="count-label">{p.shots.length} shots</span>
                  </span>
                  {p.activeShot && (p.onReorderShot || p.onNudgeDuration) && (
                    <div className="inline-flex items-center gap-1.5 text-xs">
                      {p.onReorderShot && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            title="Move shot earlier in sequence (Alt+Left)"
                            aria-label={`Move shot ${p.activeShot.shotNumber} earlier`}
                            disabled={p.playing || p.shots.findIndex((s) => s.id === p.activeShot!.id) === 0}
                            onClick={() => p.onReorderShot!(p.activeShot!.id, 'left')}
                          >
                            ◀ Move
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            title="Move shot later in sequence (Alt+Right)"
                            aria-label={`Move shot ${p.activeShot.shotNumber} later`}
                            disabled={p.playing || p.shots.findIndex((s) => s.id === p.activeShot!.id) === p.shots.length - 1}
                            onClick={() => p.onReorderShot!(p.activeShot!.id, 'right')}
                          >
                            Move ▶
                          </Button>
                        </>
                      )}
                      {p.onNudgeDuration && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs font-mono"
                            title="Trim duration by -0.5s ([)"
                            aria-label={`Decrease duration of shot ${p.activeShot.shotNumber}`}
                            disabled={p.playing || p.activeShot.durationSeconds <= (p.activeShot.narrationDurationSeconds ? Math.ceil((p.activeShot.narrationDurationSeconds+.4)*10)/10 : 0.5)}
                            onClick={() => p.onNudgeDuration!(p.activeShot!.id, -0.5)}
                          >
                            -0.5s
                          </Button>
                          <span className="text-xs font-mono text-[#CBD5E1] tabular-nums px-0.5">
                            {p.activeShot.durationSeconds.toFixed(1)}s
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs font-mono"
                            title="Extend duration by +0.5s (])"
                            aria-label={`Increase duration of shot ${p.activeShot.shotNumber}`}
                            disabled={p.playing || p.activeShot.durationSeconds >= 15}
                            onClick={() => p.onNudgeDuration!(p.activeShot!.id, 0.5)}
                          >
                            +0.5s
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectWorkspace('review')}
                  >
                    <SlidersHorizontal size={14} />
                    Review shot
                  </Button>
                </div>
                <div className="shot-strip">
                  {p.shots.map((s) => (
                    <Button
                      key={s.id}
                      variant="outline"
                      className={shot?.id === s.id ? 'shot-thumb selected' : 'shot-thumb'}
                      onClick={() => p.onSelect(s.id)}
                      aria-label={`Select shot ${s.shotNumber}`}
                      aria-pressed={shot?.id === s.id}
                    >
                      <img src={s.currentImageUrl} alt="" />
                      <span>
                        <b>{String(s.shotNumber).padStart(2, '0')}</b>
                        {s.durationSeconds}s
                        {s.revisions?.length > 1 && (
                          <span className="take-pill ml-1 px-1 py-0.5 bg-[#0F172A] border border-[#38BDF8]/60 text-[#38BDF8] text-[9px] font-mono rounded">
                            T{s.revisions.findIndex((r) => r.imageUrl === s.currentImageUrl) + 1}
                          </span>
                        )}
                      </span>
                    </Button>
                  ))}
                </div>
              </section>}

            </DashboardLayout>
          </TabsContent>
          <TabsContent value="dream" forceMount hidden={workspace !== 'dream'}>
            <DashboardLayout active>
              <section className="workspace-guide"><p className="eyebrow">DREAM</p><h1>Transition setup</h1><p>Choose the worlds, select what stays, then preview the change.</p><ol><li>Select your source images</li><li>Correct each anchor mask</li><li>Preview and verify protection</li><li>Export your transition</li></ol><Button variant="outline" onClick={()=>selectWorkspace('create')}>Back to film</Button></section>
              <section className="tools-surface unified-tools dream-surface" aria-label="Dream editing workspace">{p.projects.map(project=><div key={project.id} hidden={project.id!==p.projectId}><DreamTransitionPanel projectId={project.id} /></div>)}</section>
              <aside className="workspace-guide"><p className="eyebrow">ANCHOR PROTECTION</p><h2>Keep the details that matter.</h2><p>Cup and umbrella use separate masks. Review both selections before applying them.</p><p>Use the local verification report to check protected pixels across the transition.</p><Button variant="outline" onClick={()=>selectWorkspace('review')}>Review your scenes</Button></aside>
            </DashboardLayout>
          </TabsContent>
          <TabsContent value="review" forceMount hidden={workspace !== 'review'}>
            <DashboardLayout active>
              <section className="workspace-guide"><p className="eyebrow">REVIEW</p><h1>Scenes</h1><p>Select a scene to inspect its anchors, corrections and revision history.</p><Button onClick={p.onAudit} disabled={p.processing}>Review sequence<Check size={15}/></Button>{!hasStory && <p>Create a storyboard first. Your shots will appear here for review.</p>}
              <div className="review-scene-list">{p.shots.map(scene=>{
                const activeTake = scene.revisions?.findIndex(r => r.imageUrl === scene.currentImageUrl) ?? -1;
                return (
                  <Button key={scene.id} variant="ghost" className="review-scene" aria-pressed={scene.id===shot?.id} onClick={()=>{p.onSelect(scene.id);const tools=reviewTools.current;if(tools&&tools.getBoundingClientRect().top>window.innerHeight*0.6)tools.scrollIntoView({block:'start'});}}>
                    <img src={scene.currentImageUrl} alt=""/>
                    <span>
                      Scene {scene.shotNumber}
                      <small>
                        {scene.status} · {scene.durationSeconds}s
                        {scene.revisions?.length > 1 && ` · Take ${activeTake >= 0 ? activeTake + 1 : scene.revisions.length}/${scene.revisions.length}`}
                      </small>
                    </span>
                  </Button>
                );
              })}</div></section>
              <section ref={reviewTools} className="tools-surface unified-tools" aria-label="Scene review tools">{workspace==='review' && hasStory && p.inspector}</section>
              <aside className="workspace-guide"><p className="eyebrow">PROJECT</p><h2>Story &amp; rules</h2><p>Your script and continuity rules guide each scene. Open project controls to change the sequence or edit rules.</p><details className="project-controls"><summary>Project controls</summary><div className="tools-surface unified-tools">{workspace==='review' && p.controls}</div></details><Button variant="outline" onClick={()=>selectWorkspace('create')}>Back to film</Button></aside>
            </DashboardLayout>
          </TabsContent>
        </main>
      </Tabs>
      <footer className="workspace-footer">
        <span>ANCHORSHOT / LOCAL STUDIO</span>
        <details>
          <summary>Activity</summary>
          <p>
            {p.status}
          </p>
        </details>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {p.status}
      </div>
      {p.shortcuts}
      <VoiceOverlay
        key={p.projectId}
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        agentTools={agentTools}
      />
    </div>
  );
}
