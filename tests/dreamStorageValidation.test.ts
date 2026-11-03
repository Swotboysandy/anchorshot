import {expect,it} from 'vitest';
import {validateSavedRecord} from '../src/services/projectStorage';
import {applyCupSelection} from '../src/services/cupSelection';
import {DREAM,type DreamAssets} from '../src/services/dreamTransition';
const selection=()=>({name:'Cup',revision:1,photo:{width:4,height:4,data:new Uint8ClampedArray(64).fill(255)},mask:new Uint8Array(16).fill(1)});
it('rejects persisted selections that the dream compositor cannot render without changing their bytes',()=>{
 const pixels={width:DREAM.width,height:DREAM.height,data:new Uint8ClampedArray(DREAM.width*DREAM.height*4)};
 const base:DreamAssets={kitchen:pixels,ocean:pixels,anchor:pixels,mask:new Uint8Array(DREAM.width*DREAM.height)};
 for(const kind of ['empty','transparent','fifteen','partly-transparent']){
  const s=selection();if(kind==='empty')s.mask.fill(0);if(kind==='transparent')s.photo.data.fill(0);if(kind==='fifteen')s.mask[0]=0;if(kind==='partly-transparent')s.photo.data[3]=254;
  const before=structuredClone(s);
  expect(()=>applyCupSelection(base,s)).toThrow('16 opaque');
  expect(()=>validateSavedRecord('dream:test',{selection:s,umbrella:null})).toThrow('Saved masks');
  expect(s).toEqual(before);
 }
});
it('accepts the same minimum opaque footprint for either object and null when no photo was chosen',()=>{
 expect(()=>validateSavedRecord('dream:test',{selection:selection(),umbrella:selection()})).not.toThrow();
 expect(()=>validateSavedRecord('dream:test',{selection:null,umbrella:null})).not.toThrow();
});
