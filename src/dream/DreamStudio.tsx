import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Focus,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { brand } from '../brand';
import { download, downloadJson } from '../lib/media';
import {
  DURATION,
  DEFAULT_PLAN,
  SCENES,
  clockLabel,
  readPlan,
  storyCaptions,
  timelineAt,
  type DreamPlan,
} from './timeline';
import { H, W, prepareAssets, recordDream, renderDream, type Assets } from './render';
import { importSceneImage, imageSurface } from './images';
import { InspectorSection } from './EditorComponents';
import './dream.css';

const STORAGE = 'framelock.dream-plan.v1';
function initialPlan(): DreamPlan {
  try {
    const raw = localStorage.getItem(STORAGE);
    const saved = raw ? readPlan(JSON.parse(raw)) : null;
    if (saved) return saved;
  } catch {
    /* Storage is optional. */
  }
  return {
    ...DEFAULT_PLAN,
    captions: [...DEFAULT_PLAN.captions],
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
export default function DreamStudio() {
  const [plan, setPlan] = useState<DreamPlan>(initialPlan);
  const [samples, setSamples] = useState<Assets | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('Three sample worlds. One object to carry between them.');
  const [saved, setSaved] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    exportAbort = useRef<AbortController | null>(null),
    clock = useRef(0);
  const position = timelineAt(time),
    active = position.blend > 0.5 && !plan.reducedMotion ? position.next : position.index;
  const recording = progress !== null;
  const prefersReducedMotion = useReducedMotion();
  const quiet = plan.reducedMotion || prefersReducedMotion;
  const uiTransition = { duration: quiet ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] as const };
  const reveal = {
    initial: { opacity: quiet ? 1 : 0, transform: quiet ? 'none' : 'translateY(6px)' },
    animate: { opacity: 1, transform: 'translateY(0px)' },
    transition: uiTransition,
  };
  const thumbs = useMemo(
    () => assets?.worlds.map((world) => world.toDataURL('image/jpeg', 0.8)) ?? [],
    [assets],
  );
  const anchorUrl = useMemo(() => assets?.anchor.toDataURL() ?? '', [assets]);
  useEffect(() => {
    document.title = `Dream lab — ${brand.name} (working title)`;
    let alive = true;
    prepareAssets()
      .then((value) => {
        if (alive) setSamples(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      exportAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!samples) return;
    let alive = true;
    setAssets(null);
    Promise.all(
      plan.images.map((image, index) => (image ? imageSurface(image) : samples.worlds[index])),
    )
      .then((worlds) => {
        if (alive) setAssets({ worlds, anchor: samples.anchor });
      })
      .catch(() => {
        if (alive)
          setError('A saved image could not be opened. Reset that scene to its sample image.');
      });
    return () => {
      alive = false;
    };
  }, [samples, plan.images]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(plan));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [plan]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (preference.matches) {
        setPlaying(false);
        setPlan((p) => ({ ...p, reducedMotion: true }));
      }
    };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    clock.current = time;
    if (assets && canvas.current) {
      const ctx = canvas.current.getContext('2d');
      if (ctx) renderDream(ctx, assets, time, plan);
    }
  }, [time, assets, plan]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(),
      base = clock.current;
    let raf = 0,
      last = 0;
    const step = (now: number) => {
      const next = Math.min(DURATION, base + (now - start) / 1000);
      if (now - last >= 32 || next === DURATION) {
        setTime(next);
        last = now;
      }
      if (next === DURATION) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  function seek(value: number) {
    setPlaying(false);
    setTime(value);
  }
  function update<K extends keyof DreamPlan>(key: K, value: DreamPlan[K]) {
    setPlan((p) => ({ ...p, [key]: value }));
    setError('');
  }
  async function chooseImage(index: number, file: File) {
    if (recording || imageBusy) return;
    setImageBusy(true);
    setPlaying(false);
    setError('');
    try {
      const image = await importSceneImage(file);
      setPlan((current) => ({
        ...current,
        images: current.images.map((old, i) => (i === index ? image : old)),
      }));
      setNotice(`Scene ${index + 1} now uses ${image.name}. The image stays on this device.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load this image.');
    } finally {
      setImageBusy(false);
    }
  }
  function resetImage(index: number) {
    setPlaying(false);
    setPlan((current) => ({
      ...current,
      images: current.images.map((old, i) => (i === index ? null : old)),
    }));
    setError('');
    setNotice(`Scene ${index + 1} restored to its sample image.`);
  }
  function applyStory() {
    try {
      const captions = storyCaptions(plan.story);
      update('captions', captions);
      setNotice(
        'Your three paragraphs are now the scene captions. Images stay as you selected them.',
      );
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function exportFilm() {
    if (!assets || recording || imageBusy) return;
    setPlaying(false);
    setError('');
    setProgress(0);
    setNotice('Recording the full 20-second preview. Keep this tab visible.');
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const blob = await recordDream(
        assets,
        { ...plan, captions: [...plan.captions] },
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted) throw new Error('Export cancelled.');
      const url = URL.createObjectURL(blob);
      download(url, 'dream-journey.webm');
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNotice('Silent WebM downloaded with your captions. This is the offline animation study.');
    } catch (e) {
      if (controller.signal.aborted) setNotice('Export cancelled. Your dream plan is still saved.');
      else setError(e instanceof Error ? e.message : 'Video export failed.');
    } finally {
      setProgress(null);
      exportAbort.current = null;
    }
  }
  function savePlan() {
    downloadJson(
      {
        ...plan,
        durationSeconds: DURATION,
        worlds: plan.titles,
        imageSources: plan.images.map((image, index) =>
          image
            ? { type: 'local-image', name: image.name }
            : { type: 'procedural-sample', id: SCENES[index].id },
        ),
        provenance: {
          visuals: plan.images.some(Boolean)
            ? 'User-selected local images and any remaining procedural samples; resized images embedded in plan'
            : 'Original procedural sample illustrations',
          anchor: 'Cup cutout from the existing hand-authored sample mask',
          modelCalls: 0,
          rendering: 'Canvas layered transitions; not generative video',
        },
      },
      'dream-journey-plan.json',
    );
    setNotice('Dream plan downloaded with your story, resized images and source labels.');
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="dream-studio">
        <a className="dream-skip" href="#dream-workspace">
          Skip to dream editor
        </a>
        <header className="dream-header">
          <a href="/" className="dream-brand">
            <span>
              <Focus size={22} />
            </span>
            {brand.name}
            <small>WORKING TITLE</small>
          </a>
          <span className="dream-header-divider" />
          <span className="dream-section-name">Dream lab</span>
          <span className="dream-branch">EXPERIMENT</span>
          <a className="dream-back" href="/">
            <ArrowLeft size={14} />
            Frame lab
          </a>
        </header>
        <main id="dream-workspace" className="dream-main" tabIndex={-1}>
          <motion.div className="dream-heading" {...reveal}>
            <div>
              <p className="dream-eyebrow">PROJECT / 001</p>
              <h1>Dream editor</h1>
              <p>Three scenes. One continuous story.</p>
            </div>
            <span className="dream-saved">
              <span />
              {saved ? 'Plan saved on this device' : 'Not saved - download your plan'}
            </span>
          </motion.div>
          <div className="dream-layout">
            <motion.aside
              className="dream-sidebar"
              aria-label="Dream direction"
              {...reveal}
              transition={{ ...uiTransition, delay: quiet ? 0 : 0.04 }}
            >
              <fieldset disabled={recording} className="dream-controls">
                <legend className="sr-only">Dream settings</legend>
                <InspectorSection number="01" title="Remember the dream">
                  <label htmlFor="dream-story">Your dream notes</label>
                  <textarea
                    id="dream-story"
                    maxLength={2000}
                    rows={6}
                    value={plan.story}
                    onChange={(e) => update('story', e.target.value)}
                    aria-describedby="dream-notes-help"
                  />
                  <p id="dream-notes-help" className="dream-help">
                    Write three paragraphs separated by blank lines, up to 160 characters each.
                    Applying them replaces the scene captions; your selected images stay unchanged.
                  </p>
                  <button type="button" className="dream-button" onClick={applyStory}>
                    Use paragraphs as captions
                  </button>
                </InspectorSection>
                <InspectorSection number="02" title="Choose what stays">
                  <label className="dream-anchor">
                    <span className="dream-anchor-thumb">
                      {assets ? <img src={anchorUrl} alt="" /> : <Focus size={20} />}
                    </span>
                    <span>
                      <strong>The red mug</strong>
                      <small>One cutout, held in place</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={plan.anchor}
                      onChange={(e) => update('anchor', e.target.checked)}
                      aria-label="Keep the red mug"
                    />
                  </label>
                  <p className="dream-help">
                    The sample mask comes from Frame lab. Live SAM selection has not been used.
                  </p>
                </InspectorSection>
                <InspectorSection number="03" title="Let the world change">
                  <div className="dream-transition" role="group" aria-label="Scene transition">
                    <button
                      aria-pressed={plan.transition === 'doorway'}
                      onClick={() => update('transition', 'doorway')}
                    >
                      <span className="doorway-icon" />
                      Doorway
                    </button>
                    <button
                      aria-pressed={plan.transition === 'dissolve'}
                      onClick={() => update('transition', 'dissolve')}
                    >
                      <Sparkles size={17} />
                      Dissolve
                    </button>
                  </div>
                  <label className="dream-motion">
                    <input
                      type="checkbox"
                      checked={plan.reducedMotion}
                      onChange={(e) => {
                        setPlaying(false);
                        update('reducedMotion', e.target.checked);
                      }}
                    />
                    Gentle playback
                  </label>
                  <p className="dream-help">
                    {plan.reducedMotion
                      ? 'Scenes switch with still cuts. Sweeping reveals and water motion are off.'
                      : 'A doorway opens into the next world. The mug stays in the foreground.'}
                  </p>
                </InspectorSection>
              </fieldset>
              <div className="dream-sample-note">
                <span>OFFLINE STORY EDITOR</span>
                <p>
                  Your images stay on this device. Layered transitions, no AI video or Meta calls.
                </p>
              </div>
            </motion.aside>
            <div className="dream-film-column">
              <motion.section
                className="dream-player"
                aria-label="Dream film preview"
                {...reveal}
                transition={{ ...uiTransition, delay: quiet ? 0 : 0.08 }}
              >
                <div className="dream-player-header">
                  <span>
                    <Film size={13} />
                    DREAM JOURNEY
                  </span>
                  <span>
                    {String(active + 1).padStart(2, '0')} / 03 <b>·</b> {plan.titles[active]}
                  </span>
                </div>
                <div className="dream-canvas-wrap">
                  <canvas
                    ref={canvas}
                    width={W}
                    height={H}
                    role="img"
                    aria-label={`Offline dream illustration: ${plan.titles[active]}. ${plan.anchor ? 'The same red mug cutout stays in the foreground.' : 'The mug is hidden.'}`}
                  >
                    <p>{plan.captions[active]}</p>
                  </canvas>
                  {!assets ? (
                    <div className="dream-loading">
                      <LoaderCircle className="spin" />
                      Preparing sample worlds…
                    </div>
                  ) : null}
                  <span className="dream-anchor-badge">
                    {plan.anchor ? <LockKeyhole size={12} /> : <Focus size={12} />}{' '}
                    {plan.anchor ? 'Mug anchored' : 'World only'}
                  </span>
                  <span className="dream-study-badge">
                    {plan.images[active] ? 'LOCAL IMAGE' : 'SAMPLE VISUALS'}
                  </span>
                </div>
                <div className="dream-transport">
                  <button
                    className="dream-play"
                    disabled={!assets || recording || imageBusy}
                    aria-label={playing ? 'Pause dream' : 'Play dream'}
                    onClick={() => {
                      if (time >= DURATION) {
                        clock.current = 0;
                        setTime(0);
                      }
                      setPlaying((p) => !p);
                    }}
                  >
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button
                    className="dream-reset"
                    aria-label="Restart dream"
                    disabled={recording}
                    onClick={() => seek(0)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <label className="sr-only" htmlFor="dream-time">
                    Dream playhead
                  </label>
                  <input
                    id="dream-time"
                    type="range"
                    min={0}
                    max={DURATION}
                    step={0.05}
                    value={time}
                    disabled={recording}
                    onChange={(e) => seek(Number(e.target.value))}
                    aria-valuetext={`${time.toFixed(1)} seconds of 20`}
                  />
                  <span className="dream-time">
                    {clockLabel(time)} <b>/ 00:20</b>
                  </span>
                </div>
              </motion.section>
              <div className="dream-scene-heading">
                <h2>Scene sequence</h2>
                <span>Add images and edit the three scenes of your story.</span>
              </div>
              <p className="dream-help">
                JPEG, PNG or WebP; up to 8 MB and 24 megapixels. Images fit inside the frame with
                dark margins; local copies are resized to 1120 x 700. Save your plan as a backup.
              </p>
              <div className="dream-scenes">
                {SCENES.map((scene, index) => (
                  <motion.article
                    className={`dream-scene ${active === index ? 'is-active' : ''}`}
                    key={scene.id}
                    animate={{ borderColor: active === index ? '#111111' : '#dedede' }}
                    transition={uiTransition}
                  >
                    <button
                      onClick={() => seek((index * DURATION) / 3)}
                      disabled={recording}
                      aria-label={`Show ${plan.titles[index]}`}
                      aria-pressed={active === index}
                    >
                      <div className="dream-scene-thumb">
                        {thumbs[index] ? <img src={thumbs[index]} alt="" /> : null}
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        {active === index ? <span className="dream-now">ON SCREEN</span> : null}
                      </div>
                      <div className="dream-scene-title">
                        <strong>{plan.titles[index] || `Scene ${index + 1}`}</strong>
                        <small>{plan.images[index] ? 'Your local image' : scene.title}</small>
                      </div>
                    </button>
                    <div className="dream-scene-edit">
                      <label htmlFor={`title-${index}`}>Scene {index + 1} title</label>
                      <input
                        id={`title-${index}`}
                        type="text"
                        maxLength={80}
                        value={plan.titles[index]}
                        disabled={recording}
                        onChange={(event) =>
                          update(
                            'titles',
                            plan.titles.map((title, i) =>
                              i === index ? event.target.value : title,
                            ),
                          )
                        }
                      />
                      <label htmlFor={`image-${index}`}>Image for scene {index + 1}</label>
                      <input
                        id={`image-${index}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={recording || imageBusy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void chooseImage(index, file);
                        }}
                      />
                      <p className="dream-image-source">
                        {plan.images[index]?.name || 'Original sample illustration'}
                      </p>
                      {plan.images[index] ? (
                        <button
                          className="dream-button"
                          disabled={recording || imageBusy}
                          onClick={() => resetImage(index)}
                        >
                          Reset scene {index + 1} image
                        </button>
                      ) : null}
                    </div>
                    <label htmlFor={`caption-${index}`} className="sr-only">
                      Caption for {plan.titles[index]}
                    </label>
                    <textarea
                      id={`caption-${index}`}
                      value={plan.captions[index]}
                      rows={3}
                      maxLength={160}
                      disabled={recording}
                      onChange={(e) => {
                        const next = [...plan.captions];
                        next[index] = e.target.value;
                        update('captions', next);
                      }}
                    />
                  </motion.article>
                ))}
              </div>
              <section className="dream-delivery" aria-label="Save your dream">
                <div>
                  <p className="dream-eyebrow">DELIVERY</p>
                  <h2>Export your film</h2>
                  <p>
                    Download the 20-second silent preview, a still, or a plan containing your
                    resized images.
                  </p>
                </div>
                <div className="dream-export-actions">
                  <button
                    className="dream-button primary"
                    onClick={() => void exportFilm()}
                    disabled={!assets || recording || imageBusy}
                  >
                    <ArrowDownToLine size={16} />
                    {recording ? `Recording ${Math.round(progress! * 100)}%` : 'Export WebM'}
                  </button>
                  <button
                    className="dream-button"
                    disabled={!assets || recording || imageBusy}
                    onClick={() => {
                      if (canvas.current)
                        download(canvas.current.toDataURL('image/png'), 'dream-frame.png');
                    }}
                  >
                    Save frame
                  </button>
                  <button className="dream-button" onClick={savePlan} disabled={recording}>
                    Save plan
                  </button>
                </div>
              </section>
              <AnimatePresence initial={false}>
                {recording ? (
                  <motion.div
                    key="export-progress"
                    className="dream-recording"
                    {...reveal}
                    exit={{ opacity: 0, transform: quiet ? 'none' : 'translateY(6px)' }}
                  >
                    <progress value={progress!} max={1} aria-label="Video export progress" />
                    <span>Keep this tab visible while the film records.</span>
                    <button className="dream-button" onClick={() => exportAbort.current?.abort()}>
                      <X size={14} />
                      Cancel export
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <div className="dream-status" role="status" aria-live="polite">
                <Check size={14} />
                {notice}
              </div>
              {error ? (
                <p className="dream-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
          <footer className="dream-footer">
            <span>
              <Focus size={13} />
              Framelock / working title
            </span>
            <span>
              Dream experiment <b>·</b> Built for discussion before a merge
            </span>
          </footer>
        </main>
      </div>
    </MotionConfig>
  );
}
