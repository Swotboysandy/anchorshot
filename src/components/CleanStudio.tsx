import {SceneDetailsEditor} from './SceneDetailsEditor';
import {DashboardLayout} from './DashboardLayout';
import { Tabs as BeTabs, TabsList as BeTabsList, TabsTrigger as BeTabsTrigger, TabsContent as BeTabsContent } from './ui/beui-tabs';
import { CreationComposer } from './CreationComposer';
import { VoiceOverlay } from './VoiceOverlay';
import type { AgentTools } from '../services/voiceAgent';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { speechRecognitionService } from '../services/speechRecognitionService';
import type { StoryboardShot } from '../types/framelock';
import './cleanStudio.css';
type Props = {
  onSaveScene:(id:string,prompt:string,duration:number)=>void;
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
  onTranscript: (s: string) => void;
  onGenerate: () => void;
  onCommand: (s: string) => void;
  onSelect: (id: string) => void;
  onPlay: () => void;
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
};
export function CleanStudio(p: Props) {
  const [workspace, setWorkspace] = useState('create'),
    [inputMode, setInputMode] = useState('describe'),
    [command, setCommand] = useState(''),
    [voiceNoticeText, setVoiceNoticeText] = useState<string | null>(null),
    [isDictating, setIsDictating] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [focusDirection, setFocusDirection] = useState(false),
    [inspect, setInspect] = useState(false);

  const handleSimulateVoice = (sampleText: string) => {
    setVoiceNoticeText('Simulating voice input stream...');
    void speechRecognitionService.simulateLocalSpeech(sampleText, {
      onResult: (text, isFinal) => {
        setCommand(text);
        if (isFinal) {
          setVoiceNoticeText(`Simulated: "${text}"`);
        }
      },
      onStateChange: (listening) => setIsDictating(listening),
    });
  };

  const handleToggleVoiceDictation = () => {
    if (isDictating || speechRecognitionService.isListening()) {
      speechRecognitionService.stopListening();
      setIsDictating(false);
      setVoiceNoticeText('Voice dictation stopped.');
      return;
    }

    setVoiceNoticeText(null);
    if (!speechRecognitionService.isSupported()) {
      setVoiceNoticeText('Web Speech API is unavailable in this browser. Try simulated voice test below.');
      return;
    }

    const started = speechRecognitionService.startListening({
      continuous: true,
      interimResults: true,
      onResult: (text, isFinal) => {
        setCommand(text);
        p.onTranscript(text);
        if (isFinal) {
          setVoiceNoticeText(`Heard: "${text}"`);
        }
      },
      onError: (err) => {
        setIsDictating(false);
        setVoiceNoticeText(err + ' You can type your direction or explicitly try sample dictation.');
      },
      onStateChange: (listening) => {
        setIsDictating(listening);
        if (listening) {
          setVoiceNoticeText('Listening live... speak your direction.');
        }
      },
    });

    if (!started) {
      setVoiceNoticeText('Microphone access could not start. Try simulated voice test.');
    }
  };

  useEffect(() => {
    const syncListening = () => {
      const active = speechRecognitionService.isListening();
      setIsDictating((prev) => (prev !== active ? active : prev));
    };
    const timer = setInterval(syncListening, 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(()=>{setWorkspace('create');setCommand('');setVoiceOpen(false);setInspect(false);},[p.projectId]);
  const input = useRef<HTMLDivElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    if (!focusDirection || voiceOpen || workspace !== 'create' || inputMode !== 'describe') return;
    const frame = requestAnimationFrame(() => {
      input.current?.querySelector('textarea')?.focus();
      setFocusDirection(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusDirection, voiceOpen, workspace, inputMode]);
  const transition = transitionAt(
    p.shots.map((s) => s.durationSeconds),
    p.time,
    !reduced,
  );
  const hasStory = p.shots.length > 0;
  const shot = p.playing ? p.shots[transition.index] : p.activeShot;
  const selectWorkspace = (value: string) => {
    if (p.playing) p.onPlay();
    setWorkspace(value);
  };

  // Real studio actions the voice agent may call; each returns what happened so the agent can say it.
  const agentTools: AgentTools = {
    set_direction: ({ text }) => {
      if (typeof text !== 'string' || !text.trim()) return 'No direction was given.';
      p.onTranscript(text.trim());
      return 'Direction saved to the script.';
    },
    generate_storyboard: () => {
      if (p.processing) return 'A storyboard is already being generated.';
      p.onGenerate();
      return 'Storyboard generation started.';
    },
    run_command: ({ command }) => {
      if (typeof command !== 'string' || !command.trim()) return 'No command was given.';
      p.onCommand(command.trim());
      return `Ran: ${command.trim()}`;
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
          <Button variant="outline" size="sm" disabled={p.processing||p.exporting} onClick={p.onNewProject}>New project</Button>
          {hasStory && <details className="project-rename"><summary>Rename</summary><form onSubmit={event=>{event.preventDefault();const title=String(new FormData(event.currentTarget).get('title')||'').trim();if(title)p.onRenameProject(title);event.currentTarget.closest('details')?.removeAttribute('open');}}><input name="title" aria-label="Project name" defaultValue={p.projectTitle} key={p.projectTitle} maxLength={80} required/><Button size="sm" type="submit">Save name</Button></form></details>}

          <span className="local-label">
            <i /> {p.storageStatus}
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
      <Tabs value={workspace} onValueChange={selectWorkspace}>
        <div className="workspace-nav" hidden={!hasStory}>
          <TabsList aria-label="Workspace">
            <TabsTrigger value="create">
              <Film size={18} aria-hidden="true"/> Create
            </TabsTrigger>
            <TabsTrigger value="dream">
              <Layers size={18} aria-hidden="true"/> Dream
            </TabsTrigger>
            <TabsTrigger value="review" disabled={!hasStory}>
              <Check size={18} aria-hidden="true"/> Review
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="shortcut-button" onClick={p.onShortcuts}>
            Keyboard shortcuts <span>?</span>
          </Button>
        </div>
        {hasStory && <div className="editor-actionbar"><div><span className="editor-section-label">{workspace==='create'?'FILM EDITOR':workspace==='dream'?'TRANSITIONS':'CONTINUITY'}</span><h1>{workspace==='create'?'Storyboard':workspace==='dream'?'Dream studio':'Scene review'}</h1></div><div className="editor-context-actions"><span>{p.shots.length} scenes · {p.duration.toFixed(1)}s</span><Button variant="outline" size="sm" onClick={p.onAudit} disabled={p.processing}>Check continuity</Button><Button size="sm" onClick={p.onExport} disabled={p.exporting||p.processing}><Download size={15}/>{p.exporting?'Exporting...':'Export film'}</Button></div></div>}
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
                    {voiceNoticeText && (
                      <div className="inline-notice flex items-center justify-between gap-2" role="status">
                        <span>{voiceNoticeText}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-white hover:text-neutral-300 px-1.5 underline"
                          onClick={() => handleSimulateVoice('I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.')}
                        >
                          Run Sample Dictation
                        </Button>
                      </div>
                    )}
                    <div ref={input} className="creation-composer-slot">
                      <CreationComposer
                        prompt={command}
                        setPrompt={setCommand}
                        isLoading={p.processing}
                        onSubmit={p.onCommand}
                        onScript={() => setInputMode('script')}
                        hasStory={hasStory}
                        onReview={() => selectWorkspace('review')}
                        onTools={() => setInspect((value) => !value)}
                        onVoice={handleToggleVoiceDictation}
                        isListening={isDictating}
                      />
                    </div>
                    <p className="input-note">Type a direction, or open the voice preview. Storyboards use local sample scenes.</p>
                    {!hasStory && <div className="starter-suggestions" aria-label="Story suggestions">
                      {[
                        ['Kitchen to ocean', 'I am holding a blue cup in my kitchen. The walls dissolve into an ocean, but the cup stays exactly the same.'],
                        ['A dream in space', 'I open my bedroom door and step onto the moon, still holding my favorite cup.'],
                        ['Rainy city escape', 'I walk through a rainy city under an amber umbrella. The street transforms into a quiet forest; the umbrella stays with me.'],
                        ['Bring a memory to life', 'Turn a memory of a quiet morning with my family into a short film, keeping the familiar objects consistent.'],
                      ].map(([label, idea]) => <Button key={label} variant="outline" size="sm" className="rounded-full"
                        onClick={() => { setCommand(idea); setFocusDirection(true); }}>
                        {label}<ArrowUpRight size={13} aria-hidden="true" />
                      </Button>)}
                    </div>}
                    {hasStory && <div className="direction-suggestions">
                      <Button variant="outline" size="sm" onClick={() => { setCommand(''); p.onCommand('Fix shot 2'); }}>
                        Fix shot 2 <ArrowUpRight size={12} />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCommand(''); p.onCommand('Narrate the scene'); }}
                      >
                        Describe this scene <ArrowUpRight size={12} />
                      </Button>
                    </div>}
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
                  <span className="sample-badge">Sample storyboard</span>
                </div>
                <div className="preview-frame">
                  {shot ? (
                    <SceneTransition
                      source={shot.currentImageUrl}
                      destination={
                        p.playing ? p.shots[transition.index + 1]?.currentImageUrl : undefined
                      }
                      mask={shot.proposedFix?.mask?.maskBase64}
                      progress={p.playing ? transition.progress : 0}
                      description={`Preview of shot ${shot.shotNumber}`}
                    />
                  ) : (
                    <div className="preview-empty">Preparing your storyboard...</div>
                  )}
                  <div className="preview-tag">
                    SHOT {String(shot?.shotNumber ?? 1).padStart(2, '0')}{' '}
                    <span>/ {String(p.shots.length).padStart(2, '0')}</span>
                  </div>
                  <Button
                    size="icon"
                    className="preview-play"
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
                  <output>{p.time.toFixed(1)}s</output>
                  <Slider
                    onKeyDown={event => event.stopPropagation()}
                    ref={node => { node?.querySelector('[role="slider"]')?.setAttribute("aria-label", "Preview time"); }}
                    min={0}
                    max={p.duration || 1}
                    step={0.1}
                    value={[p.time]}
                    onValueChange={([value]) => p.onSeek(value)}
                  />
                  <span>{p.duration.toFixed(1)}s</span>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setInspect((v) => !v)}
                    aria-expanded={inspect}
                  >
                    <SlidersHorizontal size={14} />
                    {inspect ? 'Close tools' : 'Shot tools'}
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
                      </span>
                    </Button>
                  ))}
                </div>
                <div className="film-footer">
                  <span>
                    <i /> {p.processing ? 'Working locally...' : 'Ready for your next direction'}
                  </span>
                  <Button disabled={p.exporting || !p.shots.length} onClick={p.onExport}>
                    <Download size={15} />
                    {p.exporting ? 'Exporting...' : 'Export film'}
                  </Button>
                </div>
                {inspect && <div className="tools-surface">{p.inspector}</div>}
              </section>}
              {hasStory && shot && <SceneDetailsEditor key={shot.id} shot={shot} disabled={p.processing||p.playing} onSave={p.onSaveScene}/>}

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
              <section className="workspace-guide"><p className="eyebrow">REVIEW</p><h1>Scenes</h1><p>Select a scene to inspect its anchors, corrections and revision history.</p><Button onClick={p.onAudit} disabled={p.processing}>Review sequence<Check size={15}/></Button>
              <div className="review-scene-list">{p.shots.map(scene=><Button key={scene.id} variant="ghost" className="review-scene" aria-pressed={scene.id===shot?.id} onClick={()=>p.onSelect(scene.id)}><img src={scene.currentImageUrl} alt=""/><span>Scene {scene.shotNumber}<small>{scene.status} · {scene.durationSeconds}s</small></span></Button>)}</div></section>
              <section className="tools-surface unified-tools" aria-label="Scene review tools">{workspace==='review' && p.inspector}</section>
              <aside className="workspace-guide"><p className="eyebrow">PROJECT</p><h2>Story &amp; rules</h2><p>Your script and continuity rules guide each scene. Open project controls to change the sequence or edit rules.</p><details className="project-controls"><summary>Project controls</summary><div className="tools-surface unified-tools">{workspace==='review' && p.controls}</div></details><Button variant="outline" onClick={()=>selectWorkspace('create')}>Back to film</Button></aside>
            </DashboardLayout>
          </TabsContent>
        </main>
      </Tabs>
      <footer className="workspace-footer" hidden={!hasStory}>
        <span>ANCHORSHOT / LOCAL STUDIO</span>
        <details>
          <summary>Activity</summary>
          <p>
            {p.status}
          </p>
        </details>
        <span>No cloud generation</span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {p.status}
      </div>
      {p.shortcuts}
      <VoiceOverlay
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        agentTools={agentTools}
      />
    </div>
  );
}
