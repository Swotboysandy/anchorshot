import {it,expect} from 'vitest';
import {maskEvidence} from '../src/lib/maskEvidence';
import type {SamMask} from '../src/types/framelock';
const base={provenance:'live-sam-3.1',confidence:.95} as SamMask;
it('does not invent an accuracy or provider score from legacy confidence',()=>{
 expect(maskEvidence(base)).toEqual({label:'SAM RESPONSE',detail:'Provider score unavailable. Mask accuracy not measured.'});
});
it('distinguishes saved pixels and retains only a valid actual provider score',()=>{
 expect(maskEvidence({...base,serverDetached:true,providerConfidence:.9})).toEqual({label:'SAVED SAM MASK',detail:'Saved pixels; server track detached. Provider score 90.0%. Mask accuracy not measured.'});
 for(const providerConfidence of [NaN,Infinity,-1,2])expect(maskEvidence({...base,providerConfidence}).detail).toContain('score unavailable');
 expect(maskEvidence({...base,providerConfidence:0}).detail).toContain('score 0.0%');
});
it('never presents synthetic fixture confidence as measured evidence',()=>{
 expect(maskEvidence({...base,provenance:'offline-fixture',providerConfidence:.99}).detail).toBe('Sample selection; mask accuracy not measured.');
});
