import {useEffect,useRef,useState} from 'react';
import {Button} from './ui/button';
import {readNarration,type NarrationAttachment} from '../services/narration';
export function SceneNarration({url,name,onChange}:{url?:string;name?:string;onChange:(value:NarrationAttachment|null)=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),request=useRef(0);
 useEffect(()=>()=>{request.current++;},[]);
 async function upload(file:File){
  const id=++request.current;setBusy(true);setError('');
  try {const attachment=await readNarration(file);if(id===request.current)onChange(attachment);}
  catch(e){if(id===request.current)setError(e instanceof Error?e.message:'Audio could not be attached.');}
  finally{if(id===request.current)setBusy(false);}
 }
 return <section aria-label="Scene narration" className="space-y-3 border-b border-border pb-4">
  <h3 className="text-base font-semibold">Scene narration</h3>
  <p className="text-sm">Add your recording. Up to 5 MB and 14.6 seconds. The scene expands if needed to include the full recording and a short pause. Attached narration replaces this scene’s original video audio in playback and export.</p>
  <label className="block text-sm">Narration audio<input className="block max-w-full mt-2" aria-label="Upload scene narration" type="file" accept=".mp3,.wav,.ogg,.webm,.m4a,.mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/></label>
  {busy&&<p role="status">Checking audio locally...</p>}{error&&<p role="alert">{error}</p>}
  {url&&<><p className="text-sm break-words">{name||'Attached narration'}</p><audio className="w-full" controls src={url} aria-label="Preview scene narration"/><Button variant="outline" disabled={busy} onClick={()=>onChange(null)}>Remove narration</Button></>}
 </section>;
}
