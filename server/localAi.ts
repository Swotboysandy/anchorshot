import {archiveLocalMedia,importLocalMedia} from './mediaArchive';
import express from 'express';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, renameSync, lstatSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';
import {readVideoManifest, validateVideoPlan, correctVideoFrames, decodeVideoMask, runVision, VideoTrackError} from './videoTracks';
import type {VideoObjectTrack, VideoTrackPlan} from '../src/types/videoTracks';

const ID = /^[a-f0-9-]{36}$/;
const assets = new Set(['generated-image.png', 'generated-video.mp4', 'contact-sheet.png', 'inference-report.json', 'objects.json', 'modification-report.json', 'reviewed-tracks.json']);
type Job = {id: string; kind: 'image'|'video'; prompt: string; seed: number; status: string; message: string; createdAt: string; report?: Record<string, any>; error?: string; importToken?: string};

export function createLocalAi(root: string, launch = spawn) {
  const runtime = path.join(root, '.artifacts/local-ai');
  const output = path.join(runtime, 'ui-jobs');
  const python = [
    path.join(runtime, 'venv/python.exe'),
    path.join(runtime, 'venv/Scripts/python.exe'),
  ].find((p) => existsSync(p)) || path.join(runtime, 'venv/python.exe');
  mkdirSync(output, {recursive: true});
  const jobs = new Map<string, Job>();
  const corrections = new Set<AbortController>();
  const trackingPython = process.env.ANCHORSHOT_TRACKING_PYTHON || path.join(process.env.LOCALAPPDATA || runtime,'AnchorShot/vision/Scripts/python.exe');
  let active: {job: Job; child: ChildProcess} | undefined;
  const save = (job: Job) => writeFileSync(path.join(output, job.id, 'job.json'), JSON.stringify(job));
  const getJob = (id: string): Job | undefined => {
    if (ID.test(id) && !jobs.has(id)) {
      try {
        const saved: Job = JSON.parse(readFileSync(path.join(output, id, 'job.json'), 'utf8'));
        if (saved.id === id && saved.status === 'completed') jobs.set(id, saved);
      } catch { /* Missing media remains 404. */ }
    }
    return jobs.get(id);
  };
  for (const id of readdirSync(output).filter(id => ID.test(id))) {
    try {
      const job: Job = JSON.parse(readFileSync(path.join(output, id, 'job.json'), 'utf8'));
      if (job.id !== id || job.status === 'importing') continue;
      if (job.status === 'running') {
        job.status = 'failed'; job.error = 'Local server restarted. Run generation again.'; save(job);
      }
      jobs.set(id, job);
    } catch { /* Ignore incomplete metadata, never infer success from media alone. */ }
  }
  const requirements = [python, path.join(root, 'scripts/run_local_ai.py'),
    path.join(runtime, 'models/sd15/download-manifest.json'),
    path.join(runtime, 'models/animatediff-lightning/download-manifest.json')];
  const app = express();
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.status(403).json({error: 'Local same-origin requests only.'}); return;
    }
    if (req.method === 'POST' && (req.headers['x-anchorshot-local'] !== '1' || !req.is('application/json'))) {
      res.status(403).json({error: 'Local JSON request required.'}); return;
    }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use('/imports',express.json({limit:'180mb'}));
  app.use('/jobs/:id/correct',express.json({limit:'24mb'}));
  app.use('/jobs/:id/track',express.json({limit:'24mb'}));
  app.use(express.json({limit: '8kb'}));
  const syncJobsFromDisk = () => {
    try {
      for (const id of readdirSync(output).filter(id => ID.test(id))) {
        if (jobs.has(id)) continue;
        try {
          const saved: Job = JSON.parse(readFileSync(path.join(output, id, 'job.json'), 'utf8'));
          if (saved.id === id && saved.status === 'completed') jobs.set(id, saved);
        } catch { /* Ignore incomplete metadata */ }
      }
    } catch { /* Output directory unreadable */ }
  };
  app.get('/health', (_req, res) => res.json({ready: requirements.every(p => existsSync(p)), activeJobId: active?.job.id || null, trackingReady: existsSync(trackingPython)}));
  app.get('/jobs', (_req, res) => {
    syncJobsFromDisk();
    res.json([...jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60));
  });
  app.get('/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) { res.status(404).json({error: 'Job not found.'}); return; }
    res.json(job);
  });
  type ImportRecord = {version:1;token:string;ids:string[];fingerprint?:string;sourceIds?:string[];status:'importing'|'pending'|'committed'|'rolledBack'};
  const journalFolder=path.join(runtime,'import-transactions');
  mkdirSync(journalFolder,{recursive:true});
  const importRecords=new Map<string,ImportRecord>();
  const journalPath=(token:string)=>{
    if(!ID.test(token))throw new Error('Invalid import transaction.');
    return path.join(journalFolder,`${token}.json`);
  };
  const persistImport=(record:ImportRecord)=>{
    const destination=journalPath(record.token),temporary=`${destination}.${randomUUID()}.tmp`;
    try{
      writeFileSync(temporary,JSON.stringify(record),{flag:'wx',flush:true});
      renameSync(temporary,destination);
      importRecords.set(record.token,record);
    }finally{if(existsSync(temporary))rmSync(temporary);}
  };
  for(const name of readdirSync(journalFolder)){
    if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
    try{
      const file=path.join(journalFolder,name),stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)continue;
      const record:ImportRecord=JSON.parse(readFileSync(file,'utf8'));
      if(record.version!==1||name!==`${record.token}.json`||!ID.test(record.token)||!Array.isArray(record.ids)||record.ids.length>24||!record.ids.every(id=>typeof id==='string'&&ID.test(id))||!['importing','pending','committed','rolledBack'].includes(record.status))continue;
      importRecords.set(record.token,record);
    }catch{/* Preserve malformed records and their media; never infer permission to delete. */}
  }

  const discardImport=(token:string,finalize=true)=>{
    const record=importRecords.get(token);
    if(!record||record.status==='committed')throw new Error('Import transaction not found or already finalized.');
    if(record.status==='rolledBack')return;
    const folders=record.ids.map(id=>{
      const folder=path.resolve(output,id);
      if(!ID.test(id)||path.dirname(folder)!==path.resolve(output))throw new Error('Unsafe import rollback target.');
      if(existsSync(folder)){
        const stat=lstatSync(folder);
        if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe import rollback target.');
        if(record.status==='importing'&&readdirSync(folder).length===0){/* Crash between mkdir and ownership write. */}
        else{
          const job=JSON.parse(readFileSync(path.join(folder,'job.json'),'utf8'));
          if(job.id!==id||job.importToken!==token)throw new Error('Imported media ownership changed; preserved files.');
        }
      }
      return {id,folder};
    });
    for(const {id,folder} of folders){rmSync(folder,{recursive:true,force:true});jobs.delete(id);}
    if(finalize)persistImport({...record,status:'rolledBack'});
  };
  app.post('/imports/:token/rollback',(req,res)=>{
    if(importing)return void res.status(409).json({error:'An import is running. Retry rollback after it finishes.'});
    try{discardImport(req.params.token);res.json({rolledBack:true});}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:'Import rollback failed.'});}
  });
  app.post('/imports/:token/commit',(req,res)=>{
    if(importing)return void res.status(409).json({error:'An import is running. Retry finalization after it finishes.'});
    const record=importRecords.get(req.params.token);
    if(!record||record.status==='rolledBack'||record.status==='importing')return void res.status(409).json({error:'Import transaction not found or already rolled back.'});
    try{if(record.status!=='committed')persistImport({...record,status:'committed'});res.json({committed:true});}
    catch{res.status(503).json({error:'Import finalization could not be saved. Media was preserved; retry finalization.'});}
  });
  let importing=false;
  app.post('/imports',async(req,res)=>{
    if(importing)return void res.status(409).json({error:'Another media import is running.'});
    const operationId=req.body?.operationId;
    if(operationId!==undefined && (!req.body?.transactional||typeof operationId!=='string'||!ID.test(operationId)))return void res.status(400).json({error:'Use a valid transaction operation ID.'});
    const fingerprint=createHash('sha256').update(JSON.stringify(req.body?.archives??null)).digest('hex');
    const previous=operationId?importRecords.get(operationId):undefined;
    if(previous){
      if(previous.fingerprint!==fingerprint||!previous.sourceIds||previous.sourceIds.length!==previous.ids.length)return void res.status(409).json({error:'This import operation belongs to a different backup.'});
      if(previous.status==='rolledBack')return void res.status(409).json({error:'This import operation was rolled back. Start a new restore.'});
      if(previous.status==='importing'){
        try{discardImport(operationId,false);}catch(error){return void res.status(409).json({error:error instanceof Error?error.message:'Partial import could not be recovered.'});}
      }else{
      importing=true;
      try{
        const items=[];
        for(let index=0;index<previous.ids.length;index++){
          const id=previous.ids[index],job=jobs.get(id);
          if(!job||job.status!=='completed'||job.importToken!==operationId)throw new Error('Imported media is no longer available for this operation.');
          const manifest=job.kind==='video'?await readVideoManifest(path.join(output,id),id):undefined;
          items.push({sourceJobId:previous.sourceIds[index],job,manifest});
        }
        res.json({items,importToken:operationId});
      }catch(error){res.status(409).json({error:error instanceof Error?error.message:'Import recovery failed.'});}
      finally{importing=false;}
      return;
      }
    }
    if(req.body?.transactional && [...importRecords.values()].filter(record=>record.status==='pending'||record.status==='importing').length>=20)return void res.status(409).json({error:'Too many unfinished imports. Resolve existing imports first.'});
    importing=true;
    try {
      const importToken=req.body?.transactional?(operationId??randomUUID()):undefined;
      const restored=await importLocalMedia(output,req.body?.archives,importToken?{
        token:importToken,
        prepare:(ids,sourceIds)=>persistImport({version:1,token:importToken,ids,sourceIds,fingerprint,status:'importing'}),
      }:undefined);
      for(const item of restored)jobs.set(item.job.id,item.job);
      if(req.body?.transactional){
        for(const item of restored){const job={...item.job,importToken};save(job);jobs.set(job.id,job);}
        persistImport({version:1,token:importToken!,ids:restored.map(item=>item.job.id),sourceIds:restored.map(item=>item.sourceJobId),fingerprint,status:'pending'});
        res.status(201).json({items:restored,importToken});
      }else res.status(201).json(restored);
    }
    catch(error){res.status(422).json({error:error instanceof Error?error.message:'Media import failed.'});}
    finally{importing=false;}
  });
  app.get('/jobs/:id/archive', (req,res)=>{
    const job=getJob(req.params.id);
    if(!job||!ID.test(req.params.id))return void res.status(404).json({error:'Local media was not found.'});
    try {res.json(archiveLocalMedia(path.join(output,job.id),{...job,kind:job.kind}));}
    catch(error){res.status(422).json({error:error instanceof Error?error.message:'Media backup failed.'});}
  });
  app.get('/jobs/:id/assets/:file', (req, res) => {
    const {id, file} = req.params;
    const job = getJob(id);
    if (!ID.test(id) || !job || (!assets.has(file) && !/^frame-\d{3}\.png$/.test(file)) || job.status !== 'completed') {
      res.status(404).end(); return;
    }
    res.sendFile(path.resolve(output, id, file), {dotfiles: 'allow'}, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
  function stop(reason: string) {
    corrections.forEach(controller=>controller.abort());
    if (!active) return;
    const {job, child} = active;
    job.status = 'cancelled'; job.message = reason; save(job);
    // Windows venv and Python supervisor both spawn children; stop this job's tree only.
    if (child.pid && process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true});
    else child.kill('SIGTERM');
    // Keep the GPU busy until close confirms the worker has actually exited.
  }
  app.post('/jobs/:id/cancel', (req, res) => {
    if (!active || active.job.id !== req.params.id) { res.status(409).json({error: 'This job is no longer running.'}); return; }
    const job = active.job; stop('Cancelled by you.'); res.json(job);
  });
  app.post('/jobs/:id/detect-objects', (req, res) => {
    const job = getJob(req.params.id);
    if (!job || job.status !== 'completed') { res.status(404).json({error: 'Job not found or not completed.'}); return; }
    const folder = path.join(output, job.id);
    const objectsFile = path.join(folder, 'objects.json');
    if (existsSync(objectsFile)) {
      try {
        const saved = JSON.parse(readFileSync(objectsFile, 'utf8'));
        res.json(saved.map((object: any) => ({ ...object, source: 'local-saliency', provenance: 'unverified-proposal',
          confidence: 0, maskRef: `local-saliency:${object.objectId}`, requiresReview: true }))); return;
      } catch {}
    }
    if (!existsSync(python)) {
      res.status(503).json({error: 'Python runtime not found. Run scripts/setup_local_ai.ps1 first.'});
      return;
    }
    let responded = false;
    const proc = launch(python, [path.join(root, 'scripts/detect_objects.py'), folder, '--prompt', job.prompt], {cwd: root, windowsHide: true});
    proc.on('error', err => {
      if (responded) return;
      responded = true;
      res.status(500).json({error: `Failed to spawn detection process: ${err.message}`});
    });
    proc.on('close', code => {
      if (responded) return;
      responded = true;
      if (code === 0 && existsSync(objectsFile)) {
        try {
        const saved = JSON.parse(readFileSync(objectsFile, 'utf8'));
        res.json(saved.map((object: any) => ({ ...object, source: 'local-saliency', provenance: 'unverified-proposal',
          confidence: 0, maskRef: `local-saliency:${object.objectId}`, requiresReview: true }))); return;
      } catch {}
      }
      res.status(500).json({error: 'Failed to extract objects from video frames.'});
    });
  });

  app.post('/jobs/:id/modify', (req, res) => {
    const job = getJob(req.params.id);
    if (!job || job.status !== 'completed') { res.status(404).json({error: 'Job not found or not completed.'}); return; }
    // The current detector only proposes regions in frame 0. Repeating that mask
    // across a moving clip would repaint the background and is not object tracking.
    res.status(422).json({error: 'Video recolouring needs verified masks for every frame. Current local proposals are not tracked. No video was changed; use current-frame mask correction instead.'});
  });

  function completedVideo(id: string) {
    const job = getJob(id);
    if (!ID.test(id) || !job || job.kind !== 'video' || job.status !== 'completed') throw new VideoTrackError('Choose a completed local video.');
    return job;
  }
  app.get('/jobs/:id/frames', async (req,res) => {
    try { const job=completedVideo(req.params.id); res.json(await readVideoManifest(path.join(output,job.id),job.id)); }
    catch (error) { res.status(422).json({error:error instanceof Error ? error.message : 'Clip frames could not be read.'}); }
  });
  app.post('/jobs/:id/track', async (req,res) => {
    const controller=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    if (corrections.size) return void res.status(409).json({error:'Another local video operation is running.'});
    corrections.add(controller);
    try {
      const job=completedVideo(req.params.id);
      if (!existsSync(trackingPython)) return void res.status(503).json({error:'Local motion suggestions are not installed. You can still select and review each frame manually.'});
      const folder=path.join(output,job.id);
      const manifest=await readVideoManifest(folder,job.id,controller.signal);
      const {fingerprint,track}=req.body as {fingerprint:string;track:VideoObjectTrack};
      if(fingerprint!==manifest.fingerprint || !track || !['cup','umbrella'].includes(track.objectId) || !Array.isArray(track.frames) || track.frames.length>manifest.frames.length)
        throw new VideoTrackError('Reload the clip and review an object before suggesting motion.');
      const indices=new Set<number>();
      for(const entry of track.frames) {
        const frame=manifest.frames[entry?.frameIndex];
        if(!frame || indices.has(entry.frameIndex) || entry.sourceHash!==frame.sourceHash || !Number.isInteger(entry.revision) || entry.revision<1) throw new VideoTrackError('A seed mask belongs to a different frame.');
        indices.add(entry.frameIndex);
        const mask=decodeVideoMask(entry.maskBase64,frame.width*frame.height);
        if(entry.reviewed && (entry.absent ? mask.some(Boolean) : mask.reduce((sum,pixel)=>sum+pixel,0)<16)) throw new VideoTrackError('Review visible pixels or mark the object absent.');
      }
      const result=await runVision(trackingPython,[path.join(root,'scripts/track_video_masks.py'),folder],controller.signal,32*1024*1024,JSON.stringify({manifest,track}));
      if(!res.destroyed)res.json(JSON.parse(result.toString()));
    } catch(error) { if(!res.destroyed)res.status(422).json({error:error instanceof Error ? error.message : 'Motion proposal failed.'}); }
    finally { corrections.delete(controller); }
  });
  app.post('/jobs/:id/correct', async (req,res) => {
    const controller=new AbortController(); let derived: Job|undefined;
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    if(corrections.size) return void res.status(409).json({error:'Another local video operation is running.'});
    corrections.add(controller);
    try {
      const source=completedVideo(req.params.id), folder=path.join(output,source.id);
      const manifest=await readVideoManifest(folder,source.id,controller.signal);
      const plan=req.body as VideoTrackPlan;
      validateVideoPlan(manifest,plan);
      derived={id:randomUUID(),kind:'video',prompt:source.prompt,seed:source.seed,status:'running',message:'Applying reviewed frame masks.',createdAt:new Date().toISOString()};
      const destination=path.join(output,derived.id);mkdirSync(destination);jobs.set(derived.id,derived);save(derived);
      const report=await correctVideoFrames(folder,destination,manifest,plan,controller.signal);
      derived.status='completed';derived.message='Corrected local take. Review the encoded video.';derived.report={...report,operation:'reviewed-mask-correction'};save(derived);
      if(!res.destroyed)res.status(201).json({id:derived.id,sourceJobId:source.id,videoUrl:`/api/local-ai/jobs/${derived.id}/assets/generated-video.mp4`,imageUrl:`/api/local-ai/jobs/${derived.id}/assets/frame-000.png`,report});
    } catch(error) {
      if(derived){derived.status=controller.signal.aborted?'cancelled':'failed';derived.error=error instanceof Error?error.message:'Video correction failed.';derived.message='Source clip remains unchanged.';save(derived);}
      if(!res.destroyed)res.status(422).json({error:error instanceof Error?error.message:'Video correction failed.'});
    } finally { corrections.delete(controller); }
  });

  app.post('/jobs', (req, res) => {
    const {kind, prompt, seed = 42} = req.body || {};
    if (!['image','video'].includes(kind) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1500 ||
        !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
      res.status(400).json({error: 'Choose image or video, a prompt of 1–1500 characters, and an integer seed from 0 to 2147483647.'}); return;
    }

    if (active) { res.status(409).json({error: 'Another GPU job is still running. Wait or cancel it.'}); return; }

    // This endpoint is explicitly local. Environment settings must never silently
    // route its no-credit generation button to a billed cloud GPU.
    if (!requirements.every(p => existsSync(p))) { res.status(503).json({error: 'Local models are not installed. Run scripts/setup_local_ai.ps1 first.'}); return; }
    const job: Job = {id: randomUUID(), kind, prompt: prompt.trim(), seed, status: 'running', message: 'Loading local model…', createdAt: new Date().toISOString()};
    const folder = path.join(output, job.id);
    mkdirSync(folder); jobs.set(job.id, job); save(job);
    const child = launch(python, ['-u', path.join(root, 'scripts/run_local_ai.py'), kind, '--prompt', job.prompt,
      '--seed', String(seed), '--output', folder], {cwd: root, windowsHide: true, shell: false});
    active = {job, child};
    let log = '';
    const timer = setTimeout(() => stop('Stopped after 10 minutes. Check local GPU availability and retry.'), 600000);
    const capture = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-16000);
      const steps = [...log.matchAll(/CUDA denoising pass (\d+)/g)];
      if (job.status === 'running' && log.includes('Preparing local disk offload') && !steps.length) job.message = 'Preparing local disk offload cache…';
      if (job.status === 'running' && steps.length) {
        job.message = `Denoising pass ${steps.at(-1)![1]} / ${kind === 'image' ? 21 : 4} on local GPU`;
      }
    };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    child.on('error', error => {job.error = error.message;});
    child.on('close', code => {
      clearTimeout(timer);
      writeFileSync(path.join(folder, 'worker.log'), log);
      if (job.status !== 'cancelled') {
        try {
          const report = JSON.parse(readFileSync(path.join(folder, 'inference-report.json'), 'utf8'));
          if (code !== 0 || !['technical_pass','passed'].includes(report.status)) throw new Error(report.error || `Worker exited (${code}).`);
          if (!existsSync(path.join(folder, kind === 'image' ? 'generated-image.png' : 'generated-video.mp4'))) throw new Error('Generated media is missing.');
          job.report = report; job.status = 'completed'; job.message = 'Generated locally. Review visual quality.';
        } catch (error) {
          job.status = 'failed';
          job.error ||= (code !== 0 && !existsSync(path.join(folder, 'inference-report.json'))
            ? `Worker process exited with code ${code}.${log ? ' ' + log.trim().slice(-500) : ''}`
            : error instanceof Error ? error.message : 'Local generation failed.');
          job.message = 'Generation failed. No cloud fallback was used.';
        }
      }
      save(job); active = undefined;
    });
    res.status(202).json(job);
  });
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({error: error.status === 413 ? 'Request too large.' : 'Invalid local request.'}));
  return {app, stop};
}

export function localAiPlugin(): Plugin {
  return {name: 'anchorshot-local-ai', configureServer(server) {
    if (server.config.server.middlewareMode) return;
    const service = createLocalAi(server.config.root);
    server.middlewares.use('/api/local-ai', service.app);
    server.httpServer?.once('close', () => service.stop('Local server stopped.'));
  }};
}
