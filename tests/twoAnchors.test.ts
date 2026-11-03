import {it,expect} from 'vitest';
import {applyDreamSelections,brushMask,type CupSelection} from '../src/services/cupSelection';
import {DREAM,verifyDream,renderDreamFrame,type DreamAssets} from '../src/services/dreamTransition';
const photo=(color:number)=>({width:20,height:20,data:Uint8ClampedArray.from({length:1600},(_,i)=>i%4===3?255:color)});
const selection=(color:number):CupSelection=>({photo:photo(color),mask:new Uint8Array(400).fill(1),name:'test',revision:1});
const base=():DreamAssets=>{const p={width:800,height:450,data:new Uint8ClampedArray(800*450*4).fill(30)};return {kitchen:p,ocean:{...p,data:new Uint8ClampedArray(p.data.length).fill(220)},anchor:p,mask:new Uint8Array(800*450)};};
it('preserves two independent masks through all 301 transition frames',async()=>{
 const a=applyDreamSelections(base(),selection(80),selection(150));
 const report=await verifyDream(a);expect(report.passed).toBe(true);expect(report.framesChecked).toBe(301);
 expect(report.objects.map(o=>o.id)).toEqual(['cup','umbrella']);
 for(const score of report.objects){expect(score.protectedPixels).toBeGreaterThan(0);expect(score.changedProtectedPixelsAcrossFrames).toBe(0);}
 const first=new Uint8ClampedArray(a.anchor.data.length),last=first.slice();renderDreamFrame(a,first,0);renderDreamFrame(a,last,DREAM.duration);
 expect(first[0]).not.toBe(last[0]);
}, 30000);
it('correcting or removing umbrella cannot change cup pixels or its mask',()=>{
 const cup=selection(80),umbrella=selection(150),b=base(),a=applyDreamSelections(b,cup,umbrella);
 const corrected={...umbrella,revision:2,mask:brushMask(umbrella.mask,20,20,{x:10,y:10},{x:10,y:10},4,false)};
 const next=applyDreamSelections(b,cup,corrected);expect(next.anchors![0].mask).toEqual(a.anchors![0].mask);
 expect(next.anchors![1].mask).not.toEqual(a.anchors![1].mask);expect(next.anchors![1].revision).toBe(2);
 const removed=applyDreamSelections(b,cup,null);
 for(let i=0;i<a.mask.length;i++)if(a.anchors![0].mask[i]){
  for(let k=0;k<4;k++) expect(next.anchor.data[i*4+k]).toBe(removed.anchor.data[i*4+k]);
 }
 expect(umbrella.mask.every(v=>v===1)).toBe(true);
});
it('rejects empty or corrupt second selection without modifying approved input',()=>{
 const cup=selection(80),b=base(),snapshot=cup.mask.slice();
 for(const mask of [new Uint8Array(400),new Uint8Array(400).fill(255),new Uint8Array(2)])expect(()=>applyDreamSelections(b,cup,{...selection(150),mask})).toThrow();
 expect(cup.mask).toEqual(snapshot);
});

it('handles browser-style nonenumerable image dimensions',()=>{
 const b=base();for(const image of [b.kitchen,b.ocean,b.anchor])Object.defineProperties(image,{width:{value:800,enumerable:false},height:{value:450,enumerable:false}});
 const a=applyDreamSelections(b,selection(80),selection(150));expect(a.anchor.width).toBe(800);expect(a.anchor.height).toBe(450);
});
