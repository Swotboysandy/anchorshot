import {useEffect,useRef,useState} from 'react';
import {brushMask,decodeCupPhoto,polygonMask,umbrellaSample,requestSamCupCutout,type CupSelection,type Point} from '../services/cupSelection';
import type {Pixels} from '../services/dreamTransition';
const button='min-h-[40px] px-3 py-2 border border-[#4B5563] rounded bg-[#16191E] text-sm text-white disabled:opacity-40';
export function CupMaskEditor({initial,onApply,onCancel,objectKind='cup',fixedFrame=false,onDirty}:{onDirty?:()=>void;fixedFrame?:boolean;objectKind?:'cup'|'umbrella';initial:CupSelection|null;onApply:(s:CupSelection)=>void;onCancel:()=>void}) {
  const [photo,setPhoto]=useState<Pixels|null>(initial?.photo||null),[name,setName]=useState(initial?.name||'');
  const [mask,setMask]=useState<Uint8Array>(initial?.mask.slice()||new Uint8Array()),[points,setPoints]=useState<Point[]>([]);
  const [tool,setTool]=useState<'polygon'|'subtract'|'add'|'erase'>('polygon'),[radius,setRadius]=useState(12);
  const tracing=tool==='polygon'||tool==='subtract';
  const [history,setHistory]=useState<Uint8Array[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [cursor,setCursor]=useState<Point>({x:200,y:150});
  const [samLoading,setSamLoading]=useState(false);
  const [samInfo,setSamInfo]=useState<{provenance:string;confidence:number;maskRef?:string}|null>(
    initial?.source==='sam-3.1-photo'?{provenance:initial.provenance||'live-sam-3.1',confidence:initial.confidence??0,maskRef:initial.maskRef}:null
  );
  const canvas=useRef<HTMLCanvasElement>(null),preview=useRef<HTMLCanvasElement>(null);
  const maskRef=useRef(mask),stroke=useRef<Point|null>(null),request=useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  const update=(next:Uint8Array)=>{setSamInfo(null);maskRef.current=next;setMask(next);};
  const checkpoint=()=>{onDirty?.();const snapshot=maskRef.current.slice();setHistory(h=>[...h.slice(-19),snapshot]);};
  const load=async(blob:Blob,label:string)=>{
    const id=++request.current;setLoading(true);setError('');
    try{const decoded=await decodeCupPhoto(blob);if(request.current!==id)return;
      setPhoto(decoded);setName(label);update(new Uint8Array(decoded.width*decoded.height));setPoints([]);setHistory([]);setTool('polygon');setSamInfo(null);
    }catch(e){if(request.current===id)setError(e instanceof Error?e.message:'Image could not be decoded.');}
    finally{if(request.current===id)setLoading(false);}
  };
  const sample=async()=>{const id=++request.current;setLoading(true);setError('');try{const response=await fetch('/dream/real-cup.png');if(!response.ok)throw new Error('Sample photo unavailable.');const blob=await response.blob();if(request.current===id)await load(blob,'CC0 coffee photograph');}catch(e){if(request.current===id){setError(String(e));setLoading(false);}}};
  const handleSamCutout=async()=>{
    if(!photo||samLoading||loading)return;
    const id=++request.current;
    setSamLoading(true);setError('');
    try {
      const res=await requestSamCupCutout(photo,objectKind);
      if(request.current!==id)return;
      checkpoint();update(res.mask);setPoints([]);setTool('add');
      setSamInfo({provenance:res.provenance,confidence:res.confidence,maskRef:res.maskRef});
    } catch(e) {
      setError(e instanceof Error?e.message:'SAM 3.1 cutout failed.');
    } finally {
      if(request.current===id)setSamLoading(false);
    }
  };
  useEffect(()=>{
    if(!photo||!canvas.current||!preview.current)return;
    const ctx=canvas.current.getContext('2d')!,image=ctx.createImageData(photo.width,photo.height);image.data.set(photo.data);
    const cut=ctx.createImageData(photo.width,photo.height);
    for(let p=0;p<mask.length;p++)if(mask[p]){
      cut.data.set(photo.data.subarray(p*4,p*4+4),p*4);
      image.data[p*4]=image.data[p*4]*0.65;image.data[p*4+1]=image.data[p*4+1]*0.65+89;image.data[p*4+2]=image.data[p*4+2]*0.65+89;
    }
    ctx.putImageData(image,0,0);preview.current.getContext('2d')!.putImageData(cut,0,0);
    if(points.length){ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
      for(const p of points){ctx.fillStyle='white';ctx.fillRect(p.x-3,p.y-3,6,6);}}
    ctx.strokeStyle='white';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cursor.x,cursor.y,tracing?4:radius,0,Math.PI*2);ctx.stroke();
  },[photo,mask,points,cursor,tool,radius,tracing]);
  const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{const r=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(photo!.width-1,(event.clientX-r.left)/r.width*photo!.width)),y:Math.max(0,Math.min(photo!.height-1,(event.clientY-r.top)/r.height*photo!.height))};};
  const paint=(p:Point,from=p)=>{if(photo)update(brushMask(maskRef.current,photo.width,photo.height,from,p,radius,tool==='add'));};
  const finish=()=>{if(photo&&points.length>=3){checkpoint();const outline=polygonMask(photo.width,photo.height,points);update(tool==='subtract'?maskRef.current.map((value,i)=>outline[i]?0:value):outline);setPoints([]);setTool(tool==='subtract'?'subtract':'add');}};
  const count=mask.reduce((a,v)=>a+v,0);
  return <section aria-label={objectKind==='cup'?'Real cup mask editor':'Umbrella mask editor'} className="space-y-3 border border-[#4B5563] rounded p-3 text-[#E2E8F0]">
    <h3 className="font-semibold text-white">Select your {objectKind}</h3>
    <p className="text-sm">Trace the {objectKind}, close the outline, then use Trace hole to remove background inside a handle. Brushes refine the edges. Review the cutout before applying. Photos stay in this browser.</p>
    <fieldset disabled={loading||samLoading} className="space-y-3 min-w-0">
      {!fixedFrame && <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm">{objectKind} photo <input aria-label={`Upload ${objectKind} photo`} type="file" accept="image/png,image/jpeg,image/webp" className="block max-w-full" onChange={e=>{const file=e.target.files?.[0];if(file)void load(file,file.name);e.target.value='';}}/></label>
        <button type="button" className={button} onClick={()=>{if(objectKind==='cup')void sample();else{const sample=umbrellaSample();setPhoto(sample.photo);setName('Authored umbrella illustration');update(new Uint8Array(sample.mask.length));setPoints([]);setHistory([]);setTool('polygon');}}}>{objectKind==='cup'?'Use real cup sample':'Use umbrella sample'}</button>
      </div>}
      {photo && <>
        <div className="flex flex-wrap items-center gap-2" aria-label="Mask tools">
          {(['polygon','subtract','add','erase'] as const).map(t=><button type="button" key={t} className={button} disabled={t==='subtract'&&!count} aria-pressed={tool===t} onClick={()=>{setTool(t);setPoints([]);}}>{t==='polygon'?'Trace outline':t==='subtract'?'Trace hole':t==='add'?'Add brush':'Erase brush'}</button>)}
          <button type="button" className={button} disabled={points.length<3} onClick={finish}>Close outline</button>
          <button type="button" className={button} disabled={!history.length&&!points.length} onClick={()=>{if(points.length){setPoints(p=>p.slice(0,-1));return;}update(history[history.length-1]);setHistory(h=>h.slice(0,-1));}}>Undo mask edit</button>
          <button type="button" className={button} disabled={!count} onClick={()=>{checkpoint();update(new Uint8Array(mask.length));setPoints([]);}}>Clear mask</button>
          {!fixedFrame && <button type="button" className={`${button} border-[#38BDF8] text-[#38BDF8] hover:bg-[#38BDF8]/10 flex items-center gap-1.5`} disabled={samLoading||loading} onClick={()=>void handleSamCutout()}>
            {samLoading?'Preparing offline mask...':'Preview cutout (offline)'}
          </button>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {objectKind==='umbrella' && name==='Authored umbrella illustration' && <button type="button" className={button} onClick={()=>{checkpoint();update(umbrellaSample().mask);setPoints([]);setTool('erase');}}>Start umbrella sample mask</button>}
          {name==='CC0 coffee photograph' && <button type="button" className={button} onClick={()=>{checkpoint();update(polygonMask(photo.width,photo.height,[{x:174,y:108},{x:186,y:65},{x:217,y:34},{x:267,y:18},{x:322,y:21},{x:366,y:43},{x:397,y:76},{x:411,y:119},{x:401,y:168},{x:380,y:215},{x:348,y:258},{x:285,y:283},{x:248,y:279},{x:229,y:305},{x:209,y:310},{x:195,y:301},{x:198,y:260},{x:214,y:234},{x:193,y:201},{x:180,y:158}]));setPoints([]);setTool('erase');}}>Start rough sample outline</button>}
          {samInfo && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#0F172A] border border-[#38BDF8]/60 text-[#38BDF8]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]" />
              {samInfo.provenance==='live-sam-3.1' ? `SAM 3.1 result (${Math.round(samInfo.confidence * 100)}%)` : 'Offline starter shape - not AI segmentation'}
            </span>
          )}
        </div>
        <label className="text-sm flex items-center gap-2">Brush radius <input aria-label="Brush radius" type="range" min="2" max="40" value={radius} onChange={e=>setRadius(Number(e.target.value))}/>{radius}px</label>
        <p id="cup-edit-help" className="text-xs">Click outline points or paint with a brush. Keyboard: arrows move the cursor, Shift + arrows move 10px, Space marks/paints, Enter closes an outline. Undo restores a whole brush stroke.</p>
        <canvas ref={canvas} width={photo.width} height={photo.height} tabIndex={0} role="img" aria-label={`${objectKind==='cup'?'Cup':'Umbrella'} selection canvas`} aria-describedby="cup-edit-help" className="w-full rounded touch-none cursor-crosshair focus:outline-2 focus:outline-white"
          onPointerDown={e=>{if(loading||samLoading)return;e.preventDefault();e.currentTarget.focus();const p=point(e);setCursor(p);if(tracing){onDirty?.();setPoints(v=>[...v,p]);return;}checkpoint();stroke.current=p;e.currentTarget.setPointerCapture(e.pointerId);paint(p);}}
          onPointerMove={e=>{if(loading||samLoading||!stroke.current)return;const p=point(e);paint(p,stroke.current);stroke.current=p;setCursor(p);}}
          onPointerUp={()=>{stroke.current=null;}} onPointerCancel={()=>{stroke.current=null;}} onLostPointerCapture={()=>{stroke.current=null;}}
          onKeyDown={e=>{e.stopPropagation();if(loading||samLoading)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Enter'].includes(e.key))e.preventDefault();const d=e.shiftKey?10:1;
            if(e.key.startsWith('Arrow'))setCursor(p=>({x:Math.max(0,Math.min(photo.width-1,p.x+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0))),y:Math.max(0,Math.min(photo.height-1,p.y+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0)))}));
            if(e.key===' '){if(tracing){onDirty?.();setPoints(p=>[...p,cursor]);}else{checkpoint();paint(cursor);}}
            if(e.key==='Enter'&&tracing)finish();}}/>
        <p className="text-sm" role="status">{tool==='subtract'?'Trace a hole, then close the outline to remove only its pixels. ':''}{count} selected pixels · {points.length?`${points.length} outline points pending`:'Review edges and holes below'}</p>
        <div className="bg-[#4B5563] border border-white/20 rounded p-2"><p className="text-xs mb-2">{fixedFrame ? 'Selection preview — only these pixels will be corrected' : 'Cutout preview — gray areas will reveal the changing background'}</p><canvas ref={preview} width={photo.width} height={photo.height} role="img" aria-label={`Selected ${objectKind} cutout`} className="w-full"/></div>
        <button type="button" className={button} disabled={count<16||points.length>0} onClick={()=>{try{onApply({photo,mask:mask.slice(),name,revision:(initial?.revision||0)+1,source:samInfo?.provenance==='live-sam-3.1'?'sam-3.1-photo':'local-manual-photo',provenance:samInfo?.provenance,confidence:samInfo?.confidence,maskRef:samInfo?.maskRef});}catch(e){setError(e instanceof Error?e.message:'Selection failed.');}}}>{fixedFrame ? `Approve ${objectKind} in this frame` : `Apply ${objectKind} to dream`}</button>
      </>}
    </fieldset>
    {loading&&<p role="status">Loading photo locally…</p>}{error&&<p role="alert" className="text-[#FDE047]">{error}</p>}
    <button type="button" className={button} onClick={onCancel}>Cancel mask editing</button>
    <p className="text-xs">{fixedFrame ? 'This selection applies only to this video frame. Review each frame before creating a corrected take.' : <>Offline mode: the starter shape is synthetic, not SAM segmentation. Trace or correct it before applying. No model calls or credits are used. Umbrella sample: authored illustration. Cup sample: Rachel Michetti / Pikolo Espresso Bar, CC0, via scikit-image. PNG, JPEG or WebP; max 8 MB / 24 MP. Working image is resized to at most 800 × 600. Only fully opaque photo pixels are protected.</>}</p>
  </section>;
}
