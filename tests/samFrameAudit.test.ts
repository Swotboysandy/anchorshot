import {validateProjectLibrary} from '../src/services/projectStorage';
import {restoreShotTake} from '../src/lib/shotEdits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectMaskedColor, normalizeContinuityColor } from '../src/services/maskIntegrity';
import { MetaModelClient } from '../src/services/metaModels';
import * as canvasEngine from '../src/services/canvasEngine';
import type { StoryboardShot } from '../src/types/framelock';

afterEach(() => vi.restoreAllMocks());

describe('Mask colour classification and frame audit states', () => {
  it('classifies object pigments accurately inside binary SAM masks', () => {
    // 20x20 test canvas
    const width = 20;
    const height = 20;
    const totalPixels = width * height;
    const mask = new Uint8Array(totalPixels);
    // Mask center 10x10 square
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        mask[y * width + x] = 1;
      }
    }

    // 1. Blue test frame
    const bluePixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      bluePixels[idx] = 30;      // R
      bluePixels[idx + 1] = 80;  // G
      bluePixels[idx + 2] = 220; // B
      bluePixels[idx + 3] = 255; // A
    }
    const blueResult = detectMaskedColor(bluePixels, mask);
    expect(blueResult.colorName).toBe('blue');
    expect(blueResult.pixelCount).toBe(100);
    expect(blueResult.confidence).toBeGreaterThan(0.7);

    // 2. Red test frame
    const redPixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      redPixels[idx] = 220;      // R
      redPixels[idx + 1] = 35;   // G
      redPixels[idx + 2] = 35;   // B
      redPixels[idx + 3] = 255;  // A
    }
    const redResult = detectMaskedColor(redPixels, mask);
    expect(redResult.colorName).toBe('red');
    expect(redResult.confidence).toBeGreaterThan(0.7);

    // 3. Amber test frame
    const amberPixels = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      amberPixels[idx] = 225;    // R
      amberPixels[idx + 1] = 125;// G
      amberPixels[idx + 2] = 10; // B
      amberPixels[idx + 3] = 255;// A
    }
    const amberResult = detectMaskedColor(amberPixels, mask);
    expect(amberResult.colorName).toBe('amber');
  });

  it('audits shot continuity dynamically without relying on planted fixture flags', async () => {
    const client = new MetaModelClient();

    // Stub sampleImageColorInMask behavior on client or module
    const consistentShot: StoryboardShot = {
      id: 'shot-1',
      shotNumber: 1,
      durationSeconds: 4.0,
      promptDescription: 'Close-up of detective with blue cup on counter',
      spokenDescription: 'Shot 1. Close-up. Generated image, continuity unreviewed.',
      currentImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      originalImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      status: 'uncertain',
      revisions: [],
    };

    const rule = {
      id: 'rule-cup-color',
      scope: 'all_shots' as const,
      targetObject: 'cup',
      property: 'color',
      expectedValue: 'blue',
      revision: 1,
    };

    // A frame that cannot be measured is never reported as verified.
    const unmeasured = await client.auditShotContinuity(consistentShot, rule);
    expect(unmeasured.status).toBe('uncertain');
    expect(unmeasured.spokenDescription).not.toMatch(/Color check passed|Continuity verified/);

    vi.spyOn(canvasEngine, 'sampleImageColorInMask').mockResolvedValueOnce({
      colorName: 'blue',
      rgb: [37, 99, 235],
      pixelCount: 120,
      confidence: 0.96,
    });
    const auditedConsistent = await client.auditShotContinuity(consistentShot, rule);
    expect(auditedConsistent.status).toBe('consistent');
    expect(auditedConsistent.discrepancyMessage).toBeUndefined();
    expect(auditedConsistent.spokenDescription).toMatch(/Color check passed: the selected cup pixels match blue/);
    expect(auditedConsistent.spokenDescription).not.toMatch(/Offline sample/);

    // Mismatch scenario: real SAM sample returns red cup
    vi.spyOn(canvasEngine, 'sampleImageColorInMask').mockResolvedValueOnce({
      colorName: 'red',
      rgb: [220, 38, 38],
      pixelCount: 120,
      confidence: 0.96,
    });

    const mismatchShot: StoryboardShot = {
      id: 'shot-2',
      shotNumber: 2,
      durationSeconds: 3.5,
      promptDescription: 'Medium shot of desk with red cup',
      spokenDescription: 'Shot 2. Generated image; continuity unreviewed.',
      currentImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      originalImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzc1p9eQAAAABJRU5ErkJggg==',
      status: 'uncertain',
      revisions: [],
    };

    const auditedMismatch = await client.auditShotContinuity(mismatchShot, rule);
    expect(auditedMismatch.status).toBe('mismatch');
    expect(auditedMismatch.discrepancyMessage).toMatch(/Visual audit detected a red cup/);
    expect(auditedMismatch.proposedFix).toBeDefined();
    expect(auditedMismatch.proposedFix?.targetColor).toBe('blue');
    expect(auditedMismatch.proposedFix?.targetObject).toBe('cup');
  });

  it('does not treat a planned omission as verified absence in generated pixels', async () => {
    const shot: StoryboardShot = {
      id: 'shot-4', shotNumber: 4, durationSeconds: 4, promptDescription: 'The clockmaker smiles', spokenDescription: '',
      currentImageUrl: '/api/muse/frames/x.png', originalImageUrl: '/api/muse/frames/x.png', status: 'uncertain', revisions: [],
    };
    const rule = { id: 'r', scope: 'all_shots' as const, targetObject: 'jacket', property: 'color', expectedValue: 'emerald', revision: 1 };
    const client = new MetaModelClient();
    const absent = await client.auditShotContinuity({ ...shot, absentProps: ['jacket'] }, rule);
    expect(absent.status).toBe('uncertain');
    expect(absent.spokenDescription).toMatch(/absence has not been verified/);
    expect((await client.auditShotContinuity(shot, rule)).status).toBe('uncertain');
  });
});


it.each([['green','emerald'],['cobalt','blue'],['yellow','amber'],['crimson','red'],['cyan','cyan']])('uses the measured category for %s', (input, expected) => {
  expect(normalizeContinuityColor(input)).toBe(expected);
});

it('does not claim colour success from containment alone', async () => {
  const client = new MetaModelClient();
  vi.spyOn(canvasEngine,'applySamPixelFixWithVerification').mockResolvedValue({imageUrl:'edited',pixelVerification:{changedInsideMask:2,changedOutsideMask:0,outsideDriftPercent:0}} as any);
  vi.spyOn(canvasEngine,'sampleImageColorInMask').mockResolvedValue({colorName:'red',rgb:[220,35,35],confidence:0.9,pixelCount:10});
  const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'cup',spokenDescription:'',currentImageUrl:'original',originalImageUrl:'original',status:'mismatch',revisions:[],
    proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'m',box:{x:0,y:0,width:10,height:10},confidence:1,maskBase64:'mask',provenance:'offline-fixture'}}} as StoryboardShot;
  const result=await client.applyContinuityFix(shot);
  expect(result.status).toBe('uncertain');
  expect(result.spokenDescription).toContain('Continuity needs review');
});


it('frame correction detaches video metadata while the original video take remains restorable',async()=>{
 vi.spyOn(canvasEngine,'applySamPixelFixWithVerification').mockResolvedValue({imageUrl:'data:image/png;base64,edited',pixelVerification:{changedInsideMask:2,changedOutsideMask:0,outsideDriftPercent:0}} as any);
 vi.spyOn(canvasEngine,'sampleImageColorInMask').mockResolvedValue({colorName:'blue',rgb:[0,0,255],confidence:.9,pixelCount:16});
 const plan={sourceJobId:'job',fingerprint:'source',tracks:[{objectId:'cup',color:'blue',frames:[0,1].map(frameIndex=>({frameIndex,sourceHash:'source',maskBase64:Buffer.alloc(16,1).toString('base64'),revision:1,reviewed:true,absent:false,method:'manual'}))}]} as any;
 const frame='/api/local-ai/jobs/job/assets/frame-000.png',video='/api/local-ai/jobs/job/assets/generated-video.mp4';
 const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'cup',spokenDescription:'',currentImageUrl:frame,originalImageUrl:frame,status:'uncertain',videoUrl:video,generatedJobId:'job',videoMaskPlan:plan,timestamp:1,detectedObjects:[{objectId:'0'}],
  revisions:[{revisionId:'original-video',timestamp:1,imageUrl:frame,videoUrl:video,generatedJobId:'job',videoMaskPlan:plan,sourceTime:1,mediaSource:'generated',actionApplied:'video'}],
  proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'m',box:{x:0,y:0,width:10,height:10},confidence:1,maskBase64:'mask',sourceImageUrl:frame,provenance:'live-sam-3.1'}}} as StoryboardShot;
 const original=structuredClone(shot);
 const result=await new MetaModelClient().applyContinuityFix(shot);
 for(const field of ['videoUrl','generatedJobId','videoMaskPlan','detectedObjects','timestamp'] as const)expect(result[field]).toBeUndefined();
 expect(result.revisions.at(-1)?.mediaSource).toBe('generated');
 expect(result.revisions[0]).toEqual(original.revisions[0]);expect(shot).toEqual(original);
 const restored=restoreShotTake(result,'original-video');
 expect(restored).toMatchObject({videoUrl:video,generatedJobId:'job',videoMaskPlan:plan,timestamp:1});
 const still=restoreShotTake(restored,result.revisions.at(-1)!.revisionId);
 expect(still.mediaSource).toBe('generated');expect(still.videoUrl).toBeUndefined();expect(still.videoMaskPlan).toBeUndefined();
 for(const state of [shot,result,restored,still])expect(()=>validateProjectLibrary(JSON.parse(JSON.stringify({active:'project',projects:[{projectId:'project',title:'Video study',transcript:'Cup',statusAnnouncement:'',activeShotId:'s',shots:[state],rules:[]}]})))).not.toThrow();
});


it('a measured manual override cannot silently replace the expected continuity color',async()=>{
 vi.spyOn(canvasEngine,'applySamPixelFixWithVerification').mockResolvedValue({imageUrl:'edited',pixelVerification:{changedInsideMask:2,changedOutsideMask:0,outsideDriftPercent:0}} as any);
 const measurement=vi.spyOn(canvasEngine,'sampleImageColorInMask').mockResolvedValue({colorName:'purple',rgb:[130,40,200],confidence:.9,pixelCount:16});
 const shot={id:'s',shotNumber:1,durationSeconds:2,promptDescription:'cup',spokenDescription:'',currentImageUrl:'original',originalImageUrl:'original',status:'mismatch',revisions:[],
  proposedFix:{action:'recolor',targetObject:'cup',targetColor:'blue',mask:{id:'m',objectId:'0',maskRef:'m',box:{x:0,y:0,width:10,height:10},confidence:1,maskBase64:'mask',sourceImageUrl:'original',provenance:'offline-fixture'}}} as StoryboardShot;
 const client=new MetaModelClient();
 const purple=await client.applyContinuityFix(shot,'purple');
 expect(purple.status).toBe('mismatch');expect(purple.proposedFix?.targetColor).toBe('blue');
 expect(purple.spokenDescription).toContain('rule requires blue');
 const repeated=await client.applyContinuityFix(purple,'purple');expect(repeated.status).toBe('mismatch');
 measurement.mockResolvedValue({colorName:'blue',rgb:[0,0,255],confidence:.9,pixelCount:16});
 const repaired=await client.applyContinuityFix(repeated,'cobalt');expect(repaired.status).toBe('consistent');
});
