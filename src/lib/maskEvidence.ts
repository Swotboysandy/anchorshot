import type {SamMask} from '../types/framelock';

/** Provider scores are not measured overlap against a ground-truth mask. */
export function maskEvidence(mask:SamMask){
 if(mask.provenance!=='live-sam-3.1')return {label:'OFFLINE FIXTURE',detail:'Sample selection; mask accuracy not measured.'};
 const score=mask.providerConfidence;
 const measured=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=1;
 return {label:mask.serverDetached?'SAVED SAM MASK':'SAM RESPONSE',
  detail:`${mask.serverDetached?'Saved pixels; server track detached. ':''}${measured?`Provider score ${(score*100).toFixed(1)}%.`:'Provider score unavailable.'} Mask accuracy not measured.`};
}
