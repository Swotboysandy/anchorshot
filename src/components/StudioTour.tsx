import {useEffect,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';

const steps=[
 {title:'Your dream, with familiar anchors',where:'Kitchen to ocean study',body:'Build a scene transition while keeping your chosen cup and umbrella unchanged. This walkthrough uses an animated illustration; it does not modify your project.',hint:'Choose the Dream tab, then Open dream transition to begin.'},
 {title:'Describe the dream',where:'Create > Paste a script',body:'Write your remembered scenes in the transcript. The current offline storyboard uses presets and keyword rules; it does not interpret every detail of a dream.',hint:'Your dream study is separate from the storyboard timeline.'},
 {title:'Select your cup',where:'Dream study > Select real cup',body:'Upload a PNG, JPEG or WebP, or use the bundled cup photograph. Trace around the cup and close the outline.',hint:'Apply cup to dream approves the current mask.'},
 {title:'Add the umbrella',where:'Dream study > Select umbrella',body:'Upload your umbrella photo or use the illustrated sample. Its selection and revision are independent of the cup.',hint:'Use umbrella sample, then Start umbrella sample mask for an offline starter.'},
 {title:'Correct each mask',where:'Edit cup mask / Edit umbrella mask',body:'Add brush restores missing pixels. Erase brush removes background and handle holes. Undo restores an edit; Cancel keeps the last approved selection.',hint:'Keyboard: arrows move, Space paints or places a point, Enter closes an outline.'},
 {title:'Watch the world change',where:'Kitchen / World changing / Ocean',body:'Play or scrub the 12-second transition. Both approved masks stay fixed in separate positions while the kitchen changes into an ocean.',hint:'Show protected region reveals the combined protection mask.'},
 {title:'Check, then export',where:'Check both objects / Export dream WebM',body:'Check all 301 uncompressed frames and review a separate score for each object. Save the masks, quality report, PNG frames and silent WebM.',hint:'WebM compression can change pixel values. Selections are session-only: save outputs before reloading.'},
];
const button='min-h-[44px] rounded border border-[#444444] bg-[#181818] px-3 py-2 text-sm text-white hover:border-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40';
export function StudioTour(){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[step,setStep]=useState(0),[paused,setPaused]=useState(false);
 const reduced=Boolean(useReducedMotion());const moving=open&&!paused&&!reduced;
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 const close=()=>{dialog.current?.close();setOpen(false);trigger.current?.focus();};
 const current=steps[step];
 return <>
  <button ref={trigger} type="button" onClick={()=>{setStep(0);setPaused(false);setOpen(true);}} className="min-h-[44px] hover:text-white hover:underline underline-offset-4 whitespace-nowrap shrink-0">UI tour</button>
  <dialog ref={dialog} aria-labelledby="studio-tour-title" aria-describedby="studio-tour-description" onCancel={e=>{e.preventDefault();close();}} onClose={()=>setOpen(false)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Tab'){const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}} className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-lg border-2 border-[#444444] bg-[#191919] p-0 text-white shadow-2xl backdrop:bg-black/80">
   <div className="p-4 sm:p-6 space-y-4">
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-mono tracking-widest">ANCHORSHOT / GUIDED TOUR</span><button autoFocus type="button" onClick={close} className={button} aria-label="Close UI tour">Close</button></div>
    <div className="flex gap-1" aria-hidden="true">{steps.map((_,i)=><div key={i} className="h-1 flex-1 bg-[#444444] overflow-hidden rounded"><motion.div className="h-full bg-white" initial={false} animate={{transform:i<=step?'scaleX(1)':'scaleX(0)'}} style={{transformOrigin:'left'}} transition={{duration:reduced?0:0.25,ease:[0.23,1,0.32,1]}}/></div>)}</div>
    <div className="relative aspect-video overflow-hidden rounded border border-[#444444] bg-[#111111]" role="img" aria-label="Illustration: a cup and umbrella stay fixed while the kitchen changes into an ocean" data-testid="tour-preview" data-motion={moving?'playing':'paused'}>
     <img src="/dream/kitchen.png" alt="" className="absolute inset-0 h-full w-full object-cover"/>
     <motion.img src="/dream/ocean.png" alt="" className="absolute inset-0 h-full w-full object-cover" initial={false} animate={{opacity:moving?[0,1,0]:step>=5?1:0}} transition={moving?{duration:6,repeat:Infinity,ease:'easeInOut'}:{duration:0}}/>
     <svg viewBox="0 0 800 450" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <g fill="white" stroke="#181818" strokeWidth="5"><path d="M180 260h100l-8 80q-40 25-84 0z"/><path d="M280 275h12q40 25-15 45" fill="none" stroke="white" strokeWidth="12"/>
      <path d="M480 210q100-190 200 0q-25-25-50 0q-25-25-50 0q-25-25-50 0q-25-25-50 0z"/><path d="M580 200v140q0 45-35 15" fill="none" stroke="white" strokeWidth="9"/></g>
      <motion.rect x="170" y="250" width="150" height="110" rx="8" fill="none" stroke="white" strokeDasharray="7 5" initial={false} animate={{opacity:step===2||step===4?1:0.35}}/>
      <motion.rect x="465" y="100" width="230" height="285" rx="8" fill="none" stroke="white" strokeDasharray="7 5" initial={false} animate={{opacity:step===3||step===4?1:0.35}}/>
     </svg>
     <span className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-xs">Illustrative preview - not your project</span>
    </div>
    <div className="flex justify-between items-center gap-2 text-xs text-[#cccccc]"><span>Step {step+1} of {steps.length} / Offline</span><button className={button} type="button" disabled={reduced} onClick={()=>setPaused(p=>!p)}>{reduced?'Reduced motion':paused?'Resume animation':'Pause animation'}</button></div>
    <AnimatePresence mode="wait" initial={false}>
     <motion.div key={step} initial={{opacity:0,transform:reduced?'none':'translateY(8px)'}} animate={{opacity:1,transform:'translateY(0px)'}} exit={{opacity:0,transform:reduced?'none':'translateY(-8px)'}} transition={{duration:reduced?0:0.2,ease:[0.23,1,0.32,1]}} className="space-y-3" aria-live="polite" aria-atomic="true">
      <p className="text-xs font-mono text-[#cccccc]">{current.where}</p><h2 id="studio-tour-title" className="text-xl sm:text-2xl font-semibold">{current.title}</h2><p id="studio-tour-description" className="text-sm leading-relaxed text-[#eeeeee]">{current.body}</p><p className="rounded border border-[#444444] p-3 text-sm">{current.hint}</p>
     </motion.div>
    </AnimatePresence>
    <div className="flex items-center justify-between gap-2"><button type="button" className={button} disabled={step===0} onClick={()=>setStep(i=>Math.max(0,i-1))}>Back</button><button type="button" className={button} onClick={close}>Skip tour</button><button type="button" className={`${button} font-semibold`} onClick={()=>step===steps.length-1?close():setStep(i=>Math.min(steps.length-1,i+1))}>{step===steps.length-1?'Finish tour':'Next'}</button></div>
   </div>
  </dialog>
 </>;
}
