import * as canvasEngine from '../src/services/canvasEngine';
import { describe, expect, it, vi } from 'vitest';
import { brand } from '../src/brand';
import {
  getTargetObjectBox,
  resolveColorPalette,
  verifyMaskedPixelDiff,
} from '../src/services/canvasEngine';
import { DIRECTOR_PRESETS, metaModelClient } from '../src/services/metaModels';

describe('Anchorshot Voice Studio — Local 4-Role Pipeline Verification', () => {
  it('verifies finalized Anchorshot brand identity', () => {
    expect(brand.name).toBe('Anchorshot');
    expect(brand.provisional).toBe(false);
  });

  it('Role 1 (Director Agent): extracts versioned continuity rules from transcript', async () => {
    const preset = DIRECTOR_PRESETS[0];
    const rules = await metaModelClient.extractContinuityRules(preset.transcript);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules[0]).toMatchObject({
      id: 'rule-cup-color',
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    });
  });

  it('Role 2 (SAM & Checks): computes deterministic target bounding boxes across camera angles', () => {
    const wideBox = getTargetObjectBox('wide', 'cup');
    const closeupBox = getTargetObjectBox('closeup', 'cup');
    expect(wideBox.width).toBeGreaterThan(0);
    expect(closeupBox.width).toBeGreaterThan(wideBox.width);
    expect(resolveColorPalette('emerald').primary).toBe('#10B981');
  });

  it('Role 3 (Editing & Export): proves 0 outside-mask pixel drift on masked continuity repair', () => {
    const width = 80;
    const height = 45;
    const before = new Uint8ClampedArray(width * height * 4).fill(40);
    const after = before.slice();

    const box = { x: 25, y: 20, width: 25, height: 40 }; // px: x=[20..40), y=[9..27)
    // Modify pixels strictly inside the SAM 3.1 mask box
    for (let y = 10; y < 25; y++) {
      for (let x = 22; x < 38; x++) {
        const idx = (y * width + x) * 4;
        after[idx] = 37;
        after[idx + 1] = 99;
        after[idx + 2] = 235;
      }
    }

    const report = verifyMaskedPixelDiff(
      before,
      after,
      width,
      height,
      box,
      'sam-3.1:cup-shot-2:v1',
      2
    );

    expect(report.maskRef).toBe('sam-3.1:cup-shot-2:v1');
    expect(report.ruleRevision).toBe(2);
    expect(report.changedInsideMask).toBe(15 * 16);
    expect(report.changedOutsideMask).toBe(0);
    expect(report.outsideDriftPercent).toBe(0);
  });

  it('Role 2 (SAM & Checks): disambiguates uncertain shots with 4-segment maskRef and multi-digit revision', async () => {
    const emeraldRules = await metaModelClient.extractContinuityRules(DIRECTOR_PRESETS[2].transcript);
    expect(emeraldRules[0].expectedValue).toBe('emerald');

    const resolved = await metaModelClient.disambiguateMaskSelection(
      {
        id: 'shot-4',
        shotNumber: 4,
        durationSeconds: 3.5,
        promptDescription: 'Over-the-shoulder courier jacket check',
        spokenDescription: 'Uncertain shot',
        currentImageUrl: 'data:image/png;base64,AAA=',
        originalImageUrl: 'data:image/png;base64,AAA=',
        status: 'uncertain',
        discrepancyMessage: 'Ambiguous occlusion',
        proposedFix: {
          action: 'recolor',
          targetObject: 'courier jacket',
          targetColor: 'emerald',
          mask: {
            id: 'mask-1',
            maskRef: 'sam-3.1:courier-jacket:0:v12',
            objectId: '0',
            maskBase64: 'data:image/png;base64,AAA=',
            box: { x: 20, y: 20, width: 30, height: 40 },
            confidence: 0.72,
          },
        },
        revisions: [],
      },
      '0'
    );

    expect(resolved.status).toBe('uncertain');
    expect(resolved.proposedFix?.mask?.candidateCount).toBe(1);
    expect(resolved.proposedFix?.mask?.objectId).toBe('0');
    expect(resolved.proposedFix?.mask?.maskRef).toBe('sam-3.1:courier-jacket:0:v12');
  });
});


it('audits cup and umbrella independently and keeps the worst result for the shot', async () => {
  const shot = {id:'s',shotNumber:1,promptDescription:'Cup and umbrella',currentImageUrl:'frame',originalImageUrl:'frame',spokenDescription:'',status:'uncertain',durationSeconds:2,revisions:[]} as const;
  const rules = ['cup','umbrella'].map(targetObject => ({ id:targetObject, targetObject, property:'color', expectedValue:'blue', revision:1, scope:'all_shots' as const }));
  const audit = vi.spyOn(metaModelClient, 'auditShotContinuity').mockImplementation(async (value,rule) => ({...value,status:rule.targetObject==='cup'?'consistent':'mismatch',spokenDescription:rule.targetObject,
    proposedFix:rule.targetObject==='umbrella'?{action:'recolor',targetObject:'umbrella',targetColor:'blue'}:undefined}));
  try {
    const [result] = await metaModelClient.auditAllShots([{...shot,revisions:[]}],rules);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('mismatch');
    expect(result.proposedFix?.targetObject).toBe('umbrella');
    expect(result.continuityChecks?.map(check => [check.targetObject,check.status])).toEqual([['cup','consistent'],['umbrella','mismatch']]);
  } finally {audit.mockRestore();}
});

it('refuses an object id that has no candidate mask', async () => {
  await expect(metaModelClient.disambiguateMaskSelection({id:'s',shotNumber:1,durationSeconds:2,promptDescription:'',spokenDescription:'',currentImageUrl:'frame',originalImageUrl:'frame',status:'uncertain',revisions:[]},'unseen-object')).rejects.toThrow('no selectable mask');
});


it('rejects a sample mask and a stale live mask for a generated image', async () => {
  const shot = {id:'s',shotNumber:1,durationSeconds:2,promptDescription:'',spokenDescription:'',currentImageUrl:'/api/muse/frames/new.png',originalImageUrl:'/api/muse/frames/new.png',status:'uncertain',revisions:[],
    proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'m',box:{x:0,y:0,width:10,height:10},confidence:1,maskBase64:'mask',provenance:'offline-fixture'}}} as import('../src/types/framelock').StoryboardShot;
  await expect(metaModelClient.applyContinuityFix(shot)).rejects.toThrow('real object mask');
  shot.proposedFix!.mask!.provenance='live-sam-3.1';
  shot.proposedFix!.mask!.sourceImageUrl='/api/muse/frames/old.png';
  await expect(metaModelClient.applyContinuityFix(shot)).rejects.toThrow('another frame');
});


it('retains a saved raster locally after the mask server restarts without submitting an old reference',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({maskSessionId:'new-server',sessionToken:'new-token'}),{headers:{'Content-Type':'application/json'}}));
 vi.stubGlobal('fetch',fetcher);
 const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'Cup',spokenDescription:'Cup',currentImageUrl:'/api/muse/frames/frame.png',originalImageUrl:'/api/muse/frames/frame.png',status:'uncertain',revisions:[],
 proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'sam:old',serverSessionId:'old-server',segmentationId:'old-result',sourceHash:'a'.repeat(64),sourceImageUrl:'/api/muse/frames/frame.png',box:{x:0,y:0,width:10,height:10},confidence:.9,maskBase64:'saved-raster',provenance:'live-sam-3.1'}}} as import('../src/types/framelock').StoryboardShot;
 try{
  const selected=await metaModelClient.disambiguateMaskSelection(shot,'0');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledWith('/api/health',{signal:expect.any(AbortSignal)});
  expect(selected.proposedFix?.mask).toMatchObject({maskBase64:'saved-raster',serverDetached:true,candidateCount:1});
  expect(selected.status).toBe('uncertain');
  expect(shot.proposedFix?.mask?.serverDetached).toBeUndefined();
 }finally{vi.unstubAllGlobals();}
});


it.each(['MASK_SOURCE_CHANGED','MASK_RESULT_CHANGED'])('a replaced server track (%s) keeps its original saved raster locally selectable',async(code)=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({maskSessionId:'same-server',sessionToken:'token'})))
  .mockResolvedValueOnce(new Response(JSON.stringify({code}),{status:409}));
 vi.stubGlobal('fetch',fetcher);
 const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'Cup',spokenDescription:'Cup',currentImageUrl:'/api/muse/frames/old.png',originalImageUrl:'/api/muse/frames/old.png',status:'uncertain',revisions:[],proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'ref',serverSessionId:'same-server',segmentationId:'old-result',sourceHash:'a'.repeat(64),sourceImageUrl:'/api/muse/frames/old.png',box:{x:0,y:0,width:10,height:10},confidence:.9,maskBase64:'old-raster',provenance:'live-sam-3.1'}}} as import('../src/types/framelock').StoryboardShot;
 try{
  const selected=await metaModelClient.disambiguateMaskSelection(shot,'0');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({sourceHash:'a'.repeat(64),shotNumber:1,segmentationId:'old-result'});
  expect(selected.proposedFix?.mask).toMatchObject({maskBase64:'old-raster',serverDetached:true});
  expect(selected.status).toBe('uncertain');
 }finally{vi.unstubAllGlobals();}
});


it('rejects explicitly stale masks on sample and restored still frames before touching pixels',async()=>{
 const render=vi.spyOn(canvasEngine,'applySamPixelFixWithVerification');
 const select=vi.spyOn(metaModelClient,'segmentObjectWithSam3');
 try{
  for(const provenance of ['offline-fixture','live-sam-3.1'] as const){
   const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'Cup',spokenDescription:'Cup',currentImageUrl:'data:image/png;base64,new',originalImageUrl:'data:image/png;base64,new',status:'uncertain',mediaSource:'sample',revisions:[],
    proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'m',box:{x:0,y:0,width:10,height:10},confidence:1,maskBase64:'old-mask',sourceImageUrl:'data:image/png;base64,old',provenance}}} as import('../src/types/framelock').StoryboardShot;
   const before=structuredClone(shot);
   await expect(metaModelClient.applyContinuityFix(shot)).rejects.toThrow('another frame');
   expect(shot).toEqual(before);
  }
  expect(render).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();
 }finally{render.mockRestore();select.mockRestore();}
});
