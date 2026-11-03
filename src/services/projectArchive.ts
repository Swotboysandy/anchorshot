import {beginRestoreOperation,finishRestoreOperation,loadLocal,type ProjectLibrary} from './projectStorage';
import {localRequest} from './localGeneration';
import type {ProjectState} from '../types/framelock';
import type {LocalMediaArchive} from '../types/mediaArchive';
import type {VideoManifest} from '../types/videoTracks';
import {validateProjectLibrary, validateSavedRecord, flushLocalSaves, insertRestoredProject} from './projectStorage';
import {decodeArchive, encodeArchive} from './archiveCodec';
import {assertVideoPlanSource} from './videoTracking';

export interface ProjectArchive {
  format: 'anchorshot-project';
  version: 1;
  project: ProjectState;
  dream?: unknown;
  media: LocalMediaArchive[];
  images: Record<string, string>;
}
export interface RestoredMedia {sourceJobId: string; job: {id: string}; manifest?: VideoManifest}
const IMAGE_FIELDS = new Set(['currentImageUrl', 'originalImageUrl', 'imageUrl', 'sourceImageUrl']);
const LOCAL = /^\/api\/local-ai\/jobs\/([a-f0-9-]{36})\/assets\/([a-z0-9.-]+)(?:\?[^#]*)?$/;
const inlineImage = (value: string) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);

/** Visit only fields with defined media semantics, never strings in the story or prompt. */
function visit(value: unknown, field: (owner: Record<string, any>, key: string) => void, seen=new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if(seen.has(value))return;seen.add(value);
  if (Array.isArray(value)) {value.forEach(item => visit(item, field, seen)); return;}
  for (const key of Object.keys(value)) {
    const owner = value as Record<string, any>;
    field(owner, key);
    visit(owner[key], field, seen);
  }
}

export function validateProjectArchive(input: unknown): asserts input is ProjectArchive {
  const archive = input as ProjectArchive;
  if (!archive || archive.format !== 'anchorshot-project' || archive.version !== 1
    || !Array.isArray(archive.media) || archive.media.length > 24 || !archive.images
    || typeof archive.images !== 'object' || Array.isArray(archive.images)) throw new Error('Unsupported project backup.');
  validateProjectLibrary({active: archive.project?.projectId, projects: [archive.project]});
  validateSavedRecord(`dream:${archive.project.projectId}`, archive.dream);
  const jobs = new Map<string, Set<string>>();
  for (const media of archive.media) {
    if (!media || media.version !== 1 || !/^[a-f0-9-]{36}$/.test(media.sourceJobId)
      || jobs.has(media.sourceJobId) || !Array.isArray(media.files)) throw new Error('Invalid or duplicate media job in backup.');
    jobs.set(media.sourceJobId, new Set(media.files.map(file => file.name)));
  }
  visit(archive.project, (owner, key) => {
    if (key === 'generatedJobId' || key === 'sourceJobId') {
      if (owner[key] !== undefined && !jobs.has(owner[key])) throw new Error('Backup is missing a referenced media job.');
    }
    if (!IMAGE_FIELDS.has(key) && key !== 'videoUrl') return;
    const url = owner[key];
    if (url === undefined) return;
    if (typeof url !== 'string') throw new Error('Invalid media reference.');
    const local = url.match(LOCAL);
    if (local) {
      if (!jobs.get(local[1])?.has(local[2])) throw new Error('Backup is missing a referenced media file.');
    } else if (key === 'videoUrl') throw new Error('Backup contains an unsupported video reference.');
    else if (!inlineImage(url) && !(Object.hasOwn(archive.images, url) && inlineImage(archive.images[url])))
      throw new Error('Backup is missing an embedded scene image.');
  });
}

export function serializeProjectArchive(archive: ProjectArchive): string {
  validateProjectArchive(archive);
  return encodeArchive(archive);
}
export function parseProjectArchive(text: string): ProjectArchive {
  const archive = decodeArchive(text);
  validateProjectArchive(archive);
  return archive;
}

/** Bind archived selections to newly imported files only after checking every source frame. */
export function prepareRestoredProject(archive: ProjectArchive, restored: RestoredMedia[], projectId: string = crypto.randomUUID()) {
  validateProjectArchive(archive);
  if (!projectId || projectId === archive.project.projectId) throw new Error('Restore requires a new project ID.');
  const mapping = new Map(restored.map(item => [item.sourceJobId, item]));
  if (mapping.size !== restored.length || mapping.size !== archive.media.length
    || new Set(restored.map(item => item.job.id)).size !== restored.length
    || restored.some(item => !/^[a-f0-9-]{36}$/.test(item.job.id))
    || archive.media.some(item => !mapping.has(item.sourceJobId))) throw new Error('Incomplete restored media mapping.');
  const project = structuredClone(archive.project);
  const maskReferences=new Map<string,string>();
  visit(project, (owner, key) => {
    if(key==='maskRef' && typeof owner[key]==='string'){
      const old=owner[key];
      if(!maskReferences.has(old))maskReferences.set(old,`restored:${projectId}:${maskReferences.size+1}`);
      owner[key]=maskReferences.get(old)!;
      if(owner.provenance==='live-sam-3.1')owner.serverDetached=true;
    }
    if (key === 'videoMaskPlan' && owner[key]) {
      const plan = owner[key];
      const imported = mapping.get(plan.sourceJobId);
      if (!imported?.manifest || imported.manifest.jobId !== imported.job.id) throw new Error('Restored video manifest is missing.');
      plan.sourceJobId = imported.job.id;
      plan.fingerprint = imported.manifest.fingerprint;
      assertVideoPlanSource(imported.manifest, plan);
    }
    if (key === 'generatedJobId' && owner[key]) owner[key] = mapping.get(owner[key])!.job.id;
    if (!IMAGE_FIELDS.has(key) && key !== 'videoUrl') return;
    const url = owner[key];
    if (typeof url !== 'string') return;
    const local = url.match(LOCAL);
    if (local) owner[key] = `/api/local-ai/jobs/${mapping.get(local[1])!.job.id}/assets/${local[2]}`;
    else if (Object.hasOwn(archive.images, url)) owner[key] = archive.images[url];
  });
  project.projectId = projectId;
  project.title = `${project.title} (restored)`;
  project.isPlayingAnimatic = project.isRecording = project.isProcessing = false;
  project.statusAnnouncement = 'Project restored. Review continuity before applying further corrections.';
  for (const shot of project.shots) {
    shot.status = 'uncertain';
    shot.continuityChecks = undefined;
    shot.discrepancyMessage = undefined;
  }
  validateProjectLibrary({active: projectId, projects: [project]});
  return {project, dream: structuredClone(archive.dream)};
}


/** Collect a frozen project snapshot; no model calls and no arbitrary URL fetches. */
export async function collectProjectArchive(project: ProjectState, dream: unknown, signal?: AbortSignal): Promise<ProjectArchive> {
  const archive: ProjectArchive = {format:'anchorshot-project', version:1, project:structuredClone(project), dream:structuredClone(dream), media:[], images:Object.create(null)};
  validateProjectLibrary({active:archive.project.projectId, projects:[archive.project]});
  validateSavedRecord(`dream:${project.projectId}`,archive.dream);
  const jobs = new Set<string>();
  const images = new Set<string>();
  visit(archive.project, (owner,key) => {
    const value=owner[key];
    if ((key==='generatedJobId'||key==='sourceJobId') && value!==undefined) {
      if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid local media job reference.');
      jobs.add(value);
    }
    if(!IMAGE_FIELDS.has(key)&&key!=='videoUrl')return;
    if(value===undefined)return;
    if(typeof value!=='string')throw new Error('Invalid media reference.');
    const local=value.match(LOCAL);
    if(local)jobs.add(local[1]);
    else if(key==='videoUrl')throw new Error('Only local generated videos can be included in this backup.');
    else if(!inlineImage(value)) {
      if(!/^\/api\/muse\/frames\/[a-f0-9]{64}\.png$/.test(value))throw new Error('A scene image has an unsupported source. Import it locally before backing up.');
      images.add(value);
    }
  });
  if(jobs.size>24)throw new Error('A backup supports at most 24 local media jobs.');
  let mediaBytes=0;
  for(const id of jobs) {
    signal?.throwIfAborted();
    const media=await localRequest<LocalMediaArchive>(`/jobs/${id}/archive`,undefined,60000,signal);
    if(media.sourceJobId!==id)throw new Error('The backup service returned a different media job.');
    for(const file of media.files)mediaBytes+=file.base64.length*3/4;
    if(mediaBytes>128*1024*1024)throw new Error('Combined local media exceeds the 128 MB restore limit.');
    archive.media.push(media);
  }
  for(const url of images) {
    signal?.throwIfAborted();
    const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png'||!response.body)throw new Error('A scene image is missing or invalid. Backup was not created.');
    const reader=response.body.getReader();
    let size=0;const chunks:Uint8Array[]=[];
    try {
      while(true) {
        const {value,done}=await reader.read();if(done)break;
        size+=value.length;
        if(size>24*1024*1024)throw new Error('A scene image exceeds the 24 MB backup limit.');
        chunks.push(value);
      }
    } finally {await reader.cancel();reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    if(!url.endsWith(`${hash}.png`))throw new Error('A scene image failed its content hash check. Backup was not created.');
    let raw='';for(const chunk of chunks)for(let i=0;i<chunk.length;i+=8192)raw+=String.fromCharCode(...chunk.subarray(i,i+8192));
    archive.images[url]=`data:image/png;base64,${btoa(raw)}`;
  }
  signal?.throwIfAborted();
  serializeProjectArchive(archive); // Enforce whole-file size and reference coverage before offering a download.
  return archive;
}


/** Restore media first; publish the project atomically only after all source checks pass. */
export async function restoreProjectArchive(text: string) {
  const archive=parseProjectArchive(text);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  const fingerprint=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  const restore=async()=>{
    await flushLocalSaves();
    const recovery=await beginRestoreOperation(fingerprint);
    const {operationId,projectId}=recovery.operation;
    let importToken:string|undefined;
    let saved=Boolean(recovery.project);
    try {
      let project=recovery.project;
      let library=recovery.library;
      if(!project){
        const requestImport=()=>localRequest<{items:RestoredMedia[];importToken:string}>('/imports',{archives:archive.media,transactional:true,operationId},120000);
        let imported:{items:RestoredMedia[];importToken?:string}={items:[]};
        if(archive.media.length){
          try{imported=await requestImport();}catch{imported=await requestImport();}
          if(imported.importToken!==operationId)throw new Error('The media service returned a different restore operation.');
        }
        importToken=imported.importToken;
        const prepared=prepareRestoredProject(archive,imported.items,projectId);
        library=await insertRestoredProject(prepared.project,prepared.dream);
        project=prepared.project;saved=true;
      }else{
        // Refresh the normal save baseline before returning an already-published project.
        library=await loadLocal<ProjectLibrary>('library');
        if(!library)throw new Error('Saved project library is unavailable. Keep the backup and retry.');
        importToken=archive.media.length?operationId:undefined;
      }
      let warning:string|undefined;
      try{
        if(importToken)await localRequest(`/imports/${importToken}/commit`,{});
        await finishRestoreOperation(fingerprint,operationId);
      }catch{warning='Project was saved, but restore finalization could not be confirmed. Choose the same backup again to finish recovery.';}
      return {library:library!,project:project!,warning};
    }catch(error){
      if(importToken&&!saved){
        try{await localRequest(`/imports/${importToken}/rollback`,{});await finishRestoreOperation(fingerprint,operationId);}
        catch{throw new Error(`${error instanceof Error?error.message:'Restore failed.'} Recovery is saved locally. Choose the same backup again; existing projects were preserved.`);}
      }
      throw error;
    }
  };
  // Serialize the same backup across tabs; the lock releases automatically on page close.
  if(typeof window==='undefined')return restore();
  if(!navigator.locks)throw new Error('This browser cannot safely coordinate restore recovery. Use a browser with Web Locks support.');
  return navigator.locks.request(`anchorshot-restore:${fingerprint}`,restore);
}
