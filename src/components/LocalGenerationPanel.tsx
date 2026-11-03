import React, {useEffect, useState} from 'react';

import {Cpu} from 'lucide-react';

import {localAsset, localMeasurementsAsset, localRequest, type LocalJob} from '../services/localGeneration';



export function LocalGenerationPanel({shotId, shotNumber, initialPrompt, onUseImage, onUseVideo, isProcessing}: {

  shotId: string; shotNumber: number; initialPrompt: string; isProcessing: boolean;

  onUseImage: (shotId: string, imageUrl: string, prompt: string) => void;

  onUseVideo?: (shotId: string, videoUrl: string, prompt: string, jobId: string) => void;

}) {

  const [prompt, setPrompt] = useState(initialPrompt);

  const [seed, setSeed] = useState('42');

  const [jobs, setJobs] = useState<LocalJob[]>([]);

  const [selected, setSelected] = useState('');

  const [ready, setReady] = useState(false);

  const [busy, setBusy] = useState(false);

  const [sending, setSending] = useState(false);

  const [error, setError] = useState('');

  const [notice, setNotice] = useState('');

  useEffect(() => {setPrompt(initialPrompt); setNotice('');}, [shotId, initialPrompt]);

  useEffect(() => {

    let disposed = false;

    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {

      try {

        const [health, recent] = await Promise.all([

          localRequest<{ready: boolean; activeJobId: string|null}>('/health'), localRequest<LocalJob[]>('/jobs'),

        ]);

        if (disposed) return;

        setReady(health.ready); setBusy(Boolean(health.activeJobId)); setJobs(recent);

        if (health.ready) setError(prev => (prev.includes('Local service unavailable') ? '' : prev));

        setSelected(previous => previous || recent[0]?.id || '');

      } catch (e) {

        if (!disposed) {setReady(false); setError(e instanceof Error ? e.message : 'Local service unavailable.');}

      } finally {if (!disposed) timer = setTimeout(refresh, 1500);}

    }

    void refresh();

    return () => {disposed = true; clearTimeout(timer);};

  }, []);

  const job = jobs.find(item => item.id === selected);

  const validSeed = /^\d+$/.test(seed) && Number(seed) <= 2147483647;

  const button = 'min-h-[44px] px-3 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-sm font-semibold text-white disabled:opacity-50';

  async function generate(kind: 'image'|'video') {

    setSending(true); setError(''); setNotice('');

    try {

      const next = await localRequest<LocalJob>('/jobs', {kind, prompt, seed: Number(seed)});

      setJobs(previous => [next, ...previous]); setSelected(next.id); setBusy(true);

    } catch (e) {setError(e instanceof Error ? e.message : 'Generation failed.');}

    finally {setSending(false);}

  }

  async function cancel() {

    if (!job) return;

    try {

      const cancelled = await localRequest<LocalJob>(`/jobs/${job.id}/cancel`, {});

      setJobs(previous => previous.map(item => item.id === cancelled.id ? cancelled : item)); setNotice('');

    }

    catch(e) {setError(e instanceof Error ? e.message : 'Could not cancel.');}

  }

  return <section aria-labelledby="local-generation-heading" className="flex flex-col gap-3 border-b border-[#323A46] pb-4">

    <h3 id="local-generation-heading" className="text-base font-semibold text-white flex items-center gap-2"><Cpu className="w-4 h-4 text-[#38BDF8]" aria-hidden="true"/>Local GPU generation</h3>

    <p className="text-xs text-[#94A3B8]">SD1.5 image / AnimateDiff video · No credits. Video is generated from text, not from the selected image.</p>

    <label htmlFor="local-prompt" className="text-sm text-white">Generation prompt</label>

    <textarea id="local-prompt" rows={4} maxLength={1500} value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full p-2.5 bg-[#16191E] border-2 border-[#323A46] rounded text-sm text-white focus:border-[#38BDF8]"/>

    <label htmlFor="local-seed" className="text-xs text-[#E2E8F0]">Seed (0–2147483647)</label>

    <input id="local-seed" type="number" min="0" max="2147483647" step="1" value={seed} aria-invalid={!validSeed} onChange={e => setSeed(e.target.value)} className="min-h-[38px] p-2 bg-[#16191E] border border-[#323A46] rounded text-white"/>

    <div className="grid grid-cols-2 gap-2">

      <button type="button" className={button} disabled={!ready || busy || sending || !prompt.trim() || !validSeed} onClick={() => void generate('image')}>Generate image</button>

      <button type="button" className={button} disabled={!ready || busy || sending || !prompt.trim() || !validSeed} onClick={() => void generate('video')}>Generate video</button>

    </div>

    <p className="text-xs text-[#94A3B8]">{!ready ? 'Local runtime unavailable. Run scripts/setup_local_ai.ps1, then npm run dev.' : busy ? 'GPU busy — one generation at a time.' : '512×512 · Image ~20s · Video uses disk offload and can take a few minutes for 2 seconds.'}</p>

    {error && <p role="alert" className="text-sm text-[#FDE047]">{error}</p>}

    {jobs.length > 0 && <><label htmlFor="local-result" className="text-xs text-[#E2E8F0]">Saved local results</label><select id="local-result" value={selected} onChange={e => {setSelected(e.target.value); setNotice('');}} className="min-h-[40px] p-2 bg-[#16191E] border border-[#323A46] rounded text-white text-sm">{jobs.map(item => <option key={item.id} value={item.id}>{item.kind} · {item.status} · {item.prompt.slice(0,35)}</option>)}</select></>}

    <p role="status" className="text-sm text-[#E2E8F0]">{notice || job?.message}</p>

    {job?.status === 'running' && <button className={button} type="button" onClick={() => void cancel()}>Cancel generation</button>}

    {job?.status === 'failed' && <p role="alert" className="text-sm text-[#FDE047]">{job.error}</p>}

    {job?.status === 'completed' && <>

      <p className="text-xs text-[#94A3B8]">{job.prompt}</p>

      {job.kind === 'image' ? <img src={localAsset(job,'generated-image.png')} alt={`Generated image for: ${job.prompt}. Not visually verified.`} className="w-full rounded border border-[#323A46]"/> : <video key={job.id} controls preload="metadata" aria-label={`${job.report?.operation === 'reviewed-mask-correction' ? 'Corrected video' : 'Generated silent video'}: ${job.prompt}`} src={localAsset(job,'generated-video.mp4')} className="w-full rounded border border-[#323A46]"/>}

      {job.report && 'rawChangedOutside' in job.report ? (

        <p className="text-xs text-[#E2E8F0]">

          Reviewed mask correction · {job.report.frames} frames · {job.report.rawChangedOutside} raw pixels changed outside selections.

          Encoded outside-mask mean error: {job.report.encodedOutsideMeanError.toFixed(2)}/255. Visual continuity still needs review.

        </p>

      ) : job.report && !('rawChangedOutside' in job.report) && (

        <p className="text-xs text-[#E2E8F0]">

          {typeof job.report.inferenceSeconds === 'number' && !isNaN(job.report.inferenceSeconds) ? `${job.report.inferenceSeconds.toFixed(1)}s inference` : 'Inference time not measured'}

          {typeof job.report.cudaPeakAllocatedMiB === 'number' && !isNaN(job.report.cudaPeakAllocatedMiB) ? ` · ${job.report.cudaPeakAllocatedMiB.toFixed(0)} MiB peak PyTorch allocation` : ' · GPU allocation not measured'}

          {job.report.frames != null ? ` · ${job.report.frames} frames` : ''}

          {typeof job.report.encodingPSNRdB === 'number' && !isNaN(job.report.encodingPSNRdB) && ` · ${job.report.encodingPSNRdB.toFixed(1)} dB encoding PSNR`}

        </p>

      )}

      <p className="text-xs text-[#94A3B8]">Technical checks passed; visual quality and continuity need review. Video preview is separate from the storyboard animatic.</p>

      {job.kind === 'image' && <button type="button" className={button} disabled={isProcessing} onClick={() => {onUseImage(shotId,localAsset(job,'generated-image.png'),job.prompt); setNotice(`Image applied to Shot ${shotNumber}. Continuity is unreviewed.`);}}>Use image in Shot {shotNumber}</button>}

      {job.kind === 'video' && onUseVideo && <button type="button" className={button} disabled={isProcessing} onClick={() => {onUseVideo(shotId,localAsset(job,'generated-video.mp4'),job.prompt,job.id); setNotice(`Video applied to Shot ${shotNumber}. Continuity needs review.`);}}>Use video in Shot {shotNumber}</button>}

      <div className="flex gap-3 text-sm text-[#38BDF8]"><a download href={localAsset(job,job.kind === 'image' ? 'generated-image.png' : 'generated-video.mp4')}>Download {job.kind}</a>{job.report && <a target="_blank" rel="noreferrer" href={localMeasurementsAsset(job)}>View measurements</a>}</div>

    </>}

  </section>;

}
