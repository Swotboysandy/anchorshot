import {useEffect,useRef,useState} from 'react';
import {Button} from './ui/button';
import {CupMaskEditor} from './CupMaskEditor';
import {assertVideoPlanSource,getVideoManifest,loadVideoFrame,emptyVideoTrack,decodeVideoMask,reviewVideoFrame,videoReviewProblem,suggestVideoMasks,correctReviewedVideo} from '../services/videoTracking';
import {VIDEO_COLORS,type VideoManifest,type VideoTrackPlan,type VideoColor,type CorrectedVideo} from '../types/videoTracks';
import type {Pixels} from '../services/dreamTransition';

export function VideoMaskEditor({jobId,savedPlan,onPlanChange,onApplied}:{jobId:string;savedPlan?:VideoTrackPlan;onPlanChange:(plan:VideoTrackPlan)=>void;onApplied:(result:CorrectedVideo)=>void}) {
 const [open,setOpen]=useState(false),[manifest,setManifest]=useState<VideoManifest|null>(null),[plan,setPlan]=useState<VideoTrackPlan|null>(savedPlan?.sourceJobId===jobId?savedPlan:null);
 const [index,setIndex]=useState(0),[object,setObject]=useState<'cup'|'umbrella'>('cup'),[photo,setPhoto]=useState<Pixels|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(plan&&manifest)onPlanChange(plan);},[plan,manifest,onPlanChange]);
 const operation=useRef<AbortController|null>(null);
 useEffect(()=>()=>operation.current?.abort(),[]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();setError('');setManifest(null);
  void getVideoManifest(jobId,controller.signal).then(value=>{if(controller.signal.aborted)return;if(savedPlan)assertVideoPlanSource(value,savedPlan);setManifest(value);setPlan(prev=>prev?.fingerprint===value.fingerprint?prev:{sourceJobId:jobId,fingerprint:value.fingerprint,tracks:[emptyVideoTrack(value,'cup')]});}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return ()=>controller.abort();
 },[jobId,open]);
 useEffect(()=>{
  setPhoto(null);if(!manifest||!open)return;
  const controller=new AbortController();
  void loadVideoFrame(manifest,index,controller.signal).then(value=>{if(!controller.signal.aborted)setPhoto(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return ()=>controller.abort();
 },[manifest,index,open]);
 const track=plan?.tracks.find(t=>t.objectId===object),entry=track?.frames[index];
 const problem=manifest&&plan?videoReviewProblem(manifest,plan):'Load the video first.';
 async function run(kind:'suggest'|'correct') {
  if(!manifest||!plan||!track||busy)return;
  const controller=new AbortController();operation.current=controller;setBusy(true);setError('');
  try {
   if(kind==='suggest') {
    const result=await suggestVideoMasks(manifest,track,controller.signal);
    if(!controller.signal.aborted){assertVideoPlanSource(manifest,{...plan,tracks:[result]});setPlan(p=>p?{...p,tracks:p.tracks.map(t=>t.objectId===object?result:t)}:p);}
   } else {
    const result=await correctReviewedVideo(plan,controller.signal);
    if(!controller.signal.aborted)onApplied(result);
   }
  } catch(e) {if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Video operation failed.');}
  finally {if(operation.current===controller){operation.current=null;setBusy(false);}}
 }
 return <section aria-label="Video mask review" className="space-y-3">
  <Button variant="outline" onClick={()=>{operation.current?.abort();setOpen(v=>!v);}}>{open?'Close video mask review':'Review video masks'}</Button>
  {open&&<>
   <p className="text-sm">Select each object on every frame. Motion suggestions need your review. A correction creates a new take; the source stays intact.</p>
   <p className="text-sm">Approved masks and review decisions save with this video take. Finish and approve brush edits before leaving the frame.</p>
   {error&&<p role="alert">{error}</p>}
   {manifest&&plan&&track&&<>
    <fieldset disabled={busy} className="space-y-3 min-w-0">
     <div className="flex flex-wrap gap-2">{(['cup','umbrella'] as const).map(id=><Button key={id} variant="outline" aria-pressed={object===id} onClick={()=>{if(!plan.tracks.some(t=>t.objectId===id))setPlan({...plan,tracks:[...plan.tracks,emptyVideoTrack(manifest,id)]});setObject(id);}}>{id}</Button>)}</div>
     <label className="block">Correction colour <select aria-label="Video correction colour" className="bg-background text-foreground border rounded p-2" value={track.color} onChange={e=>setPlan({...plan,tracks:plan.tracks.map(t=>t.objectId===object?{...t,color:e.target.value as VideoColor}:t)})}>{Object.keys(VIDEO_COLORS).map(color=><option key={color}>{color}</option>)}</select></label>
     <label className="block">Frame {index+1} / {manifest.frames.length}<input aria-label="Review frame" className="w-full" type="range" min="0" max={manifest.frames.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/></label>
     <p role="status">{entry?.reviewed?'Approved':'Needs review'}{entry?.absent?' · Object absent':''}. {entry?.proposalNote}</p>
     <Button variant="outline" onClick={()=>setPlan({...plan,tracks:plan.tracks.map(t=>t.objectId===object?reviewVideoFrame(manifest,t,index,new Uint8Array(manifest.frames[index].width*manifest.frames[index].height),true):t)})}>Mark {object} absent in this frame</Button>
     {photo&&entry&&<CupMaskEditor key={`${object}-${index}-${entry.revision}`} fixedFrame onDirty={()=>setPlan(p=>p?{...p,tracks:p.tracks.map(t=>t.objectId===object?{...t,frames:t.frames.map((f,i)=>i===index?{...f,reviewed:false}:f)}:t)}:p)} objectKind={object} initial={{photo,mask:decodeVideoMask(entry.maskBase64,photo.width*photo.height),name:`Frame ${index+1}`,revision:entry.revision}} onCancel={()=>setOpen(false)} onApply={selection=>setPlan({...plan,tracks:plan.tracks.map(t=>t.objectId===object?reviewVideoFrame(manifest,t,index,selection.mask):t)})}/>}
     <Button variant="outline" disabled={!track.frames.some(f=>f.reviewed)} onClick={()=>void run('suggest')}>Suggest remaining {object} masks</Button>
     <p className="text-sm">{problem||'All selected objects and frames are approved.'}</p>
     <Button disabled={Boolean(problem)} onClick={()=>void run('correct')}>Create corrected take</Button>
    </fieldset>
    {busy&&<Button variant="outline" onClick={()=>operation.current?.abort()}>Cancel video operation</Button>}
   </>}
  </>}
 </section>;
}
