import {VIDEO_COLORS} from '../types/videoTracks';
import {localRequest} from './localGeneration';
import type {Pixels} from './dreamTransition';
import type {VideoManifest, VideoMaskFrame, VideoObjectTrack, VideoTrackPlan, CorrectedVideo} from '../types/videoTracks';

export function encodeVideoMask(mask: Uint8Array): string {
  if (mask.some(value => value !== 0 && value !== 1)) throw new Error('Mask must contain only selected or unselected pixels.');
  let encoded = '';
  for (let start = 0; start < mask.length; start += 8192) encoded += String.fromCharCode(...mask.subarray(start, start + 8192));
  return btoa(encoded);
}
export function decodeVideoMask(value: string, pixels: number): Uint8Array {
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > 1024 * 1024 || value.length !== 4 * Math.ceil(pixels / 3)) throw new Error('Mask dimensions do not match this frame.');
  const decoded = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (decoded.length !== pixels || decoded.some(v => v !== 0 && v !== 1)) throw new Error('Invalid video selection.');
  return decoded;
}
export function emptyVideoTrack(manifest: VideoManifest, objectId: 'cup' | 'umbrella'): VideoObjectTrack {
  return {objectId, color: objectId === 'cup' ? 'blue' : 'amber', frames: manifest.frames.map(frame => ({
    frameIndex: frame.index, sourceHash: frame.sourceHash, maskBase64: encodeVideoMask(new Uint8Array(frame.width * frame.height)),
    revision: 1, absent: false, reviewed: false, method: 'manual',
  }))};
}
/** Approval belongs to this exact source frame and object, never to a later proposal. */
export function reviewVideoFrame(manifest: VideoManifest, track: VideoObjectTrack, index: number, mask: Uint8Array, absent = false): VideoObjectTrack {
  const frame = manifest.frames[index];
  if (!frame || frame.index !== index || mask.length !== frame.width * frame.height) throw new Error('Selection does not match this frame.');
  const count = mask.reduce((sum, value) => sum + value, 0);
  if (absent ? count !== 0 : count < 16) throw new Error(absent ? 'An absent object must have an empty mask.' : 'Select at least 16 pixels.');
  const previous = track.frames[index];
  const reviewed: VideoMaskFrame = {frameIndex:index, sourceHash:frame.sourceHash, maskBase64:encodeVideoMask(mask),
    revision:(previous?.revision || 0)+1, absent, reviewed:true, method:'manual'};
  return {...track, frames:track.frames.map((entry, i) => i === index ? reviewed : entry)};
}
export function videoReviewProblem(manifest: VideoManifest, plan: VideoTrackPlan): string | null {
  if (plan.sourceJobId !== manifest.jobId || plan.fingerprint !== manifest.fingerprint) return 'The video changed. Review its new frames.';
  if (!plan.tracks.length || plan.tracks.length > 2 || new Set(plan.tracks.map(t=>t.objectId)).size !== plan.tracks.length) return 'Choose distinct cup and umbrella tracks.';
  const occupied = manifest.frames.map(f=>new Uint8Array(f.width*f.height));
  for (const track of plan.tracks) {
    if (track.frames.length !== manifest.frames.length) return 'Every frame needs a selection or an absence decision.';
    for (const frame of manifest.frames) {
      const selection = track.frames[frame.index];
      if (!selection?.reviewed || selection.frameIndex !== frame.index || selection.sourceHash !== frame.sourceHash) return `Review ${track.objectId} in frame ${frame.index+1}.`;
      let mask: Uint8Array;
      try {mask=decodeVideoMask(selection.maskBase64,frame.width*frame.height);} catch {return 'A saved mask is invalid. Select it again.';}
      const count = mask.reduce((sum,v)=>sum+v,0);
      if (selection.absent ? count !== 0 : count < 16) return `Correct ${track.objectId} in frame ${frame.index+1}.`;
      for(let p=0;p<mask.length;p++) if(mask[p]) {
        if(occupied[frame.index][p]) return `Selections overlap in frame ${frame.index+1}. Correct their edges.`;
        occupied[frame.index][p]=1;
      }
    }
  }
  return null;
}
export async function loadVideoFrame(manifest: VideoManifest, index: number, signal: AbortSignal): Promise<Pixels> {
  const frame=manifest.frames[index];
  if(!frame || frame.url !== `/api/local-ai/jobs/${manifest.jobId}/assets/frame-${String(index).padStart(3,'0')}.png`) throw new Error('Invalid frame source.');
  const response=await fetch(frame.url,{signal});
  if(!response.ok) throw new Error('This video frame is unavailable.');
  const blob=await response.blob();
  if(blob.size>8*1024*1024) throw new Error('Frame exceeds the review size limit.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==frame.sourceHash) throw new Error('The source frame changed. Reload the video before selecting.');
  signal.throwIfAborted();
  const bitmap=await createImageBitmap(blob);
  try {
    signal.throwIfAborted();
    if(bitmap.width!==frame.width || bitmap.height!==frame.height || bitmap.width*bitmap.height>1024*1024) throw new Error('Frame dimensions changed.');
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas is unavailable.');
    ctx.drawImage(bitmap,0,0);
    return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
  } finally {bitmap.close();}
}
export const getVideoManifest=(id:string,signal:AbortSignal)=>localRequest<VideoManifest>(`/jobs/${encodeURIComponent(id)}/frames`,undefined,30000,signal);
export const suggestVideoMasks=(manifest:VideoManifest,track:VideoObjectTrack,signal:AbortSignal)=>localRequest<VideoObjectTrack>(`/jobs/${encodeURIComponent(manifest.jobId)}/track`,{fingerprint:manifest.fingerprint,track},90000,signal);
export const correctReviewedVideo=(plan:VideoTrackPlan,signal:AbortSignal)=>localRequest<CorrectedVideo>(`/jobs/${encodeURIComponent(plan.sourceJobId)}/correct`,plan,90000,signal);

/** Draft masks may be unreviewed, but cannot belong to different source frames. */
export function assertVideoPlanSource(manifest:VideoManifest,plan:VideoTrackPlan):void {
 if(plan.sourceJobId!==manifest.jobId||plan.fingerprint!==manifest.fingerprint)throw new Error('This video changed. Saved selections have been retained but cannot be applied to these frames.');
 for(const track of plan.tracks){
  if(track.frames.length!==manifest.frames.length)throw new Error('Saved selections have a different frame count.');
  for(const frame of manifest.frames){
   const mask=track.frames[frame.index];
   if(!mask||mask.frameIndex!==frame.index||mask.sourceHash!==frame.sourceHash)throw new Error('A saved selection belongs to a different source frame.');
   decodeVideoMask(mask.maskBase64,frame.width*frame.height);
  }
 }
}

/** A command edits only the explicitly named, reviewed object on the current source. */
export async function correctReviewedVideoObject(jobId:string,plan:VideoTrackPlan|undefined,object:string,color:string,signal:AbortSignal):Promise<CorrectedVideo>{
 const objectId=object.toLowerCase()==='mug'?'cup':object.toLowerCase();
 if(objectId!=='cup'&&objectId!=='umbrella')throw new Error('Video correction supports reviewed cup and umbrella masks.');
 if(!Object.hasOwn(VIDEO_COLORS,color))throw new Error('Choose blue, emerald, amber, red, purple or white for video correction.');
 if(!plan||plan.sourceJobId!==jobId)throw new Error('Open Review video masks and approve this object in every frame first.');
 const tracks=plan.tracks.filter(track=>track.objectId===objectId);
 if(tracks.length!==1)throw new Error(`Review one ${objectId} track before correcting this video.`);
 const selected:VideoTrackPlan={...plan,tracks:[{...tracks[0],color:color as keyof typeof VIDEO_COLORS}]};
 const manifest=await getVideoManifest(jobId,signal);
 const problem=videoReviewProblem(manifest,selected);if(problem)throw new Error(problem);
 return correctReviewedVideo(selected,signal);
}
