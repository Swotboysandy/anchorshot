export interface NarrationAttachment {dataUrl:string;name:string;durationSeconds:number}
const MAX_BYTES=5*1024*1024;
export function validNarrationUrl(value:unknown):boolean {
 if(typeof value!=='string'||value.length>6990600)return false;
 const match=/^data:audio\/(?:mpeg|wav|x-wav|webm|ogg|mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match)return false;
 try {const bytes=atob(match[1]);return bytes.length>0&&bytes.length<=MAX_BYTES&&btoa(bytes)===match[1];}catch{return false;}
}
export async function readNarration(file:File):Promise<NarrationAttachment>{
 if(!file.size||file.size>MAX_BYTES)throw new Error('Choose an audio file up to 5 MB.');
 const types:Record<string,string>={mp3:'audio/mpeg',wav:'audio/wav',webm:'audio/webm',ogg:'audio/ogg',m4a:'audio/mp4',mp4:'audio/mp4'};
 const mime=types[file.name.split('.').pop()?.toLowerCase()||''];
 if(!mime)throw new Error('Choose MP3, WAV, Ogg, WebM or M4A audio.');
 const bytes=await file.arrayBuffer(),context=new AudioContext();
 let duration:number;
 try {duration=(await context.decodeAudioData(bytes.slice(0))).duration;}
 catch {throw new Error('This audio file could not be decoded. Try WAV or MP3.');}
 finally {await context.close();}
 if(!Number.isFinite(duration)||duration<=0||duration>14.6)throw new Error('Scene narration must be 14.6 seconds or shorter to fit the 15-second scene limit.');
 const buffer=new Uint8Array(bytes);let binary='';
 for(let i=0;i<buffer.length;i+=8192)binary+=String.fromCharCode(...buffer.subarray(i,i+8192));
 return {dataUrl:`data:${mime};base64,${btoa(binary)}`,name:file.name.slice(0,120),durationSeconds:duration};
}
