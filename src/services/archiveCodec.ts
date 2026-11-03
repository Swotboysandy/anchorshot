const TAG='__anchorshotBinary';
const LIMIT=200*1024*1024;
/** JSON transport that retains exact binary mask/photo array types. */
export function encodeArchive(value:unknown):string{
 const text=JSON.stringify(value,(_key,value)=>{
  if(value instanceof Uint8Array||value instanceof Uint8ClampedArray){
   let raw='';for(let i=0;i<value.length;i+=8192)raw+=String.fromCharCode(...value.subarray(i,i+8192));
   return {[TAG]:value instanceof Uint8ClampedArray?'rgba':'mask',base64:btoa(raw)};
  }
  if(value&&typeof value==='object'&&Object.hasOwn(value,TAG))throw new Error('Reserved archive field.');
  return value;
 });
 if(!text||text.length>LIMIT)throw new Error('Project backup exceeds the 200 MB limit.');
 return text;
}
export function decodeArchive(text:string):unknown{
 if(text.length>LIMIT)throw new Error('Project backup exceeds the 200 MB limit.');
 let totalBinary=0;
 return JSON.parse(text,(_key,value)=>{
  if(!value||typeof value!=='object'||!Object.hasOwn(value,TAG))return value;
  if(Object.keys(value).length!==2||!['rgba','mask'].includes(value[TAG])||typeof value.base64!=='string')throw new Error('Invalid binary archive record.');
  const raw=atob(value.base64);totalBinary+=raw.length;
  if(totalBinary>128*1024*1024||btoa(raw)!==value.base64)throw new Error('Invalid or oversized binary archive.');
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return value[TAG]==='rgba'?new Uint8ClampedArray(bytes):bytes;
 });
}
