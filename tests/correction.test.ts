import { describe, expect, it } from 'vitest';
import { comparePixels, expandMask, recolor } from '../src/lib/correction';
import { editSession, initialSession } from '../src/lib/session';
import type { Correction, FrameAsset, ObjectMask } from '../src/types';

const mask: ObjectMask = {
  id: 'm1',
  objectId: '1',
  label: 'Cup',
  source: 'sample',
  sourceHash: 'source',
  width: 4,
  height: 4,
  bounds: { left: 1, top: 1, right: 3, bottom: 3 },
  rasterWidth: 2,
  rasterHeight: 2,
  rasterBase64: Buffer.from([1, 0, 0, 1]).toString('base64'),
};
const asset: FrameAsset = {
  id: 'f1',
  hash: 'source',
  name: 'test',
  kind: 'sample',
  width: 4,
  height: 4,
  dataUrl: '',
  pixels: new Uint8ClampedArray(64),
};
const candidate: Correction = {
  id: 'c1',
  sourceHash: 'source',
  selectionId: 'm1',
  color: '#4169d8',
  dataUrl: 'preview',
  report: { selected: 2, changedInside: 2, changedOutside: 0 },
};

describe('mask placement and colour correction', () => {
  it('places a cropped raster in half-open source bounds, without filling its holes', () => {
    expect([...expandMask(mask)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  });
  it('maps a smaller mask to its source box with nearest-neighbour sampling', () => {
    expect([...expandMask({ ...mask, bounds: { left: 0, top: 0, right: 4, bottom: 4 } })]).toEqual([
      1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1,
    ]);
  });
  it('rejects corrupt, nonbinary and out-of-frame masks', () => {
    expect(() => expandMask({ ...mask, rasterBase64: 'AQ==' })).toThrow('invalid');
    expect(() => expandMask({ ...mask, rasterBase64: 'AQACAQ==' })).toThrow('invalid');
    expect(() => expandMask({ ...mask, bounds: { ...mask.bounds, right: 5 } })).toThrow('fit');
  });
  it('changes selected hues, retains alpha and shading, and leaves every other channel exact', () => {
    const source = new Uint8ClampedArray([
      180, 70, 45, 222, 90, 25, 20, 255, 30, 60, 90, 255, 240, 240, 240, 120,
    ]);
    const original = source.slice();
    const { pixels, report } = recolor(source, new Uint8Array([1, 1, 0, 0]), '#4169d8');
    expect(source).toEqual(original);
    expect([...pixels.slice(8)]).toEqual([...original.slice(8)]);
    expect(pixels[3]).toBe(222);
    expect(pixels[7]).toBe(255);
    expect(pixels[2]).toBeGreaterThan(pixels[0]);
    expect(pixels[6]).toBeGreaterThan(pixels[4]);
    for (const i of [0, 4]) {
      const beforeLightness =
        Math.max(...source.slice(i, i + 3)) + Math.min(...source.slice(i, i + 3));
      const afterLightness =
        Math.max(...pixels.slice(i, i + 3)) + Math.min(...pixels.slice(i, i + 3));
      expect(Math.abs(beforeLightness - afterLightness)).toBeLessThanOrEqual(1);
    }
    expect(report).toEqual({ selected: 2, changedInside: 2, changedOutside: 0 });
  });
  it('detects actual outside-mask changes, including alpha changes', () => {
    const before = new Uint8ClampedArray([10, 20, 30, 255, 50, 60, 70, 255]);
    const after = before.slice();
    after[7] = 254;
    expect(comparePixels(before, after, new Uint8Array([1, 0])).changedOutside).toBe(1);
  });
  it('rejects invalid colours, empty masks and mismatched dimensions', () => {
    expect(() => recolor(new Uint8ClampedArray(4), new Uint8Array([1]), '#nope')).toThrow('hex');
    expect(() => recolor(new Uint8ClampedArray(4), new Uint8Array([0]), '#123456')).toThrow(
      'empty',
    );
    expect(() => recolor(new Uint8ClampedArray(8), new Uint8Array([1]), '#123456')).toThrow(
      'different',
    );
  });
});

describe('approval and source revisions', () => {
  const loaded = editSession(initialSession, { type: 'load', asset });
  const selected = editSession(loaded, { type: 'masks', sourceHash: asset.hash, masks: [mask] });
  it('ignores stale masks and stale proposals', () => {
    expect(
      editSession(loaded, { type: 'masks', sourceHash: 'previous-frame', masks: [mask] }),
    ).toBe(loaded);
    expect(
      editSession(selected, {
        type: 'preview',
        correction: { ...candidate, sourceHash: 'previous-frame' },
      }),
    ).toBe(selected);
  });
  it('requires an explicit choice when multiple objects are returned', () => {
    expect(
      editSession(loaded, {
        type: 'masks',
        sourceHash: asset.hash,
        masks: [mask, { ...mask, id: 'm2' }],
      }).selectedId,
    ).toBeNull();
  });
  it('invalidates a pending preview when colour, object or source changes', () => {
    const previewed = editSession(selected, { type: 'preview', correction: candidate });
    expect(editSession(previewed, { type: 'color', color: '#112233' }).candidate).toBeNull();
    expect(editSession(previewed, { type: 'select', id: mask.id }).candidate).toBeNull();
    const next = editSession(previewed, { type: 'load', asset: { ...asset, hash: 'new' } });
    expect(next.masks).toEqual([]);
    expect(next.candidate).toBeNull();
    expect(next.approved).toBeNull();
  });
  it('approves once, retains the original, rejects unsafe results and supports undo', () => {
    const previewed = editSession(selected, { type: 'preview', correction: candidate });
    const approved = editSession(previewed, { type: 'approve' });
    expect(approved.approved).toEqual(candidate);
    expect(approved.asset).toBe(asset);
    expect(editSession(approved, { type: 'approve' })).toBe(approved);
    expect(editSession(approved, { type: 'undo' }).approved).toBeNull();
    const unsafe = {
      ...previewed,
      candidate: { ...candidate, report: { ...candidate.report, changedOutside: 1 } },
    };
    expect(editSession(unsafe, { type: 'approve' }).approved).toBeNull();
  });
});
