import test from 'node:test';
import assert from 'node:assert/strict';
import { recolorMaskedPixels, verifyMaskedPixelDiff, detectMaskedColor } from '../src/services/maskIntegrity.ts';
const frame = () => new Uint8ClampedArray([200,40,30,255, 200,40,30,128, 200,40,30,255]);
test('recolor respects mask holes, input and alpha', () => {
 const before=frame(), original=before.slice();
 const {pixels,verification}=recolorMaskedPixels(before,new Uint8Array([1,0,1]),[20,90,220]);
 assert.deepEqual(before,original);
 assert.deepEqual(pixels.slice(4,8),original.slice(4,8));
 assert.equal(pixels[3],255); assert.equal(pixels[11],255);
 assert.deepEqual(verification,{selectedPixels:2,changedInside:2,changedOutside:0,passed:true});
});
test('detects outside RGB and alpha changes', () => {
 for(const channel of [4,7]) {
  const before=frame(),after=before.slice(); after[channel]--;
  const report=verifyMaskedPixelDiff(before,after,new Uint8Array([1,0,1]));
  assert.equal(report.passed,false); assert.equal(report.changedOutside,1);
 }
});
test('rejects malformed masks and dimensions', () => {
 assert.throws(()=>verifyMaskedPixelDiff(frame(),frame(),new Uint8Array([1])));
 assert.throws(()=>verifyMaskedPixelDiff(frame(),frame(),new Uint8Array([1,2,0])));
});
test('empty selection and uneditable pixels cannot report correction', () => {
 assert.throws(()=>recolorMaskedPixels(frame(),new Uint8Array([0,0,0]),[20,90,220]));
 assert.throws(()=>recolorMaskedPixels(new Uint8ClampedArray([0,0,0,255]),new Uint8Array([1]),[20,90,220]));
});
test('transparent selected pixels remain unchanged', () => {
 const before=frame();before[3]=0;
 const {pixels}=recolorMaskedPixels(before,new Uint8Array([1,0,1]),[20,90,220]);
 assert.deepEqual(pixels.slice(0,4),before.slice(0,4));
});


test('white and neutral props can be recoloured without changing alpha, mask holes or source pixels', () => {
 const source=new Uint8ClampedArray([255,255,255,255, 120,120,120,128, 60,60,60,255, 255,0,0,255]);
 const before=source.slice();
 const mask=new Uint8Array([1,1,1,0]);
 const result=recolorMaskedPixels(source,mask,[37,99,235]);
 assert.equal(detectMaskedColor(result.pixels,mask).colorName,'blue');
 assert.equal(result.pixels[7],128);
 assert.deepEqual(result.pixels.slice(12),before.slice(12));
 assert.deepEqual(source,before);
 assert.equal(result.verification.changedOutside,0);
 assert.ok(result.pixels[2] > result.pixels[6] && result.pixels[6] > result.pixels[10]);
});

test('white correction measures white and retains distinct selected shades', () => {
 const source=new Uint8ClampedArray([60,10,10,255, 220,60,60,255]);
 const result=recolorMaskedPixels(source,new Uint8Array([1,1]),[226,232,240]);
 assert.equal(detectMaskedColor(result.pixels,new Uint8Array([1,1])).colorName,'white');
 assert.ok(result.pixels[0] < result.pixels[4]);
});
