/** Same framing equations as the local MP4 cameraMove filters, in canvas pixels. */
export function cameraFrame(movement:string|undefined,seconds:number,duration:number,width:number,height:number){
 const t=Math.max(0,Math.min(1,seconds/Math.max(duration,1/30)));
 let zoom=1;
 if(movement==='Push in')zoom=1+.12*t;
 else if(movement==='Dolly')zoom=1+.08*t;
 else if(movement==='Pull out')zoom=1.12-.12*t;
 else if(movement==='Pan'||movement==='Tilt')zoom=1.12;
 const w=width/zoom,h=height/zoom;
 return {x:movement==='Pan'?(width-w)*t:(width-w)/2,y:movement==='Tilt'?(height-h)*t:(height-h)/2,width:w,height:h};
}
