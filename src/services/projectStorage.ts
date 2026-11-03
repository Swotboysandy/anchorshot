import {validNarrationUrl} from './narration';
import type { ProjectState, StoryboardShot } from '../types/framelock';

export interface ProjectLibrary { active: string; projects: ProjectState[] }

let database: Promise<IDBDatabase> | null = null;
const baselines = new Map<string, unknown>();
const pending = new Map<string, Promise<void>>();
const saveErrors = new Map<string, unknown>();

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('anchorshot-projects', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error('Close other AnchorShot tabs and retry opening local storage.')); };
    });
  }
  return database;
}

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return left.every((value, i) => value === right[i]);
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (record(a) && record(b)) {
    const left = Object.keys(a).filter(key => a[key] !== undefined);
    const right = Object.keys(b).filter(key => b[key] !== undefined);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return false;
}
const textFields = (value: Record<string, any>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
const validMask = (value: unknown) => record(value) && textFields(value, ['id', 'maskRef', 'objectId', 'maskBase64'])
  && record(value.box) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value.box[key]));
function validVideoRaster(value: unknown): boolean {
  if(typeof value!=='string'||!value.length||value.length>1398104||value.length%4!==0)return false;
  try {
    const bytes=atob(value);
    if(!bytes.length||bytes.length>1024*1024||btoa(bytes)!==value)return false;
    for(let i=0;i<bytes.length;i++)if(bytes.charCodeAt(i)>1)return false;
    return true;
  } catch {return false;}
}
const validVideoPlan = (plan: unknown, jobId: unknown): boolean => plan === undefined || (record(plan)
  && plan.sourceJobId === jobId && typeof plan.fingerprint === 'string'
  && Array.isArray(plan.tracks) && plan.tracks.length >= 1 && plan.tracks.length <= 2
  && new Set(plan.tracks.map((t:any)=>t?.objectId)).size === plan.tracks.length
  && plan.tracks.every((track:unknown)=>record(track) && ['cup','umbrella'].includes(track.objectId)
    && ['blue','emerald','amber','red','purple','white'].includes(track.color)
    && Array.isArray(track.frames) && track.frames.length >= 2 && track.frames.length <= 64
    && track.frames.every((frame:unknown,index:number)=>record(frame) && frame.frameIndex===index
      && typeof frame.sourceHash==='string' && validVideoRaster(frame.maskBase64)
      && Number.isSafeInteger(frame.revision) && frame.revision>0 && typeof frame.reviewed==='boolean'
      && typeof frame.absent==='boolean' && ['manual','optical-flow'].includes(frame.method))));
const validShot = (value: unknown): value is StoryboardShot => record(value)
  && (value.narrationDataUrl===undefined || (validNarrationUrl(value.narrationDataUrl) && typeof value.narrationName==='string' && Number.isFinite(value.narrationDurationSeconds) && value.narrationDurationSeconds>0 && value.narrationDurationSeconds<=14.6))
  && validVideoPlan(value.videoMaskPlan, value.generatedJobId)
  && textFields(value, ['id', 'promptDescription', 'spokenDescription', 'currentImageUrl', 'originalImageUrl'])
  && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0
  && Number.isInteger(value.shotNumber) && ['consistent', 'mismatch', 'uncertain'].includes(value.status)
  && Array.isArray(value.revisions) && value.revisions.every((take: unknown) => record(take)
    && validVideoPlan(take.videoMaskPlan, take.generatedJobId)
    && textFields(take, ['revisionId', 'imageUrl', 'actionApplied']) && Number.isFinite(take.timestamp))
  && (!value.proposedFix || (record(value.proposedFix) && textFields(value.proposedFix, ['action', 'targetObject', 'targetColor'])
    && (!value.proposedFix.mask || validMask(value.proposedFix.mask))
    && (!value.proposedFix.candidates || (Array.isArray(value.proposedFix.candidates) && value.proposedFix.candidates.every(validMask)))));

/** Validate before restoring or replacing anything; damaged records stay untouched. */
export function validateProjectLibrary(value: unknown): asserts value is ProjectLibrary {
  if (!record(value) || typeof value.active !== 'string' || !Array.isArray(value.projects)
    || !value.projects.every((project: unknown) => record(project)
      && textFields(project, ['projectId', 'title', 'transcript', 'statusAnnouncement'])
      && project.projectId.length > 0 && (project.activeShotId === null || typeof project.activeShotId === 'string')
      && Array.isArray(project.shots) && project.shots.every(validShot)
      && new Set(project.shots.map((shot: StoryboardShot) => shot.id)).size === project.shots.length
      && Array.isArray(project.rules) && project.rules.every((rule: unknown) => record(rule)
        && textFields(rule, ['id', 'targetObject', 'property', 'expectedValue']) && Number.isInteger(rule.revision)))
    || new Set(value.projects.map((project: ProjectState) => project.projectId)).size !== value.projects.length) {
    throw new Error('Saved projects are damaged or unsupported. The existing data has not been overwritten.');
  }
}

export function validateSavedRecord(key: string, value: unknown) {
  if (value === undefined) return;
  if (key === 'library') return validateProjectLibrary(value);
  if (!key.startsWith('dream:')) return;
  const validSelection = (selection: unknown) => selection === null || (record(selection)
    && typeof selection.name === 'string' && Number.isInteger(selection.revision) && selection.revision > 0
    && record(selection.photo) && Number.isSafeInteger(selection.photo.width) && selection.photo.width > 0
    && Number.isSafeInteger(selection.photo.height) && selection.photo.height > 0
    && selection.photo.data instanceof Uint8ClampedArray && selection.mask instanceof Uint8Array
    && selection.mask.length === selection.photo.width * selection.photo.height
    && selection.photo.data.length === selection.mask.length * 4 && selection.mask.every((pixel: number) => pixel === 0 || pixel === 1)
    && selection.mask.reduce((count: number, pixel: number, i: number) => count + (pixel === 1 && selection.photo.data[i * 4 + 3] === 255 ? 1 : 0), 0) >= 16);
  if (!record(value) || !validSelection(value.selection) || !validSelection(value.umbrella))
    throw new Error('Saved masks are damaged or unsupported. The existing data has not been overwritten.');
}

export function localSaveError(error: unknown): string {
  if (error instanceof Error && error.name === 'QuotaExceededError')
    return 'Local storage is full. Keep this page open and free browser storage, then edit to retry.';
  return error instanceof Error ? error.message : 'Local save failed. Keep this page open and retry.';
}

export async function loadLocal<T>(key: string): Promise<T | undefined> {
  await pending.get(key)?.catch(() => {});
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').get(key);
    request.onsuccess = () => {
      try {
        validateSavedRecord(key, request.result);
        baselines.set(key, structuredClone(request.result));
        resolve(request.result);
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

function mergeLibrary(base: unknown, next: unknown, current: unknown): ProjectLibrary {
  validateProjectLibrary(next);
  if (base !== undefined) validateProjectLibrary(base);
  if (current !== undefined) validateProjectLibrary(current);
  const previous = base as ProjectLibrary | undefined;
  const stored = current as ProjectLibrary | undefined;
  const projects = new Map((stored?.projects ?? []).map(project => [project.projectId, project]));
  for (const project of next.projects) {
    const original = previous?.projects.find(item => item.projectId === project.projectId);
    if (equal(project, original)) continue;
    const latest = projects.get(project.projectId);
    if (!equal(latest, original) && !equal(latest, project))
      throw new Error('This project changed in another tab. Your edits are still here; copy them before reloading to load the saved version.');
    projects.set(project.projectId, project);
  }
  return { active: previous?.active === next.active ? stored?.active ?? next.active : next.active, projects: [...projects.values()] };
}

/** Compare and merge inside one read/write transaction, including concurrent tabs. */
export function saveLocal(key: string, value: unknown): Promise<void> {
  let snapshot: unknown;
  try { snapshot = structuredClone(value); }
  catch (error) { saveErrors.set(key, error); return Promise.reject(error); }
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!baselines.has(key)) throw new Error('Load saved data before replacing it. Existing data has not been overwritten.');
    validateSavedRecord(key, snapshot);
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const request = store.get(key);
      let failure: unknown;
      request.onsuccess = () => {
        try {
          validateSavedRecord(key, request.result);
          const base = baselines.get(key);
          let merged: unknown = snapshot;
          if (key === 'library') merged = mergeLibrary(base, snapshot, request.result);
          else if (!equal(request.result, base) && !equal(request.result, snapshot))
            throw new Error('These masks changed in another tab. Your edits are still here; keep this page open before reloading.');
          if (!equal(merged, request.result)) store.put(merged, key);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { baselines.set(key, snapshot); resolve(); };
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local save aborted. Existing data has not been overwritten.'));
    });
  });
  pending.set(key, operation);
  void operation.then(() => saveErrors.delete(key), error => { saveErrors.set(key, error); });
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}

/** Do not abandon in-memory mask edits while a save has failed or is pending. */
export async function flushLocalSaves(): Promise<void> {
  await Promise.all(pending.values());
  if (saveErrors.size) throw saveErrors.values().next().value;
}

/** Persist a prepared archive as a new project, with its masks in the same transaction.
 * Media URLs must already have been restored and validated by the archive importer.
 */
export async function insertRestoredProject(project: ProjectState, dream: unknown): Promise<ProjectLibrary> {
  const snapshot = structuredClone(project);
  const masks = structuredClone(dream);
  snapshot.isRecording = false;
  snapshot.isPlayingAnimatic = false;
  snapshot.isProcessing = false;
  const key = `dream:${snapshot.projectId}`;
  validateProjectLibrary({ active: snapshot.projectId, projects: [snapshot] });
  validateSavedRecord(key, masks);
  await flushLocalSaves();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const libraryRequest = store.get('library');
    const maskRequest = store.get(key);
    let next: ProjectLibrary;
    let failure: unknown;
    maskRequest.onsuccess = () => {
      try {
        validateSavedRecord('library', libraryRequest.result);
        const existing = libraryRequest.result as ProjectLibrary | undefined;
        if (existing?.projects.some(item => item.projectId === snapshot.projectId) || maskRequest.result !== undefined)
          throw new Error('A project or masks with this ID already exists. Restore as a new project.');
        next = { active: snapshot.projectId, projects: [...(existing?.projects ?? []), snapshot] };
        store.put(next, 'library');
        if (masks !== undefined) store.put(masks, key);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => {
      baselines.set('library', structuredClone(next));
      baselines.set(key, structuredClone(masks));
      resolve(next);
    };
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Project restore aborted. Existing projects have not changed.'));
  });
}


export interface RestoreOperation {version:1;operationId:string;projectId:string}
/** Claim a stable restore identity before any service request. */
export async function beginRestoreOperation(fingerprint:string):Promise<{operation:RestoreOperation;library?:ProjectLibrary;project?:ProjectState}>{
 if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('Invalid backup fingerprint.');
 const db=await openDatabase(),key=`restore:${fingerprint}`;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
  const operationRequest=store.get(key),libraryRequest=store.get('library');
  let result:{operation:RestoreOperation;library?:ProjectLibrary;project?:ProjectState},failure:unknown;
  libraryRequest.onsuccess=()=>{try{
   const value=operationRequest.result;
   if(value!==undefined&&(!record(value)||value.version!==1||typeof value.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(value.operationId)||typeof value.projectId!=='string'||!/^[a-f0-9-]{36}$/.test(value.projectId)))throw new Error('Restore recovery record is damaged. Existing data was preserved.');
   validateSavedRecord('library',libraryRequest.result);
   const operation:RestoreOperation=value??{version:1,operationId:crypto.randomUUID(),projectId:crypto.randomUUID()};
   if(value===undefined)store.put(operation,key);
   const library=libraryRequest.result as ProjectLibrary|undefined;
   result={operation,library,project:library?.projects.find(project=>project.projectId===operation.projectId)};
  }catch(error){failure=error;tx.abort();}};
  tx.oncomplete=()=>resolve(result);
  tx.onabort=()=>reject(failure??tx.error??new Error('Could not save restore recovery record.'));
  tx.onerror=()=>reject(failure??tx.error);
 });
}

export async function finishRestoreOperation(fingerprint:string,operationId:string):Promise<void>{
 if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('Invalid backup fingerprint.');
 const db=await openDatabase(),key=`restore:${fingerprint}`;
 await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.get(key);
  let failure:unknown;
  request.onsuccess=()=>{try{if(request.result?.operationId===operationId)store.delete(key);}catch(error){failure=error;tx.abort();}};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure??tx.error);tx.onerror=()=>reject(failure??tx.error);
 });
}
