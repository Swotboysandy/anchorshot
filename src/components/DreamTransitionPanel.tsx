import {loadLocal,saveLocal} from '../services/projectStorage';
import {CupMaskEditor} from './CupMaskEditor';
import {applyDreamSelections,type CupSelection} from '../services/cupSelection';
import {useEffect, useRef, useState} from 'react';
import {useReducedMotion} from 'motion/react';
import {Play, Pause, Download, ShieldCheck, Waves} from 'lucide-react';
import {DREAM, loadDreamAssets, renderDreamFrame, verifyDream, exportDream, type DreamAssets} from '../services/dreamTransition';

const button = 'min-h-[42px] px-3 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] disabled:opacity-45 text-white text-sm font-semibold rounded inline-flex items-center justify-center gap-2';
function download(blob:Blob,name:string) {
  const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function DreamTransitionPanel({projectId='legacy'}:{projectId?:string}) {
  const reduced = Boolean(useReducedMotion());
  const [open,setOpen]=useState(false);
  const [assets,setAssets]=useState<DreamAssets|null>(null);
  const [error,setError]=useState('');
  const [editing,setEditing]=useState<'cup'|'umbrella'|null>(null);
  const [umbrella,setUmbrella]=useState<CupSelection|null>(null);
  const [selection,setSelection]=useState<CupSelection|null>(null);
  const [restored,setRestored]=useState(false);
  const [saveStatus,setSaveStatus]=useState('Loading saved masks...');
  useEffect(()=>{let alive=true;loadLocal<{selection:CupSelection|null;umbrella:CupSelection|null}>(`dream:${projectId}`).then(saved=>{if(alive){setSelection(prev => prev ?? saved?.selection ?? null);setUmbrella(prev => prev ?? saved?.umbrella ?? null);setRestored(true);setSaveStatus('Masks saved locally');}}).catch(()=>{if(alive)setError('Saved masks could not be loaded. Reload to retry.');});return()=>{alive=false};},[projectId]);
  useEffect(()=>{if(!restored)return;let alive=true;setSaveStatus('Saving masks...');saveLocal(`dream:${projectId}`,{selection,umbrella}).then(()=>{if(alive)setSaveStatus('Masks saved locally');}).catch(()=>{if(alive)setError('Mask save failed. Keep this page open and free browser storage.');});return()=>{alive=false};},[selection,umbrella,restored,projectId]);
  const original=useRef<DreamAssets|null>(null);
  const [time,setTime]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [overlay,setOverlay]=useState(false);
  const [busy,setBusy]=useState<'check'|'export'|null>(null);
  const [report,setReport]=useState<Awaited<ReturnType<typeof verifyDream>>|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null), maskCanvas=useRef<HTMLCanvasElement>(null);
  const operation=useRef<AbortController|null>(null);
  const playTime=useRef(0);
  const pixels=useRef<ImageData|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  useEffect(()=>{
    if(!open || assets || !restored) return;
    let cancelled=false;setError('');
    loadDreamAssets().then(a=>{if(!cancelled){original.current=a;setAssets(applyDreamSelections(a,selection,umbrella));}}).catch(e=>{if(!cancelled)setError(`Could not load local dream assets: ${e.message}`);});
    return()=>{cancelled=true;};
  },[open,assets,restored]);
  useEffect(()=>{setPlaying(false);setReport(null);operation.current?.abort();},[reduced]);
  useEffect(()=>{
    if(!playing)return;
    let id=0;const start=performance.now()-playTime.current*1000;
    const tick=()=>{const t=Math.min(DREAM.duration,(performance.now()-start)/1000);setTime(Math.floor(t*DREAM.fps)/DREAM.fps);playTime.current=t;
      if(t>=DREAM.duration)setPlaying(false);else id=requestAnimationFrame(tick);};
    id=requestAnimationFrame(tick);
    const hide=()=>{if(document.hidden)setPlaying(false);};document.addEventListener('visibilitychange',hide);
    return()=>{cancelAnimationFrame(id);document.removeEventListener('visibilitychange',hide);};
  },[playing]);
  useEffect(()=>{
    if(!assets || !open || !canvas.current)return;
    const ctx=canvas.current.getContext('2d')!;
    const frame=pixels.current ||= ctx.createImageData(DREAM.width,DREAM.height);
    renderDreamFrame(assets,frame.data,time,reduced);ctx.putImageData(frame,0,0);
  },[assets,time,reduced,open]);
  useEffect(()=>{
    if(!assets || !maskCanvas.current)return;
    const ctx=maskCanvas.current.getContext('2d')!, img=ctx.createImageData(DREAM.width,DREAM.height);
    for(let i=0;i<assets.mask.length;i++)if(assets.mask[i])img.data.set([255,255,255,130],i*4);
    ctx.putImageData(img,0,0);
  },[assets,overlay,open]);
  const seek=(t:number)=>{setPlaying(false);setTime(t);playTime.current=t;};
  const run=async(kind:'check'|'export')=>{
    if(!assets || busy || editing)return;
    setPlaying(false);setError('');setBusy(kind);
    const controller=new AbortController();operation.current=controller;
    try {
      if(kind==='check')setReport(await verifyDream(assets,reduced,controller.signal));
      else download(await exportDream(assets,reduced,controller.signal,t=>{setTime(t);playTime.current=t;}),'anchorshot-kitchen-to-ocean.webm');
    } catch(e) {setError(e instanceof Error?e.message:'Operation failed.');}
    finally {setBusy(null);operation.current=null;}
  };
  const updateSelections = (cup: CupSelection | null, second: CupSelection | null) => {
    try {
      const next = applyDreamSelections(original.current!, cup, second);
      setSelection(cup);
      setUmbrella(second);
      setAssets(next);
      setReport(null);
      setOverlay(false);
      setEditing(null);
      seek(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply dream selections.');
    }
  };

  return <section aria-label="Kitchen to ocean dream study" className="bg-[#1E232B] border-2 border-[#323A46] rounded-lg overflow-hidden">
    <button type="button" aria-expanded={open} aria-controls="dream-study" disabled={Boolean(busy)||Boolean(editing)} onClick={()=>{setOpen(!open);setPlaying(false);}}
      className="w-full p-4 text-left flex flex-wrap items-center justify-between gap-3 text-white">
      <span className="flex items-center gap-2 font-semibold"><Waves size={18} aria-hidden="true"/> Kitchen → ocean <span className="text-xs text-[#CBD5E1] font-mono">LOCAL DREAM STUDY</span></span>
      <span className="text-sm underline underline-offset-4">{open?'Close study':'Open dream transition'}</span>
    </button>
    {open && <div id="dream-study" className="p-4 pt-0 space-y-4">
      <div className="flex flex-wrap justify-between gap-2 text-sm text-[#CBD5E1]">
        <p>Two worlds. {umbrella?'Cup and umbrella protected.':'One protected cup.'} A 12-second local composite.</p>
        <span className="inline-flex items-center gap-1"><ShieldCheck size={16} aria-hidden="true"/> {umbrella?'Two layers protected':'Cup layer protected'}</span>
      </div>
      <p role="status" aria-label="Mask save status">{saveStatus}</p>
      {!assets && !error && <p role="status">Loading local backgrounds…</p>}
      {assets && <>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>{setEditing('cup');setPlaying(false);setReport(null);}}>{selection?'Edit cup mask':'Select real cup'}</button>
          {selection && <button type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>updateSelections(null, umbrella)}>Restore illustrated cup</button>}
          {selection && (
            <span className="text-sm text-[#CBD5E1] inline-flex items-center gap-2">
              <span>{selection.source === 'sam-3.1-photo' ? '✨ SAM 3.1 cutout' : 'Approved photo mask'} · revision {selection.revision}</span>
              {selection.provenance && (
                <span className="text-xs px-2 py-0.5 rounded bg-[#16191E] border border-[#38BDF8]/60 text-[#38BDF8]">
                  {selection.provenance}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>{setEditing('umbrella');setPlaying(false);setReport(null);}}>{umbrella?'Edit umbrella mask':'Select umbrella'}</button>
          {umbrella && <><span className="text-sm text-white">Approved umbrella mask - revision {umbrella.revision}</span><button type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>updateSelections(selection, null)}>Remove umbrella</button></>}
        </div>
        {editing && <CupMaskEditor key={editing} objectKind={editing} initial={editing==='cup'?selection:umbrella} onCancel={()=>setEditing(null)} onApply={s=>{
          const cup=editing==='cup'?s:selection,second=editing==='umbrella'?s:umbrella;
          updateSelections(cup, second);
        }}/>}


        <div className="flex flex-wrap gap-2">
          {assets.anchors?.map(anchor=><button key={anchor.id} type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>{
            const c=document.createElement('canvas');c.width=DREAM.width;c.height=DREAM.height;const ctx=c.getContext('2d')!,p=ctx.createImageData(c.width,c.height);
            for(let i=0;i<anchor.mask.length;i++){const v=anchor.mask[i]?255:0;p.data.set([v,v,v,255],i*4);}ctx.putImageData(p,0,0);c.toBlob(blob=>{if(blob)download(blob,`anchorshot-${anchor.id}-mask.png`);});
          }}>Save {anchor.id} mask</button>)}
        </div>
        <div className="relative aspect-video bg-[#121417] rounded border border-[#323A46] overflow-hidden">
          <canvas ref={canvas} width={DREAM.width} height={DREAM.height} role="img" aria-label={`Kitchen transforming into ocean with stationary protected ${umbrella?'cup and umbrella':'cup'}`} className="w-full h-full"/>
          {overlay && <canvas ref={maskCanvas} width={DREAM.width} height={DREAM.height} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none"/>}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} aria-label={playing?'Pause dream':'Play dream'} onClick={()=>{if(time>=DREAM.duration)seek(0);setPlaying(!playing);}}>
            {playing?<Pause size={17}/>:<Play size={17}/>}<span>{playing?'Pause':'Play'}</span>
          </button>
          <label className="flex-1 min-w-0"><span className="sr-only">Dream time</span><input type="range" aria-label="Dream time" min="0" max={DREAM.duration} step="0.01" value={time} disabled={Boolean(busy)||Boolean(editing)} onChange={e=>seek(Number(e.target.value))} className="w-full accent-white"/></label>
          <output aria-live="off" className="text-sm font-mono text-white tabular-nums">{time.toFixed(1)} / 12s</output>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          {[[0,'Kitchen'],[6,'World changing'],[12,'Ocean']].map(([t,label])=><button key={t} type="button" className={button} disabled={Boolean(busy)||Boolean(editing)} onClick={()=>seek(Number(t))}>{label}</button>)}
        </div>
        <p className="text-[#E2E8F0] text-sm leading-relaxed">{time<6?'“I was in my grandmother’s kitchen, holding a cup. The tiles began to move like water.”':'“The room opened into an ocean. I was still holding the same cup.”'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={button} type="button" aria-pressed={overlay} onClick={()=>setOverlay(!overlay)}>{overlay?'Hide':'Show'} protected region</button>
          <button className={button} type="button" disabled={Boolean(busy)||Boolean(editing)} onClick={()=>void run('check')}>{busy==='check'?'Checking 289 frames…':umbrella?'Check both objects':'Check cup preservation'}</button>
          <button className={button} type="button" disabled={Boolean(busy)||Boolean(editing)} onClick={()=>void run('export')}><Download size={16} aria-hidden="true"/>{busy==='export'?'Exporting…':'Export dream WebM'}</button>
          <button className={button} type="button" disabled={Boolean(busy)||Boolean(editing)} onClick={()=>{
            const c=document.createElement('canvas');c.width=DREAM.width;c.height=DREAM.height;const ctx=c.getContext('2d')!,p=ctx.createImageData(c.width,c.height);
            for(let i=0;i<assets.mask.length;i++){const v=assets.mask[i]?255:0;p.data.set([v,v,v,255],i*4);}ctx.putImageData(p,0,0);
            c.toBlob(blob=>{if(blob)download(blob,'anchorshot-protected-mask.png');});
          }}>Save protection mask</button>
          <button className={button} type="button" disabled={Boolean(busy)||Boolean(editing)} onClick={()=>canvas.current?.toBlob(blob=>{if(blob)download(blob,'anchorshot-dream-frame.png');})}>Save PNG frame</button>
          {busy && <button className={button} type="button" onClick={()=>operation.current?.abort()}>Cancel {busy==='check'?'check':'export'}</button>}
        </div>
        {report && <div role="status" aria-label="Cup preservation results" className="text-sm text-[#E2E8F0] border border-[#4B5563] rounded p-3 space-y-1">
          <p>{report.passed?'PASS':'FAIL'} · {report.framesChecked} frames · {report.changedProtectedPixelsAcrossFrames} changed protected pixels · render p95 {report.renderP95Ms} ms</p>
          {report.objects.map(object=><p key={object.id} aria-label={`${object.id} preservation score`}>{object.id}: {object.protectedPixels} protected pixels - {object.changedProtectedPixelsAcrossFrames} changed pixels - revision {object.revision}</p>)}
          <p>Measured on uncompressed frames. WebM compression can change pixel values. Export is silent.</p>
          <button type="button" className="underline underline-offset-4" onClick={()=>download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'anchorshot-dream-check.json')}>Save quality report</button>
        </div>}
      </>}
      {error && <p role="alert" className="text-[#FDE047] text-sm">{error}</p>}
      <p className="text-xs text-[#CBD5E1] leading-relaxed">Local SD1.5 backgrounds · {selection?'approved photo mask':'authored cup + shadow mask'} · ripple/reveal compositor · no SAM or cloud calls. {reduced?'Reduced motion: a cut replaces the ripple in preview and export.':'Scrub or play to review. The protection overlay is excluded from exports.'}</p>
    </div>}
  </section>;
}
