import {useCallback,useEffect,useRef,useState} from 'react';
/** A source-bound player following the same clock as the film, including paused seeks. */
export function TimelineNarration({src,offset,playing,muted,onPlaybackError}:{src:string;offset:number;playing:boolean;muted:boolean;onPlaybackError?:(message:string)=>void}){
 const ref=useRef<HTMLAudioElement>(null),alive=useRef(true),[error,setError]=useState('');
 const request=useRef(0),pending=useRef<number|null>(null);
 const latest=useRef({playing,onPlaybackError});latest.current={playing,onPlaybackError};
 useEffect(()=>{alive.current=true;const audio=ref.current;return()=>{alive.current=false;request.current++;pending.current=null;audio?.pause();};},[]);
 const fail=useCallback((message:string)=>{
  if(!alive.current)return;
  ref.current?.pause();setError(message);latest.current.onPlaybackError?.(message);
 },[]);
 const sync=useCallback(()=>{
  const audio=ref.current;if(!audio||!Number.isFinite(audio.duration))return;
  const target=Math.max(0,Math.min(offset,audio.duration));
  if(Math.abs(audio.currentTime-target)>.15)audio.currentTime=target;
  if(!playing||offset<0||offset>=audio.duration){request.current++;pending.current=null;audio.pause();return;}
  if(!audio.paused||pending.current!==null)return;
  const id=++request.current;pending.current=id;
  void audio.play().then(()=>{
   if(!alive.current||!latest.current.playing){audio.pause();return;}
   if(request.current===id)setError('');
  }).catch(()=>{
   if(alive.current&&latest.current.playing&&request.current===id)fail('Narration playback could not start. Press Play to retry or reattach the audio file.');
  }).finally(()=>{if(pending.current===id)pending.current=null;});
 },[offset,playing,fail]);
 useEffect(sync,[sync]);
 return <><audio ref={ref} src={src} muted={muted} preload="auto" aria-label="Film narration" onLoadedMetadata={sync} onError={()=>fail('Scene narration could not be played. Reattach its audio file.')} hidden/>{error&&<p role="alert">{error}</p>}</>;
}
