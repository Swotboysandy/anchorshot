import {expect,it} from 'vitest';
import {encodeArchive,decodeArchive} from '../src/services/archiveCodec';
it('retains independent binary masks, RGBA photos and narration bytes through a JSON file',()=>{
 const source={selection:{mask:Uint8Array.of(1,0,1,0),photo:{data:Uint8ClampedArray.of(255,128,0,255)}},umbrella:{mask:Uint8Array.of(0,1,0,1)},narration:'data:audio/wav;base64,AQID'};
 const restored=decodeArchive(encodeArchive(source)) as typeof source;
 expect(restored).toEqual(source);
 expect(restored.selection.photo.data).toBeInstanceOf(Uint8ClampedArray);
 expect(restored.selection.mask).toBeInstanceOf(Uint8Array);
 restored.selection.mask[0]=0;expect(source.selection.mask[0]).toBe(1);
});
it('rejects ambiguous tags and non-canonical binary payloads',()=>{
 expect(()=>encodeArchive({__anchorshotBinary:'mask',base64:'AA=='})).toThrow('Reserved');
 expect(()=>decodeArchive('{"__anchorshotBinary":"mask","base64":"AA==","extra":1}')).toThrow();
 expect(()=>decodeArchive('{"__anchorshotBinary":"mask","base64":"AA"}')).toThrow();
});
