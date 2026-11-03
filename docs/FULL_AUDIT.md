# AnchorShot audit — 3 November 2026

Status: **in progress**, not a release sign-off. Working tree based on `db9a9ea` on `orb-and-feedback-fixes`. Completed audit fixes are packaged for main at the user's request; the overall audit is not signed off. Original Nikku/Fylmer and `.claude/` were not changed. Tests use fixtures and a separate offline server; no Meta, Muse, Baseten or other paid generation was invoked.

## Purpose and acceptance scope

The requested product is a voice-directed storyboard/dream editor: editable story and scenes, real local media generation, object selection/correction, independent cup and umbrella protection during the kitchen-to-ocean transition, persistent projects, accessible monochrome UI, and a playable export. Evidence must distinguish source containment, semantic correctness, temporal identity, model inference and encoding. A passing build alone cannot establish those outcomes.

The audit covers the existing client, local/paid provider boundaries, editor state, persistence, rendering and export. Disabling an unsafe implementation is containment, not completion of its intended feature. The unfinished items below remain part of the goal.

## Findings repaired and evidence

| Area / failing behavior | Change | Evidence and limits |
| --- | --- | --- |
| Shot planning ignored the session call limit; reference-image fallback retries were uncounted | Every provider attempt reserves the shared budget, including retries; live failures stay visible | `auditBoundaries`, `imager`, `serverPlanner`; stub transports, no paid calls |
| A hidden local-video environment setting could route a free local action to cloud generation and fabricate GPU timing | Removed automatic cloud routing; local worker retains serialization/cancel/restart behavior | `localAi.test.ts` sets a forbidden cloud endpoint and proves the local worker is used |
| Unconnected frame/motion endpoints reported generation success; frame edits could tint everything without a proper selection | Unsupported legacy endpoints now fail explicitly. Masked edits require a real reference-conditioned image provider, exact nonempty masks and measured pixel differences | `auditBoundaries`; source validation happens before reserving a call. Neural edit quality is not tested live |
| Video analysis fabricated a wedding narrative, objects, speech and confidence | Results now describe only the requested local job; heuristic regions are labelled unverified; no invented scene understanding | `videoFindings`, `auditBoundaries` |
| First-frame saliency regions were treated as SAM tracks and reused through a moving clip | False identity/confidence labels removed. Unsafe video recolouring rejects before changing files | Superseded by source-bound reviewed per-frame correction; see current completion table and video checkpoints below |
| Manual storyboard segmentation omitted the selected image | The image bytes and source hash are sent; masks are bound to the selected source URL | Browser `auditWorkflow` manual-SAM fixture and `samCup` adapter tests; no live inference |
| A live segmentation failure silently returned an authored sample mask | Live failures surface and audits remain uncertain; sample masks cannot correct generated frames | `studio`, `auditBoundaries`, API/browser fixture coverage |
| Alternate-object selection renamed the primary mask and could invent an object or confidence | Store every returned candidate; select only a same-source, same-shot, same-revision candidate; retain its own bounds and score | `auditBoundaries` checks a distinct second candidate, spoofed bounds/confidence and missing IDs |
| Selection was promoted to “consistent” without a colour measurement | Selection keeps its previous verdict; post-repair colour is measured separately from containment | `samFrameAudit`, `studio`; a mock repair that leaves red pixels stays uncertain |
| Only the first colour rule was checked | Every active colour rule is audited; per-object results are retained and the worst result is shown | `studio` covers independent cup/umbrella results. Spatial/identity rules still need real evaluators |
| A planned absent prop was considered visually absent | Planned omissions remain unverified without image evidence | `samFrameAudit` |
| Create rendered an empty third column even though it supplied only two panes | Only render a details pane when present; preview uses the remaining width, while Dream/Review retain their three panes | `layoutPersistence` measures the preview edge and width, checks Review controls and mobile overflow; desktop/mobile screenshots inspected |
| Prompt edits replaced chosen images with a sample; empty duration became 3.5 seconds | Metadata saves preserve media, masks and takes; duration is validated at 0.5–15 seconds | `auditWorkflow`, `auditBoundaries`; refresh tested |
| Applying a video replaced every scene; rebuilding could auto-mount an old clip into all shots | Video applies explicitly to the chosen scene only; automatic attachment removed | Browser `auditWorkflow`; other shots remain stills |
| Switching takes changed only the poster while the newer video continued playing | Takes record video/job/source-offset metadata; restoring a still clears video and stale verdicts | `auditBoundaries` and browser `auditWorkflow`, including refresh |
| Thumbnail clicks used source-video offsets as film time; reordering wrote an unused time field | Scene selection uses scene IDs; video seeks include source offsets; reordering updates the actual playhead | Browser video/timeline regression; editor controls smoke tests |
| Pending region scans could update a different project with the same shot ID | Project and source-job ownership checks reject stale results; inspector/workspace state resets per project | Browser test holds the old response, switches to a new project with the same shot/job IDs, then releases it |
| Unconfigured voice fell back to browser recognition that can upload audio | Removed browser recognition fallback. The unconnected orb only meters sound; server dictation still requires a configured provider | `backendDictation` and browser `voiceOverlay`: zero recognizer constructors, recorders or POSTs; tracks stop on close. Configured-agent caption fixture still passes |
| Concurrent tabs overwrote the entire project library or another tab's masks | Atomic read/compare/merge transactions preserve distinct projects and reject conflicts; switching flushes saves and loads the latest stored project | Browser `storageSafety`: different-project edits merge; same-project and binary-mask conflicts preserve the first save |
| Malformed stored data could crash restore; quota errors could be hidden on mobile | Validate project and mask records before use or overwrite. Keep failed edits in memory, preserve the last saved record, and expose the error in the existing accessible monochrome notice | Browser `storageSafety`: corrupt record remains unchanged; injected quota failure preserves prior data and recovery survives refresh; desktop/mobile error visibility checked |
| Late microphone/transcription results survived project switching | Explicit discard cancels requests, ignores old generations and stops streams; normal stop still submits a recording | `backendDictation` late-response and late-permission tests |
| Stopping voice allowed late replies to issue commands; audio setup failures leaked resources | Abort through client/server/provider, tool-loop cancellation gates, bounded history, mic/context/timer cleanup | `agent` includes a real loopback HTTP disconnect and startup/recorder failures |
| Malformed voice histories could consume a paid call | Validate roles, sizes and complete tool/result pairs before request reservation | `agent` |
| MP4 export silently dropped video clips or BITC when falling back | Encode actual clip buffers/source offsets; still WebM fallback only when features can be retained; failures restore controls | `animatic` encodes and decodes a moving clip with BITC; `auditWorkflow` simulates encoder failure |
| Browser fallback could time out as partial success or leave media tracks open | Missing images and invalid durations fail; elapsed-time watchdog rejects partial results; timers/tracks cleaned | Existing export tests and source review; remaining fallback limits below |

## Earlier verification checkpoints

Baseline before this audit: `npm run check` passed with 134 Vitest tests. Baseline browser suite: 34 passed / 1 failed; the take-comparison test pressed its key before the asynchronous correction completed. It now waits for the actual result.

Historical evidence from the first checkpoints (superseded by the current completion audit below):

- `npm run check`: **173 Vitest tests / 22 files, 8 rendering tests, 1 local-worker test**, TypeScript and production build pass. Log: `.artifacts/audit-followup-check.log`.
- Full offline Chrome suite after voice/storage fixes: **45 passed**, covering landing viewport fit, mobile/desktop layouts, project rename/switch/refresh, keyboard/dialog controls, voice captions/orb, scene editing, real photo masks, two-object protection and exports. Log: `.artifacts/audit-followup-browser.log`.
- After the final save-error presentation changes, **7 targeted browser tests passed**, including visible desktop/mobile errors and non-scrolling landing views. Log: `.artifacts/audit-storage-mobile-browser.log`. After removing the empty Create column, **6 targeted browser tests passed** and TypeScript passed; `.artifacts/audit-layout-followup-browser.log`. These counts overlap the full suite, with one additional layout regression. Final screenshots: `.artifacts/audit-dashboard-desktop.png`, `.artifacts/audit-dashboard-mobile.png`.
- Production build after storage changes passes: `.artifacts/audit-followup-build.log`; the subsequent conditional panel change also passes TypeScript and the six UI regressions.
- After the earlier colour-verdict change, **10 targeted browser tests passed**, including the new manual SAM candidate fixture, all new audit workflows, editor takes and voice command dispatch. Log: `.artifacts/audit-selection-browser.log`. Counts overlap the full suite; they are not 49 distinct tests.
- Downloaded two-object export independently checked by `python scripts/verify_two_anchor_export.py`: 800x450 VP9, 287 decoded frames, 11.985775 seconds, increasing timestamps, full decode passes. Cup 21,041 and umbrella 17,980 selected PNG pixels are unchanged; masks do not overlap and the environment changes. Compositor report checks 289 uncompressed samples, zero protected-pixel drift, p95 11.4 ms on this run.
- WebM is lossy: sampled mean channel errors are about 2.35–2.98/255. Zero raw-pixel drift is **not** claimed for encoded video.
- Actual MP4 encoding test checks a moving source clip, 1.5-second output and burn-in timecode. This does not establish narration export or neural transition quality.
- `git diff --check` passes (line-ending conversion notices are not test failures).

Two intermediate storage regression runs passed the four new library tests but failed the older project test, which reloaded while an asynchronous switch was still in progress. The app now shows switching progress and persists the destination before opening it; the test waits for the actual landing heading. The full 45-test rerun passed.

One early targeted browser run had a blank first page and timed out before finding the landing controls (3 passed / 1 failed). The complete rerun passed that case and all 39 tests. No result is hidden or counted twice.

## Current completion audit (updated after later checkpoints)

Earlier checkpoint sections below are chronological evidence, not all current status. The original acceptance scope remains intact.

| Requirement | Current evidence | Remaining gap |
| --- | --- | --- |
| Source-bound video selection/correction | Per-frame cup/umbrella masks, explicit approval, optical-flow proposals, absence/re-entry fixtures, independent masks, real corrected MP4 and unchanged source tests | Learned semantic tracking and representative real generated-video quality are not established by synthetic fixtures |
| Color correction and containment | White/neutral recoloring, alpha/holes/outside-pixel tests, post-repair color measurement | Color votes cannot verify arbitrary identity/spatial continuity |
| Persistent and portable projects | Browser rename/switch/refresh/conflicts/quota tests; actual backup into an independent service with media hashes and current/historical masks retained | Durable operation IDs, pre-allocation journals and same-file retry cover lost responses and reconstructed interruption states; physical power loss during writes is not proven |
| Source and selection identity | Source hash, exact shot, server epoch and segmentation-result ID checks; stale selections remain local without mutating new tracks | Final review of all project/reorder/rule transitions remains part of full regression |
| Preview/export parity and narration | Actual MP4 audio measurements; desktop/mobile narration; all six camera movements; multi-shot fallback frame/duration checks; hidden-tab pause/rejection | Arbitrary CPU stalls, OS suspension and perceptual review of a representative complete film remain unproven |
| Semantic continuity and video understanding | Unsupported claims removed; generated media and unmeasured attributes stay uncertain | Spatial/character/general video-language evaluators remain unimplemented, not completed by honest labeling |
| Fresh hardware/live evidence | Fresh offline CUDA image and video inference completed; image applied through the actual app and retained after refresh; see hardware checkpoints below | Actual app video generation/application/playback/refresh now verified for one fresh job; representative generated dream-transition quality remains open. Paid provider quality/occlusion/rate behavior and actual microphone/screen-reader walkthrough are unverified; no paid calls authorized |
| Product copy and delivery | Explicit fixture/provenance and failure labels; original monochrome UI preserved; route loading split and actual production asset requests measured | Final copy/dead-path review and representative end-to-end demo still required. Latest full browser attempt:107passed/1startup timeout; unchanged failed case passed separately; build warning is resolved |

Latest complete code check: TypeScript,10 rendering tests,1 local-worker test,253 Vitest tests/32files and production build passed (largest App chunk460.15kB). The following full Chrome attempt completed107passed/1failed in7.7minutes. The failing invalid-scene-command case timed out before reaching any command: trace console reports ERR_NO_BUFFER_SPACE loading the Plus Jakarta Sans stylesheet. An unchanged isolated rerun passed in12.7seconds. This is not a clean108/108 full run. No source/documentation writes occurred during the code check or full browser run. These results do not prove the unimplemented or hardware-dependent rows above. Full audit completion remains unproven.

## Reference coding used

XERJ runs locally on loopback 9237. Index refresh was rejected by its flood-stage low-disk safeguard; the existing index is stale. Searches are retrieval leads, not proof of current implementation. Current source was read directly after each lookup; no safeguard was bypassed.

| Query/corpus | Pinned source read | Use |
| --- | --- | --- |
| `disambiguate`, `switchProject`, `buildContinuityFindings` / anchorshot | Current worktree `server/sam.ts`, `src/services/metaModels.ts`, `src/App.tsx` | Exposed fabricated re-keying, stale callbacks and video findings. Search positions were stale; current files controlled decisions |
| `add_new_points_or_box` / ref-sam2 | facebookresearch/sam2 `2b90b9f5ceec907a1c18123530e92e794ad901a4`, `sam2/sam2_video_predictor.py:162–245` | Retain object/frame identity and validate prompts. Architectural reference only; no SAM2 dependency or claimed hackathon API compatibility |
| `useEffect`, `PromptInputTextarea` / ref-prompt-kit | ibelick/prompt-kit `5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a`, `components/prompt-kit/response-stream.tsx:199–264`, prompt input control | Cancellation gates and cleanup pattern; controlled input behavior. No authored layout replaced |
| `loadLocal`, `SpeechRecognitionService` / anchorshot; `saveProject` / ref-opencut | Current `projectStorage.ts`, `speechRecognitionService.ts`; OpenCut pin below | Existing index was stale and no useful upstream persistence result was found. Read current code and retained the same IndexedDB database/store; no upstream persistence implementation copied |
| `DashboardLayout` / anchorshot; `ResizablePanelGroup` / ref-shadcn-ui | Current DashboardLayout and pinned shadcn `apps/v4/registry/new-york-v4/ui/resizable.tsx:7–59` | Retain existing primitives and responsive tree; render only supplied content panes. No new component styling |
| `Alert` / ref-shadcn-ui; `role` / ref-beui | shadcn alert source `apps/v4/registry/new-york-v4/ui/alert.tsx:21–35`; beui `lib/component-about.ts:293–304` | Reused existing AnchorShot notice and added alert semantics for actual save failures; no component/layout redraw or new animation |
| `activeProject`, `export` / ref-opencut | OpenCut `e668010778568641babef2cc40be4703ae6916d6` | Results were sidebar/router hooks, not a suitable lifecycle/export implementation; deliberately not copied |
| `Button`, `disabled` / ref-shadcn-ui and ref-beui | Pins in `reference-repositories.json`; button/focusable state sources | Preserve existing component markup/styles and accessible unavailable states |
| `useReducedMotion` / ref-motion | motion `7415b6cd14dfdb35d91dfc5b9758994444cc228b` | Existing reduced-motion implementation retained |

No upstream UI appearance was redrawn. React lifecycle guidance, local UI/accessibility skills and source/reference inspection informed functional fixes. Evidence files are local/ignored; tests recreate them. This report is the current audit record; earlier dated build notes remain historical snapshots.

## Video correction checkpoint (2026-11-03)

20 focused tests passed across videoTracking, samFrameAudit and studio, including actual installed OpenCV propagation (not skipped). Controlled moving cup/umbrella fixtures verify absence/re-entry seeds, source retention, raw outside-mask preservation, separately measured encoded error and rejection of stale/unreviewed/overlapping plans. This is synthetic fixture evidence, not general semantic tracking or new GPU generation proof.

Fixed saved corrected-take measurements: link to modification-report.json instead of nonexistent inference-report.json; show correction metrics separately from GPU inference statistics and avoid assuming corrected clips are silent. API regression follows the actual report link and verifies its contents. TypeScript and diff checks pass after resolving compiler union narrowing. Browser presentation verification is still pending.

XERJ queries localAsset (anchorshot) and PromptInputTextarea (ref-prompt-kit) failed the install/path check in this sandbox. Read current component/service/server source directly; no upstream UI block or styling copied.

Still unfinished: interactive per-frame mask review UI, persistence and stale-source lifecycle integration. Backend tests do not complete tracking item 1; other audit requirements remain open.

### Client video review groundwork

Added source-hash-verified frame decoding at native resolution, binary mask encoding/decoding, independent cup/umbrella review records, explicit absence decisions, overlap/stale-source gating, and abortable manifest/propagation/render requests. Current UI connection remains unfinished; these are client services, not a completed interactive flow.

TypeScript passed. Seven focused videoReview/videoTracking tests passed: full 1024-square mask round trip, changed frame rejection before bitmap decoding, cancellation, all-frame/object approvals, absence, overlap and existing actual correction/optical-flow regressions.

Reference lookup worked with project access: CupMaskEditor / anchorshot (index stale; current file read), propagate_in_video / ref-sam2. Read sam2/sam2_video_predictor.py:547-589 at recorded pin 2b90b9f5ceec907a1c18123530e92e794ad901a4. Reused the principle that object/frame identity and reviewed seed frames are distinct; no SAM dependency or upstream UI copied.

### Interactive video review wired (verification incomplete)

Shot inspector now opens VideoMaskEditor for local videos: independent cup/umbrella tracks, frame selection, original-frame tracing/brush/erase, explicit absence, local optical-flow proposals, all-frame approval gating and corrected-take creation. Existing CupMaskEditor and Button are reused. Fixed-frame mode hides source uploads and synthetic cutout actions. Applying a video clears obsolete continuity checks.

Eight focused tests passed, including rendered fixed-frame controls, actual optical flow and correction regressions. TypeScript passed. This is not browser end-to-end proof: interactive tracing, cancellation across project switches, desktop/mobile layout and saved plans still need verification/integration. UI explicitly identifies selections as temporary; persistence remains unfinished. Legacy disabled video recolour controls still need removal after the replacement flow is browser-tested.

UI reference queries Button in ref-prompt-kit, ref-shadcn-ui, ref-motion and ref-beui completed. Existing local Button markup/styles were reused; no new authored upstream layout claimed.

### Browser review proof and approval invalidation

Chrome desktop video mask walkthrough passed, then passed again after adding the dirty-mask regression. It opens hash-verified PNG frames, traces separate cup and umbrella masks, approves frames, marks the cup absent, submits both tracks, attaches a new take, retains the original revision and leaves continuity uncertain. Editing an approved mask now revokes approval immediately; rendering stays disabled until approval is renewed. TypeScript passed.

Proof boundary: this browser test uses fixture image/manifest/correction responses; real optical flow and MP4 rendering are covered separately by videoTracking API tests. A single browser-to-real-renderer run, mobile review layout, project-switch cancellation and persisted video plans remain outstanding. Test server was managed by Playwright.

### Video-mask persistence checkpoint

Video plans now save in the existing project library on the source shot and matching take revisions. RestoreTake restores only matching job-bound plans; image/new-video replacement clears the current plan. Video apply and plan-update callbacks check project identity. Changed manifest fingerprints block reuse and retain saved selections instead of silently discarding them. Basic stored-plan structure is validated before library restore/save.

Chrome walkthrough passed after adding actual refresh between cup approval/absence and umbrella editing; approved state and absence survived IndexedDB reload and the corrected take still completed. TypeScript passed. Brush drafts are not saved until approval; UI says to finish/approve before leaving a frame. Real browser-to-renderer, take restoration browser coverage, switching/cancellation, malformed-mask hardening and mobile layout remain outstanding.

Reference queries restoreShotTake / anchorshot returned stale locations; saveProject / ref-opencut had no match. Current shotEdits/projectStorage/App sources governed implementation; no foreign persistence implementation was copied.

### Browser to actual renderer proof

Desktop Chrome and 390x844 mobile Chrome each passed an actual local correction walkthrough. Temporary synthetic moving source video was served by createLocalAi on loopback; browser requests were forwarded to the real service, not fulfilled with invented correction results. The UI traced/approved separate cup and umbrella regions over five frames, marked the cup absent in frame 3 and created a new take. Actual ffprobe verified five decoded 128x96 MP4 frames; report verified zero raw outside-selection drift and visible-frame counts 4/5; SHA-256 of every original source file stayed unchanged. Temporary service/fixtures were closed/removed.

Mobile document had no horizontal overflow; inspected .artifacts/video-review-390.png confirms usable approval/render controls in the existing monochrome UI. These deliberately partial manual selections verify pipeline mechanics, not semantic segmentation quality or complete object coverage. Existing ground-truth API tests cover full masks and flow; actual learned object tracking is not claimed. TypeScript passed before parameterizing the viewport.

Remaining: project-switch cancellation and take-restoration browser checks, malformed saved-mask hardening, removal of obsolete duplicate controls/copy, then the broader outstanding audit items.

### Corrupt-mask and take restoration checks

Saved raster validation now decodes bounded canonical base64 and checks binary bytes. Editor verifies saved/proposed tracks against every current frame hash and dimension before displaying them; reopening clears the previous manifest so validation errors cannot leave stale controls active. Stored masks remain retained on source validation failures.

TypeScript and 24 focused tests passed. Chrome persistence walkthrough additionally restored Take 2 with both approved tracks, then supplied a dimension-mismatched manifest: visible error appeared, no selection canvas rendered, and both tracks remained stored. This closes take-restoration and malformed source rendering regressions; project-switch cancellation and broader audit items remain open. Reference query validateProjectLibrary / anchorshot returned stale leads; current projectStorage, VideoMaskEditor and existing recovery tests were inspected directly.

### Cancellation, obsolete controls and full regression checkpoint

Chrome tests passed for normal reviewed-mask application and switching to a new project while correction was pending. The browser emitted request cancellation and neither saved project received the delayed result. Removed the unused static-mask recolour handler, disabled duplicate colour/action block and misleading confidence percentage on saliency proposals. Fixed-frame preview copy now describes correction rather than a dream background.

Full npm run check passed: 182 Vitest tests across 24 files, 10 rendering tests, 1 local-worker test, TypeScript and production build. First full run timed out in a million-element Vitest deep equality assertion; replaced only that matcher with equal-length and exact per-byte comparison, retaining full coverage. Rerun passed. Build warns about the 832.74 kB main chunk; performance remains an open audit item.

Reference query handleModifyVideoColor / anchorshot returned stale leads; read current handler and its sole disabled button before removing both. No current backend or reviewed correction path removed. Broad browser suite still needs rerun after integration; the local video flow now has focused UI/service/source-preservation evidence, with semantic tracking quality explicitly unverified.

### Browser fallback framing and capture fix

Fallback WebM previously stretched portrait/square images to 800x450 and painted an unrequested caption/status strip unlike MP4. It now contains the image on black with its aspect ratio intact and omits that overlay. Actual decoded-WebM browser test initially returned no frame at 0.3 seconds, exposing static-canvas capture truncation. Added periodic repaint during the hold and clear its timer on finish/error. Rerun passed: decoded frame dimensions 800x450, black side margins, preserved portrait boundaries and white bottom pixels without the old caption strip.

Remaining export requirements: complete timing/seekable metadata verification, camera-motion parity, narration/audio UI integration and audio export proof. This checkpoint does not close export item 5. XERJ exportStoryboardAnimaticVideo / anchorshot returned stale source; current recorder read. ref-opencut export results were unrelated router hooks, deliberately not copied.

### Fallback duration and camera motion

Reused installed @fix-webm-duration/fix 1.0.1 to write measured recording duration into WebM metadata. Read its local README and existing src/dream/render.ts use; XERJ fixWebmDuration search returned stale leads. Added canvas framing equations matching server cameraMove for Push in, Dolly, Pull out, Pan and Tilt, applied each capture tick to the contained source canvas. Unknown/locked moves remain still. No dependency downloaded.

TypeScript passed. Decoded-browser export tests cover locked, push-in and pan: finite duration 0.9-1.5s for a one-second shot, more than 15 decoded frames, portrait aspect containment and no caption overlay; moving cases compare decoded frames at 0.3 and 0.8 seconds. First run's moving-case test command used ffmpeg timestamp .8, which this build rejects; fixed to 0.8 before rerun. This does not yet verify all camera modes, multi-shot accumulated timing, background-tab timing or audio export.

### Narration export plumbing

Current source has no AudioTimeline/attachment UI (the reference index still points at removed files). Encoder already supported narration but the export route/client discarded it. Added optional shot narration data/name, pass bounded local audio data URLs through the session-protected MP4 route, reject remote/non-audio/oversized inputs, cap probed narration at 60 seconds, and disallow silent fallback when audio is present. Export announcements distinguish narrated from silent MP4. No TTS/model call introduced.

TypeScript and 10 animatic tests passed. Existing real tone-plus-silent-shot export now additionally decodes PCM and checks audible RMS during narration and near-zero energy in the following shot, beyond merely checking the AAC stream. Route test verifies exact bytes reach the encoder and invalid URLs/MIME types do not. This is encoder/request evidence; attachment UI, narration persistence validation, preview synchronisation and browser upload-to-export proof remain unfinished. XERJ narration/anchorshot and audio/ref-opencut returned historical documentation, not suitable current integration code; read current app, client, server and tests directly.

### Local narration attachment and real export proof

Scene inspector now accepts local MP3/WAV/Ogg/WebM/M4A recordings, decodes them before acceptance, limits files to 5 MB/14.6 seconds, shows native audio playback/removal and stores bytes/name/duration with the scene. Attachment extends scene duration through the recording plus 0.4s pause within the existing 15s scene cap. Late upload callbacks are gated by component/request and project identity. Library validation rejects invalid stored narration fields. Existing Button and native file-input pattern reused; indexed Input searches across UI corpora were consulted without copying a new authored block.

TypeScript passed. Real Chrome upload/refresh/export/removal test passed using a generated local four-second tone: attached WAV survived IndexedDB reload, scene duration expanded to at least 4.4s, downloaded MP4 decoded audible PCM at the expected second-scene time, and removal cleared the player. No cloud/model requests.

Still required: synchronised film playback/scrubbing, preventing later duration edits from cutting the audio timing contract, error/project-switch cases and mobile audio controls. Native scene preview is independent, not yet timeline synchronisation.

### Narration timeline synchronization

Added a source-bound narration player following the film clock, including paused seeks, shot boundaries, mute and pause/unmount. Playback failures surface an alert. Narrated shots suppress overlapping synthesized descriptions. Scene text/duration edits reject shortening below narration plus 0.4s; duration nudges clamp to the same floor.

Chrome upload/refresh/export test now also proves actual audio element playback, pause and keyboard seek alignment, then decoded exported audio. It passed. Nineteen audit-boundary tests and TypeScript passed, including duration rejection and preserved source audio. Existing CleanStudio/current clock code was read after a stale XERJ lookup; no new UI layout was copied. Still outstanding: mobile audio walkthrough, uploaded-audio decode failures, mute/shot-boundary/project-switch browser checks and the broader audit requirements.

### Broad browser regression and storage constraint

Desktop/mobile narration tests passed with failed-upload preservation, mute/unmute, pause/scrub, scene change and actual MP4 audio checks. Trim controls now disable at narration's minimum duration. All six fallback camera modes have decoded-export coverage.

Full Chrome run: 57 of 58 cases passed. The remaining layout-persistence case failed during browserContext.close with ENOSPC while writing a trace, not a layout assertion. F: had only about 352 MB available after transient cleanup; C: had about 22.5 GB. Config now stores Playwright output under a checkout-specific C: temporary directory (PLAYWRIGHT_OUTPUT_DIR override supported). No source or historical artifact cleanup performed. The affected case was rerun separately. This is not reported as an uninterrupted green full run.

Next confirmed gap: current Export JSON is a continuity report omitting current video/audio/track state and retaining server-relative URLs. Portable project backup/import remains required; do not present this report as a backup.

### Portable archive groundwork

Added local completed-media archive endpoint with a strict file allowlist, no symlink following, 128 MB job limit and SHA-256 per file. Actual synthetic video test verifies all five original frames plus MP4 bytes/hashes, excludes an unrelated file and rejects unfinished/missing jobs. Added JSON transport preserving Uint8Array masks and Uint8ClampedArray RGBA photos; rejects reserved/ambiguous binary tags and noncanonical encoding.

Four media/video regression tests, two archive-codec tests and TypeScript passed. No user archive has been imported or exported yet. Still needed: complete project envelope, media import/remapping, atomic project/dream restoration, UI controls and round-trip browser proof. XERJ saveLocal/anchorshot and importProject/ref-opencut returned unrelated/stale leads; read current project storage, dream records and local media service directly. Main dream mask records use dream:projectId; the separate legacy DreamStudio route uses its own localStorage plan and needs an explicit scope decision in the archive format.

### Validated local-media import

Added batch media import using fresh UUID folders, bounded metadata/file counts and bytes, canonical base64/SHA-256 validation, strict filenames, PNG decode checks and MP4 header/decoded frame validation. New video manifests expose fresh fingerprints while retaining frame hashes. Jobs register only after the whole batch validates; failure removes only freshly created UUID directories whose resolved parent matches the intended output root. Existing jobs/files are untouched. Imported media is explicitly unverified and does not acquire invented generation measurements.

Actual media-archive regression passed (one comprehensive Vitest case): byte-identical restored files, fresh IDs/fingerprints, unchanged per-frame hashes, corruption/traversal rejection and rollback after second-item decode failure. Existing source checksums remained equal. TypeScript passed. localAi.test.ts uses the Node test runner and was excluded by Vitest; it was not counted as a second test.

A component file contained a legacy single-byte middle dot among UTF-8 content; normalized only invalid bytes to UTF-8 while gating unavailable measurement links. Full project envelope/remapping, IndexedDB atomic import, cancellation/orphan handling and UI round-trip proof still remain. Media import alone is not a completed portable project restore.


### Atomic archive restoration storage checkpoint
- Added `insertRestoredProject` to commit a prepared project and its cup/umbrella raster record in one IndexedDB transaction. Existing project and orphan-mask ID collisions reject; existing projects remain unchanged; playback/recording/processing are reset on restore.
- Real Chrome IndexedDB test verifies exact typed mask/RGBA bytes, existing-project preservation, ID collision rejection, and rollback of the library write when the subsequent mask write throws QuotaExceededError.
- Validation: `npm run typecheck` passed; `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/storageSafety.spec.ts -g "archive insertion" --workers=1` passed (1 test).
- Reference coding: XERJ anchorshot `mergeLibrary` returned unrelated utility/license hits; ref-opencut `importProject` returned generated routes. Inspected current projectStorage.ts transaction implementation and opencut apps/web/src/routeTree.gen.ts lines 1-15 (pin e668010778568641babef2cc40be4703ae6916d6); generated routing is not a restoration reference and was deliberately not copied. Current source was authoritative.
- Still incomplete: portable project envelope, full media/source-reference mapping, import/export UI and complete browser archive roundtrip. This helper accepts already validated/restored media references; it is not itself a portable backup feature.


### Portable archive envelope and source rebinding checkpoint
- Added a versioned project envelope and binary-safe parsing/serialization. Every scene/take media reference must be represented by an archived local job/file or embedded image; unsupported external video references fail closed.
- Restoration maps local asset paths and job IDs for current scenes and historical takes, discards stale cache query strings, embeds non-job images, preserves narrative text verbatim, and gives the project a new ID. It does not mutate the source archive.
- Saved video plans bind to the imported manifest only after source hashes, frame counts and mask raster dimensions pass the existing integrity check. Restored continuity is uncertain until reviewed; playback/processing/recording stop.
- Validation: 4 tests passed across projectArchive.test.ts and archiveCodec.test.ts; TypeScript passed. Coverage includes typed dream masks, revisions, missing media/image rejection, source hash/dimension mismatch, ID replacement prevention and original-data preservation. These are mapping/serialization tests, not a complete UI backup roundtrip. Server media importer remains responsible for actual file decode/hash validation.
- Reference coding: XERJ anchorshot `archiveCodec` returned export verification scripts; ref-opencut `serialize` returned no match. Used current archiveCodec.ts, projectStorage.ts, localGeneration.ts and videoTracking.ts as authoritative contracts; no upstream archive implementation copied.
- Still required: export asset collection, restore orchestration with orphan-import handling, import/export controls, and complete real browser save/export/import/reload proof.


### Portable backup asset collection checkpoint
- Collector freezes the project and dream selections, deduplicates local jobs across current scenes and revisions, embeds retained Muse images, and refuses missing/unsupported references. No arbitrary remote URL fetch or model call is performed. Abort signals, per-request timeouts, image stream size limits, aggregate media restore limits and final archive-size checks apply before a download can be offered.
- Retained Muse image bytes must match the SHA-256 filename used by server/app.ts and server/imager.ts. Missing or hash-mismatched assets fail closed.
- Validation: 7 focused archive/codec tests passed and TypeScript passed. New tests cover job deduplication, snapshot isolation during async collection, embedded bytes, external URL rejection before network access, missing jobs, cancellation, and corrupt image identity. Fetch fixtures exercise collection contracts; actual complete browser backup/import remains unverified.
- Reference coding: XERJ anchorshot `toDataUrl` found src/lib/media.ts asset conversion/hash code; inspected it and canvasEngine.ts PNG output. ref-opencut `exportProject` returned routing hooks; inspected apps/web/src/router.tsx lines 1-18 at existing pin, deliberately rejected as irrelevant. Backup preserves original PNG bytes rather than copying media.ts resizing behavior, to retain mask alignment.
- Next: connect archive orchestration and controls, handle imported media if project storage fails, and prove a real browser roundtrip before calling portable backups complete.


### Archive restoration orchestration checkpoint
- Added transactional media import mode with an opaque server-issued token. Rollback resolves only the new job folders recorded for that token, checks absolute parents and IDs, and cannot target ordinary jobs or finalized imports. Atomic project/mask save runs after mapping validation; only failed pre-save restores request media rollback.
- A commit-acknowledgment failure after successful IndexedDB storage preserves media and returns an explicit warning instead of deleting media referenced by a saved project. Existing failed/pending local saves are checked before creating imports.
- Validation: 12 tests across mediaArchive, archiveRestore, projectArchive and archiveCodec passed; TypeScript passed. Real FFmpeg fixture test checks rollback deletion, original file hashes, job registry removal, and finalized import protection. Client tests cover quota rollback, failed finalization preservation, and prevention of import when prior edits cannot save.
- Reference coding: XERJ anchorshot `importLocalMedia` located localAi.ts/localGeneration.ts (read current implementations); ref-opencut `rollback` had no matches. No external implementation copied.
- Remaining limits: import tokens currently live in server memory; a server restart or response lost before the client receives a token can retain orphan import files. Automatic deletion is deliberately absent because a saved project may already reference those files. UI integration and full browser archive roundtrip remain required; this is not yet a completed backup feature.


### Backup UI and browser roundtrip checkpoint
- Added Files > Back up project / Restore backup using existing header details/form and Button components, without changing primitive styles. Restore remains available on the initial screen. Operations lock UI and global shortcuts while capturing/restoring state; statuses report success/failure. Report JSON now identifies itself as a continuity report, not an offline-fixture backup.
- Desktop and mobile Chrome tests download an actual archive, restore it into a fresh browser context, refresh, and compare every scene image/prompt/duration and both independent typed mask arrays/photo bytes. Existing blank project remains; restored copy receives a new ID. Both tests passed, TypeScript passed.
- The first mobile run found the reused rename class was hidden below 700px. Added a Files-specific visibility and bounded placement exception, reran both tests successfully, and visually inspected screenshots at 1440px and 390px (C:/Users/sunny/AppData/Local/Temp/anchorshot-backup-1440.png and anchorshot-backup-390.png). No horizontal overflow in either.
- UI reference scope: consulted ui-skills-root/fixing-accessibility; queried XERJ ref-shadcn-ui Button, ref-prompt-kit Button, ref-motion reducedMotion and ref-beui Button. Reused the existing local shadcn Button and existing project-rename block; no new upstream block or animation copied. Current local markup was the style authority. Mobile placement is a documented functional adaptation.
- Still unproven: full browser local-video archive roundtrip, interruption/restart recovery, stale live server mask identity handling after restore, malformed archive UI recovery, and full regression/build after all audit edits. Do not equate this sample-image/mask browser proof with real-model generation or complete audit readiness.


### Independent local-video backup proof and regression checkpoint
- Browser test now exports an actual five-frame synthetic MP4 and reviewed cup/umbrella plans, restores into a separate local service with no original job, reloads, verifies identical media file hashes and retained current/historical mask plans, checks video decoding, then creates a corrected take using the restored selections. New report: five frames, zero raw outside-mask changes, semantic continuity unverified. Source is explicitly synthetic, not model-generation evidence.
- `npm run check` passed: TypeScript, 10 rendering tests, 1 local-worker test, 196 Vitest tests across 28 files, production build. Build still warns on 848.76 kB main JS (270.94 kB gzip); performance remains open.
- Full Chrome suite: 62 cases, 57 passed and 5 failed because Files reused `.project-rename`, making rename locators ambiguous. Separated Files into `.project-files` and shared presentation through `:is(.project-rename,.project-files)`. All 10 affected project/storage/backup tests passed on rerun, including all five prior failures. This is full-run plus focused-rerun evidence, not an uninterrupted 62-green run.
- Read-only follow-up found legacy lib/correction.ts recolor is referenced only by its tests, while expandMask is used by current dream/meta paths. Do not treat the unused recolor path as evidence of current UI correction behavior; consolidate or remove dead legacy code in follow-up.
- Remaining audit gaps are unchanged: interrupted/restarted imports, restored live SAM reference lifetime, export timing/source-audio behavior, semantic limits, GPU generation revalidation under low disk constraints, bundle performance, and final requirement-by-requirement sign-off. No commit/push or paid calls performed.


### Source soundtrack preservation checkpoint
- Confirmed animatic exporter always substituted silence when no narration was attached, even if source video contained audio. Export now probes the first source audio stream and uses it from the same looped/trimmed video input. Silent source videos/stills still receive silence; attached narration intentionally replaces original scene audio. Existing corrected-take renderer already preserves optional source audio.
- Video preview now follows the app audio control instead of being permanently muted, and mutes source audio when attached narration plays. Added plain explanatory copy to the existing narration section; no component/layout redesign.
- Validation: all 11 animatic tests passed, including actual FFmpeg tone exports and decoded PCM measurements verifying source audio through a loop, silent next shot, replacement narration frequency, and silent narration tail. TypeScript passed. Desktop/mobile narration browser tests passed; first preview binding check caught an unchanged hardcoded mute attribute, which was fixed and the video backup/mute/correction browser test then passed.
- Reference coding: XERJ anchorshot renderAnimatic returned old canvas implementation; ref-opencut audio returned README setup rather than an export implementation. Current server/animatic.ts, server/videoTracks.ts and CleanStudio.tsx controlled the fix; no upstream code copied.
- Remaining audio concerns: preview playback rejection reporting, multi-shot/background timing, and original-audio browser perceptual proof beyond element mute state. Export audio was measured from decoded output rather than inferred from presence of an AAC stream.


### Bounded export and disconnect cleanup checkpoint
- Replaced unbounded export/probe subprocesses with the existing bounded runVision runner. Availability probe: 10 seconds; encoder: at most 5 minutes; media probes retain 60-second bound. Output capture is capped and all process exits remove timers/listeners.
- Export handler passes an AbortSignal to the renderer and aborts on premature response close. Renderer checks cancellation between shots and passes it into probes/encoder; its existing finally block removes temporary output after child exit. A request already disconnected during the availability probe does not begin encoding.
- Validation: 17 tests across exportCancellation, animatic and videoTracking passed; TypeScript passed. Actual Node child tests prove timeout/abort termination; actual HTTP disconnect test proves renderer signal propagation and export-lock release for the next request. Existing timecode option assertion now checks the signal too. Real FFmpeg audio/video tests remain green.
- Reference coding: XERJ runVision query returned older export/verification entries; ref-opencut AbortController returned unrelated form source. Current server/videoTracks.ts bounded-process implementation and server/app.ts lifecycle were authoritative; no external code copied.
- This closes the unbounded encoder/disconnected request gap, not all export timing or UI playback error gaps. Audit remains in progress.


### Video preview failure lifecycle checkpoint
- Removed ignored video.play rejection. Current-source playback failure now pauses media, announces a visible alert and explicitly stops the master timeline. Load errors also stop playback. Retry clears the error; effect cleanup rejects stale callbacks on scene/workspace changes and pauses the prior video.
- Validation: TypeScript passed; actual cross-service video backup browser test now injects a NotAllowedError into the video element, verifies timeline stops and visible recovery guidance, restores native play, verifies retry/clear, then completes the existing corrected-take check. This verifies behavior under an induced browser failure, not an actual device autoplay policy rejection.
- UI references: searched required prompt-kit useEffect, shadcn Alert, motion useReducedMotion and beui alert indices. Read pinned shadcn alert role semantics and existing TimelineNarration error rendering. Reused existing text alert styling; no copied block, new animation or layout changes.
- Narration-only failure handling still needs alignment with timeline-stop behavior; do not infer that from this video test. Audit remains active.


### Narration failure and stale completion checkpoint
- Timeline narration now reports failed starts/load errors through the same explicit timeline-stop callback as video. A pending-attempt guard prevents clock updates from repeatedly invoking play; source/unmount and pause state invalidate old attempts. Successful retry clears the alert.
- Desktop and mobile browser narration workflows now induce a NotAllowedError, verify one attempt and stopped timeline, restore native playback and verify recovery, then check paused seeking/mute and decode audible MP4 output. They also hold an audio-start promise, switch to another scene, reject the old promise and verify no stale alert reaches the new scene. Both tests passed; TypeScript passed before the test-only late-rejection extension.
- Reference coding: XERJ TimelineNarration returned old AudioTimeline entries; ref-prompt-kit useEffect located response-stream.tsx at the already reviewed pinned reference. Current TimelineNarration/CleanStudio lifecycle is authoritative; no visual block or animation change.
- Remaining goal scope includes interrupted import recovery, restored live-mask identity, accumulated export timing/background behavior, bundle performance and fresh local GPU proof. These narration tests do not complete the broader audit.


### Restored mask identity checkpoint
- Restored mask references are now local to the new project; historical live SAM rasters are marked serverDetached so confirming a saved candidate does not submit an expired reference to a different server. Candidate data and historical provenance remain intact; selection still does not imply verified continuity.
- Candidate confirmation now rejects a mask whose bound image differs from the active image, before any server request. Current live masks still use the existing server confirmation path.
- Test exposed shared-object traversal: selected mask and candidate entries can alias one object before serialization, causing a source URL to be remapped twice. The archive walker now visits each object once using WeakSet.
- Validation: 17 tests across projectArchive/studio/archiveRestore and TypeScript passed. Four browser tests passed: mocked live SAM candidate selection, desktop/mobile sample+mask backup, and independent-service real video backup/correction. Offline restored candidate test proves separate raster selection, local references, no fetch despite a configured session, stale-frame rejection and untouched original data.
- Reference coding: XERJ disambiguateMaskSelection located the method at stale line numbers; read current implementation. ref-sam2 obj_id led to sam2/sam2_video_predictor_legacy.py:130-147 at pin 2b90b9f5ceec907a1c18123530e92e794ad901a4: object indices belong to an inference state. Applied the identity boundary, not SAM2 API code.
- This handles archive restore identity. Ordinary persisted live masks across server restart still require a separate lifecycle review; no live model calls were used as proof.


### Saved mask server-restart identity checkpoint
- Added a non-secret maskSessionId distinct from the request authentication token. Health and segmentation responses identify the current track-store generation; live candidate confirmations must match it before touching stored tracks.
- Client verifies the mask server generation before confirming a retained live candidate. Masks from an older or unknown generation stay locally selectable from saved pixels and become serverDetached. Historical raster/provenance is preserved and continuity remains uncertain; no paid segmentation is required for selecting the saved candidate.
- Validation: 49 API/boundary/studio/archive tests passed. New two-server test recreates an identical maskRef, submits the old generation using valid new authentication, expects 409 MASK_SESSION_EXPIRED and proves the new track store unchanged. Client test verifies only a health read and no confirmation/model request after restart. TypeScript passed before test additions.
- Reference coding: XERJ MaskTrackStore located server/sam.ts; inference_state reference is the already reviewed SAM2 per-state object map. Applied session identity separation, without adopting external inference APIs.
- Same-session source replacement and stale object metadata remain separate identity cases to review. No completion claim for the overall audit.


### Same-session source replacement checkpoint
- Candidate confirmation now requires an exact positive integer shot number and source image SHA-256. It checks the current stored track before mutation. Changed-source tracks return MASK_SOURCE_CHANGED; absent tracks return MASK_TRACK_EXPIRED. Invalid candidate IDs still fail instead of becoming invented selections.
- Live masks retain their source hash. For a confirmed expired/replaced track, client preserves the old source-bound raster locally and marks it serverDetached; it does not update another image's track or silently launch segmentation. Legacy masks without a source hash remain local selections.
- Validation: initial 49 focused tests passed; after adding replacement-specific coverage, 26 API/studio tests passed, TypeScript passed, and mocked live SAM browser selection passed. Test replaces an image in the same server/shot/revision, confirms identical maskRef, rejects old hash and proves stored tracks unchanged; current hash succeeds. Client regression checks sent hash/shot and retained raster on explicit source-change response.
- Reference coding: XERJ invalidateBySourceOrRule located server/sam.ts; reviewed current getTrack/disambiguate/invalidation methods and previously inspected SAM2 per-state object map. No copied upstream implementation.
- Audit remains open for other identified persistence, performance and export requirements; this checkpoint is source identity evidence, not semantic tracking proof.


### Production route loading and trailing-slash checkpoint
- Studio and standalone dream entry modules now load by route; portable archive code loads on the Files action. Module-load failure offers an accessible reload action. Existing UI styling and offline behavior remain unchanged.
- Actual production static-server browser probe found /dream redirects to /dream/ because the public dream assets directory exists. Exact pathname matching incorrectly opened the studio. Bootstrap now normalizes trailing slashes; built production /dream -> /dream/ opens Dream editor without requesting the App chunk.
- Production build and TypeScript passed. Largest JS chunk is 448,557 bytes versus prior approximately 848,760 bytes; the 500 kB warning is gone. This is not a 47% page-download or speed improvement: Chrome requested 809,671 uncompressed JS bytes for studio (entry + App + shared correction), and 394,234 for standalone dream (entry + DreamStudio + shared correction). Neither initial route requested projectArchive. No timing-speedup claim.
- Validation: 16 focused Chrome tests passed for dream rendering/export, desktop/mobile landing, lazy modules/reload and independent-storage/video backups. After route fix, all 3 loading tests passed, including /dream/. The first new test used a stale heading expectation; corrected to the current source heading Dream editor. Production static serving with actual dist assets independently verified both route headings and requested module boundaries. Temporary production server closed in finally; Playwright-managed servers stopped.
- Reference coding: XERJ anchorshot manualChunks returned unrelated mask/render sources; ref-opencut lazy returned no match. Current src/main.tsx, vite.config.ts, server/index.ts and emitted import graph provided authoritative routing evidence. Prior reviewed OpenCut router at e668010778568641babef2cc40be4703ae6916d6 provided no implementation copied here. No visual block was changed.
- git diff --check passed. No commit, push, paid model calls or GPU generation. Full audit remains open: import restart recovery, same-image segmentation identity, export timing, semantic limits, fresh GPU proof, and final full regression/requirements sign-off are not established by these loading tests.


### Same-image segmentation-result identity checkpoint
- Confirmed that repeated segmentation of the identical image/shot/rule revision reuses maskRef, sourceHash and server session. Those fields alone allowed an old selection to confirm the newer candidate set.
- Stored tracks and live client masks now carry segmentationId from the response requestId. Server confirmation rejects missing or mismatched result identity with MASK_RESULT_CHANGED before mutation. Alternate-candidate lookup also requires matching segmentationId. Client keeps historical pixels locally selectable and serverDetached after explicit result replacement, or when older saved masks lack a result ID; this does not claim verified semantic continuity.
- Regression segments the same image twice with the same shot/revision, proves identical maskRef but different requestId, rejects the old/missing result ID, verifies unchanged current tracks, then successfully confirms the current result. Client regressions cover both image replacement and result replacement, assert request result ID, saved raster retention and uncertain status. Browser asserts selected-frame request, separate candidate pixels and transmitted segmentationId.
- Validation: TypeScript passed; 53 focused API/studio/archive/boundary tests passed. Initial boundary test exposed its obsolete request fixture, updated to the returned requestId rather than weakening validation. Two SAM-related browser tests passed, then the manual SAM browser test passed again with the explicit result-ID assertion. git diff --check passed. Tests use fixtures/mocks, not paid inference.
- Reference coding: XERJ anchorshot recordTrack found server/sam.ts; ref-sam2 inference_state found benchmark.py. Read actual sam2/sam2_video_predictor_legacy.py:130-147 at pin 2b90b9f5ceec907a1c18123530e92e794ad901a4: object identifiers belong to an inference state. Applied that identity boundary to the existing response requestId; no upstream API code copied.
- No commit/push. Audit remains active for import interruption recovery, timing/background playback/export, semantic limitations, fresh GPU proof and complete final regression.


### Hidden-tab timing and multi-scene fallback checkpoint
- Preview used elapsed requestAnimationFrame wall time without visibility handling; returning from a hidden tab could skip ahead while narration/media had different background behavior. Preview now pauses on visibility loss, stops synthesized speech, retains playhead and requires explicit Play to resume.
- Browser MediaRecorder fallback depends on foreground canvas/timers. It now refuses to start while hidden and rejects an interrupted recording with an explicit retry message, clears timers/listener and stops tracks. It never returns a partial film for download. Local FFmpeg MP4 rendering is independent and unchanged.
- Validation: TypeScript passed. Eight Chrome tests passed (six actual camera-movement WebM exports plus visibility pause/resume and interruption/retry). A separate ninth browser test exported white then black scenes, decoded pixels at 0.2/0.75/1.1 seconds and measured duration 1.2-1.65 seconds for the 1.3-second requested sequence. This tests real encoded bytes, not just mock completion.
- Visibility regressions deterministically override document.hidden and dispatch visibilitychange. They prove handler behavior and recorder cleanup/retry; they are not an OS-level minimized-window/power-suspension endurance test. No claim of exact frame scheduling under arbitrary CPU stalls.
- Reference coding: XERJ anchorshot exportStoryboardAnimaticVideo located stale line 618; inspected current implementation at 790 onward. ref-opencut visibilitychange returned no match; reviewed router.tsx at pin e668010778568641babef2cc40be4703ae6916d6 and found no applicable clock implementation to copy. Existing local timing/cleanup structure retained. No visual component changes.
- git diff --check passed. Test servers stopped. No commit/push/paid calls. Follow-up inspection also found timeline duration nudge bypasses the narration-minimum validation used by the main editor; this remains to fix. Import restart recovery, full regression and fresh GPU proof remain open.


### Narration-safe timeline trim and complete code-check checkpoint
- Timeline duration buttons disabled at the narration minimum, but a scene just above that minimum could still subtract 0.5 seconds and cut off audio. Callback also bypassed updateShotDetails validation. It now clamps to the decoded narration duration plus the 0.4-second pause and routes the edit through updateShotDetails. Existing UI/components unchanged.
- Desktop 1440px and mobile 390px browser tests attach four-second WAV narration, set the scene to 4.6 seconds, trim it to exactly 4.4, assert further trim disabled, and verify saved audio bytes, source image and correction mask unchanged. The same tests verify refresh, audio controls and audible downloaded MP4. Both passed.
- Full npm run check passed after all current code edits: TypeScript, 10 rendering tests, 1 local-worker test, 207 Vitest tests across 29 files, and production build. These offline worker tests are not fresh GPU/model inference proof. Largest emitted JS chunk 449.54 kB; no size warning.
- Reference coding: XERJ anchorshot updateShotDetails returned inspector/editor files rather than the new helper, so current src/lib/shotEdits.ts and App.tsx were inspected directly. ref-opencut duration returned navigation-menu.tsx:117; inspected and rejected as unrelated CSS animation timing (pin e668010778568641babef2cc40be4703ae6916d6). No external implementation copied.
- git diff --check passed. No push or paid calls. Remaining final audit requirements include interrupted/restarted archive recovery, full uninterrupted browser suite, real GPU validation subject to available disk/resources, and reconciliation of earlier audit notes into a requirement-by-requirement conclusion.


### Full browser run and test-server reload isolation
- Complete Chrome run: 68 cases, 67 passed, one cup WebM download timeout. Failure trace showed a second Vite connection and page initialization mid-export; captured UI had reset to Create. Audit markdown was edited during this run while Vite watched files. This is evidence of a page reload, not proof of an encoder defect.
- Playwright webServer now sets existing DISABLE_HMR=true, disabling hot reload and watcher for automated tests only. Normal development behavior remains unchanged. Both cup tests passed after this configuration change, including real photo selection, mask editing, preservation check and actual WebM download. Do not present 67 plus focused rerun as an uninterrupted 68-pass run; that final run remains due.
- Reconciled the top-level audit requirements with later implementation evidence. Original semantic, hardware, delivery and import-recovery requirements remain visible, rather than treating honest unsupported labels as completed features.
- Reference coding: XERJ anchorshot DISABLE_HMR located vite.config.ts; read the current hmr/watch branch. ref-opencut webServer returned wrangler.jsonc, inspected and rejected as unrelated deployment configuration at pin e668010778568641babef2cc40be4703ae6916d6. No upstream implementation copied.
- Read-only import review reconfirmed pendingImports is memory-only; server restart loses commit/rollback authorization. Preserve all imported files until recovery can determine whether IndexedDB references them; automatic age-based deletion would risk saved projects. Next recovery design must cover lost responses and restarts, not just persist a map.
- No code commit/push or paid calls. Playwright servers stopped after each run.


### Durable import transaction checkpoint
- Import records now persist under .artifacts/local-ai/import-transactions, using flushed temporary files and atomic rename. Startup reads bounded validated records without deleting malformed data. Pending/committed/rolledBack states survive service restart; repeated commit or rollback of the same completed operation is idempotent, and committed media cannot be rolled back.
- Each imported job records its transaction owner. Rollback validates all IDs, resolved parent paths, directory type and job ownership before deleting any folders. Changed ownership fails closed and preserves media; original source jobs never receive the import token.
- Validation: TypeScript and initial two archive tests passed; seven media/archive-orchestration tests passed after adding restart and ownership tests. Restart tests perform real filesystem imports and recreate the service repeatedly, verify media/source hashes, rollback pending media, retry finalized operations and preserve committed media. Local-worker test passed. All three browser backup tests passed: desktop/mobile persisted scenes/masks and independent-service actual video restore/correction. git diff --check passed.
- Reference coding: XERJ pendingImports returned unrelated/stale results; ref-opencut transaction had no match. Inspected current server/localAi.ts and server/mediaArchive.ts directly. Existing project metadata persistence was the local reference; atomic journal implementation is new, not copied from an upstream UI library.
- Scope limit: this closes restart recovery for a transaction whose token reached the caller. A crash before journal creation or loss of the import response can still leave unreferenced media without a client-held token. Client operation identity, replay/reconciliation and startup recovery remain required; no automatic deletion of potentially referenced media was introduced. No full recovery-complete claim.
- No push, paid model calls, or UI redesign. Browser test servers closed normally.


### Lost-response replay checkpoint
- Transactional media imports accept a client-generated operationId. Durable records retain a SHA-256 fingerprint of the submitted archives and original source-to-restored job mapping. Repeating the operation returns existing jobs/manifests, including after restart, rather than allocating new jobs. Changed content under the same operation is rejected; rolled-back operations cannot be revived.
- Client retries one failed import response with the same operation ID and payload. It publishes the project once after successful recovery. Existing storage-failure rollback and saved-project preservation behavior remains intact.
- Validation: TypeScript passed; 15 media/archive tests passed, including same IDs/manifests and unchanged directory inventory across restart/replay, changed-payload rejection, committed replay without rollback permission, and one project insert after a simulated lost response. All three desktop/mobile/independent-service video backup browser tests passed. git diff --check passed.
- Reference coding: XERJ restoreProjectArchive returned types rather than current orchestration; ref-opencut idempotency had no match. Read current localGeneration.localRequest, projectArchive and localAi transaction paths; no external implementation copied.
- Remaining interruption boundary: client operation ID currently lives for the restore call only. Closing/reloading the browser before recovery loses it, and a service crash before the completed import journal is written still lacks a recoverable allocation record. Durable client recovery and pre-allocation journaling remain open. No automatic orphan deletion added and no full interruption-recovery completion claim.
- No UI redesign, push or paid calls. Browser servers closed.


### Pre-write import allocation recovery checkpoint
- importLocalMedia now validates archives, allocates all destination IDs, and calls the durable prepare callback before creating folders. Transactional folders receive flushed importing ownership metadata before media bytes; completed jobs retain the token. Incomplete imported jobs are excluded from the usable job list after restart.
- Journal supports importing state. Matching operation retry first validates and removes only its owned partial folders (or its registered empty mkdir-only folder), then starts a fresh copy. Recovery leaves the original importing record until new preparation so a second interruption can retry again. Partial imports cannot be committed. Public commit/rollback is blocked while an import is writing.
- Validation: TypeScript and ten archive/orchestration tests passed. Added callback-order assertion and reconstructed persisted crash-state tests for empty-directory and partial-media boundaries. Both recover into hash-identical media while original hashes remain unchanged; incomplete jobs are not listed. These are deterministic recovery-state tests, not a physical power-loss or forced-process-kill test. Later six media tests, local-worker test and all three browser backup/independent-video restore tests passed. git diff --check passed.
- Reference coding: XERJ importLocalMedia returned localAi/localGeneration; ref-opencut recovery had no match. Inspected current importLocalMedia and durable journal functions. No upstream implementation copied.
- Remaining: browser close loses the client-held operation ID; durable client reconciliation is still required. Malformed ownership metadata fails closed and preserves files rather than guessing deletion rights. Abrupt filesystem/power-loss durability is not established by simulated crash states. Full audit and full uninterrupted browser rerun remain open. No push/paid calls/UI changes.


### Durable browser restore identity checkpoint
- IndexedDB now claims a stable operationId/projectId keyed by SHA-256 of the exact backup text before any import request. Re-selecting the same file after reload resumes its server operation, including pre-write server recovery, or reuses an already-published project and retries finalization. Successful finalization removes the recovery entry; storage/service errors preserve it.
- Web Locks serialize the same backup's recovery across tabs and release on page close. Browsers without Web Locks fail explicitly before import. No-media backups also retain project identity across a publication/finalization interruption. Existing projects/masks still publish atomically through insertRestoredProject.
- Validation: TypeScript and 16 archive/media/orchestration tests passed. Existing three desktop/mobile/independent-service video backup tests passed. New real IndexedDB browser test persists an operation, reloads before publication, injects finalization cleanup failure after project save, reloads again, and proves same project ID and exactly one restored project. First duplicate-count assertion omitted the existing restored-title suffix; corrected to count the actual restored title prefix. No implementation behavior was weakened.
- Reference coding: XERJ insertRestoredProject returned unrelated renderer results; ref-opencut indexedDB returned no match. Current projectStorage transaction implementation and projectArchive publication path were inspected and reused. No upstream UI components changed.
- Recovery is user-driven by selecting the exact same backup file again; no automatic restore starts on page load and the archive bytes are not duplicated into local storage. Tests establish deterministic interruption/reload behavior, not physical power-loss durability or simultaneous real browser shutdown during an actual media write. Full uninterrupted browser regression and broader audit requirements remain open.
- No commit/push or paid calls.


### Uninterrupted full regression checkpoint
- With code unchanged during verification and Playwright DISABLE_HMR=true, npm run check passed: TypeScript, 10 rendering tests, 1 local-worker test, 212 Vitest tests across 29 files, production build. Then all 69 Chrome tests passed in one uninterrupted 5.2-minute run. This supersedes the earlier 67/68 plus focused rerun evidence.
- Browser coverage includes actual cup/umbrella protected WebM, source-preserving corrected MP4 at desktop/mobile, actual narrated export, portable video restore into an independent service, persistent masks/projects, cross-tab conflicts/quota/malformed records, reload recovery identity, six camera motions, hidden-tab export rejection, responsive layouts and offline voice meter behavior. Fixtures/mock model responses remain distinct from live inference.
- Read-only hardware check: RTX 3050 Laptop, 4096 MiB VRAM, about 3528 MiB free at inspection. Installed SD1.5 manifest and Python environment present; F: approximately 346 MB free and C: approximately 16.5 GB free. Existing motion offload cache is present. No new GPU inference in this checkpoint; assess bounded reuse before running it.
- Read-only copy audit found ShotInspectorPanel still presents live-sourced saved masks as LIVE and uses default 0.95 confidence / IoU wording. This remains a concrete follow-up; do not treat the passing suite as proof those claims are accurate. Semantic evaluator limits and representative end-to-end model quality still require resolution/evidence.
- No files edited during test execution. No push or paid calls. Test servers stopped normally.


### Mask provenance copy and fresh GPU image checkpoint
- Existing Mask details markup now labels SAM RESPONSE or SAVED SAM MASK (detached), never LIVE solely from saved provenance. Actual returned providerConfidence is retained separately from legacy/default confidence. Missing/invalid provider scores are unavailable; scores are not presented as measured IoU/accuracy. Offline samples remain explicit fixtures. Removed fabricated 72.4% IoU sample wording and numeric low-confidence ambiguity wording.
- Validation: TypeScript, 14 mask-evidence/studio tests and manual SAM browser test passed, including actual 90% provider-score display. Final spoken wording typecheck passed; diff check passed. Consulted ui-skills-root/fixing-accessibility and searched all four required UI corpora for Badge; inspected shadcn badge source at b8d7baa15b1dca5716f13153e63795fc3d741f6b. No upstream block copied or layout/animation changed; reused existing details markup.
- Fresh local image inference completed on RTX 3050 Laptop with installed SD1.5 weights, 256x256, seed42, 20 steps, sequential CPU offload. Denoiser outputs observed on cuda:0 (21 forwards); 19.324 seconds inference, 744.83 MiB peak allocated / 768 MiB reserved. No downloads or paid API calls; worker local_files_only and HF offline. Output on C: to conserve F: space.
- Output folder: C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-audit-gpu-image. Actual generated-image.png inspected: strong horizontal bands and repeated abstract shapes, no recognizable blue cup/kitchen/ocean composition. Visual quality FAIL despite technical_pass/nonblank report. Do not claim the generation use case works from this CUDA proof. Investigate native model resolution/loading before scaling or spending.
- Original inference-report.json preserved; separate visual-review.json records the failed review. Fresh video inference and real generation-to-app end-to-end proof remain open, as do semantic evaluators. No push.


### Fresh GPU image resolution comparison
- Repeated the identical prompt/seed42/20-step/sequential-offload image run at 512x512 (the VAE config sample_size and app default), without model downloads or paid calls. Compared every installed SD1.5 file against download-manifest.json: 16 files, zero SHA-256/size mismatches. This verifies recorded local integrity, not an independent remote authenticity audit.
- 512 result: technical_pass, 19.852 seconds inference, 1201.09 MiB peak allocated / 1212 MiB reserved, 21 CUDA denoiser forwards. Output C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-audit-gpu-image-512.
- Actual image inspected: coherent kitchen/window/counter, blue lidded pot/kettle plus blue circular object on wall; no recognizable ocean/open doorway. Unlike the 256 image, no abstract horizontal banding. Review is partial prompt adherence, productionReady=false. A single same-seed comparison supports resolution sensitivity for this prompt, not universal 256 failure or guaranteed 512 quality.
- Application default was already 512, so no arbitrary product-code change was made from the deliberately smaller CLI test. Source conversion saves the pipeline PIL RGB output directly; no postprocessing corruption found. Original reports preserved with separate visual-review.json. Fresh local inference is now proven, but reliable intended object/world composition, fresh video and generation through actual app remain unproven.
- No commit/push or paid usage. This checkpoint is evidence that changes the next debugging step, not overall completion.


### Real app-to-GPU image integration proof
- Ran actual browser UI against a temporary loopback Vite server with model/cloud provider environment settings cleared. Created sample storyboard, selected Shot2, opened existing Local GPU generation controls, entered a blue-mug/window prompt, clicked Generate image, waited for the actual Python/CUDA worker, clicked Use image in Shot2, reloaded and verified saved state. No model API stubs were used for generation; browser external HTTP requests were blocked and none occurred.
- Job ac4017ff-3dbe-4b9e-83ce-688c500840dc completed at 512x512, seed42, 20 steps, 23.351 seconds inference, 1201.09 MiB peak allocated, CUDA denoiser tensors. Only Shot2's image changed; other three original images retained; applied shot status uncertain after refresh. Evidence JSON and screenshot: C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-real-app-image. Actual media stays in .artifacts/local-ai/ui-jobs/ac4017ff-3dbe-4b9e-83ce-688c500840dc.
- Generated image and app screenshot inspected: recognizable blue open mug/handle and sunlit wooden window surface. Background is blurred/noisy and clear ocean waves are not evident. Partial prompt adherence, productionReady=false; actual integration works for this case, not a general semantic-quality guarantee.
- First harness attempt used a relative APIRequestContext URL without baseURL, failed before completing proof, and cleanup cancelled job e3651af6-c0aa-4f53-9ae6-c428d648362e. Verified cancelled metadata and no remaining inference process before retry. Corrected harness baseURL, successful second run, browser/server closed in finally. No production source change was needed for this integration test.
- Fresh actual app video generation and a representative generated-media dream/continuity demo remain open. Read-back also shows Sample storyboard badge on the mixed sample/generated film; provenance copy should distinguish the active real image. No paid calls or push.


### Fresh local CUDA video checkpoint
- Executed the existing offline video worker at 512x512, seed 42, default mug/window/ocean prompt, four AnimateDiff-Lightning steps, 16 frames. No source/model edits, new downloads or paid calls. Validated all 1,253 offload cache entries against index shape/dtype/file sizes before execution. Installed Accelerate disk_offload reuses the existing index instead of rewriting weights. This is file-size integrity, not a fresh weight-content hash verification.
- RTX 3050 Laptop 4 GB: 69.313 seconds inference; 664.4 MiB peak allocated / 672 MiB reserved CUDA memory; four observed CUDA denoiser forwards. H.264 MP4 is 512x512, 8 fps, 2 seconds, 16 decoded frames. Full decode succeeded; encoding MAE 2.7367/255 and PSNR 36.99 dB relative to generated PNGs. These measurements concern execution and encoding, not semantic correctness.
- Inspected all 16 frames in all-frames.png: recognizable blue mug and wooden window surface, but an extra right-side handle-like shape, no clear ocean waves, largely static composition and varying lighting/texture. Partial prompt adherence; productionReady=false. Unique frames are not proof of the requested camera motion or a dream morph. No kitchen-to-ocean transition or protected mask was applied in this run.
- Evidence: C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-audit-gpu-video contains inference-report.json, visual-review.json, all-frames.png, original frame PNGs, GIF and generated-video.mp4. Kept inference-report.json unchanged; visual review is a separate record. Worker exited successfully.
- Actual app video generation/application/persistence and representative generated-media protected-transition demo remain open. No server was started for this CLI proof, and no commit/push was made.


### Actual app video and current-scene provenance checkpoint
- Fresh real app-triggered job 00d86c39-00bd-4226-ada9-bfaa11fec4ce completed at 512x512, 16 frames / 2 seconds, 60.874 seconds CUDA inference, 664.4 MiB peak allocated. Temporary Vite 4331 used explicit empty paid-provider settings; browser recorded zero external HTTP requests. No model/worker mocks or paid calls.
- Applied through Use video in Shot 2. Browser video advanced to 0.6649 seconds with 512x512 decoded dimensions and no media error. Refreshed and verified identical project ID, selected video URL retained, status uncertain and other three complete scene objects unchanged. Browser and temporary server closed in finally. First harness attempt used nonexistent storage helper names and exited before generation; corrected to actual flushLocalSaves/loadLocal APIs, not a product defect.
- All 16 generated frame PNG SHA256 values match the previous visually inspected CLI run. Its extra handle-like shape, missing ocean and lighting/texture variations therefore apply here too; productionReady=false. Evidence in C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-real-app-video: result.json, visual-review.json, applied-after-refresh.png. Corrected-label screenshots are a later UI read-back and did not regenerate media.
- Replaced revision-message-based Sample storyboard badge with current-scene provenance: Generated scene, Sample scene or neutral Scene media for unclassified legacy data. New sample/live scenes and their initial takes now store explicit provenance. Restoring an unclassified legacy take no longer inherits generated provenance from the previously selected take. Existing generated asset URLs remain recognized. Removed redundant green AI VIDEO PREVIEW badge; retained existing monochrome span/styles. Removed mobile rule hiding the provenance badge.
- Offline sample initial history no longer claims Muse generation; spoken sample descriptions no longer claim 72.4% measured confidence or verified live continuity. No inferred quality claims added.
- TypeScript passes; 14 focused studio/mask tests pass; video apply/take/refresh browser regression passes, including explicit sample provenance on restored Take 1 and generated badge visible at 390x844. Final CSS-only visibility adjustment was verified by that browser rerun. This is not another full-suite run.
- Reference coding: XERJ anchorshot mediaSource returned stale unrelated results; direct current source governed decisions. Queried ref-prompt-kit Badge, ref-shadcn-ui Badge, ref-motion text, ref-beui Badge. Read shadcn-ui b8d7baa15b1dca5716f13153e63795fc3d741f6b apps/v4/registry/new-york-v4/ui/badge.tsx:28-49 (semantic span) and beui b0031261cd40d55b42a027c22721d3e994106e6f lib/component-status.ts:1-34 (explicit metadata-driven badges). Kept existing span markup rather than importing a new block or release-date badge logic; no upstream component/style copied. Existing index remains stale under disk safeguard.
- Remaining: representative generated-media protected dream transition, semantic/spatial/identity evaluator gaps, final dead-path/copy audit and broader acceptance evidence. No commit/push.


### Generated-image cup through the actual dream workflow
- Uploaded the fresh locally generated image from job ac4017ff-3dbe-4b9e-83ce-688c500840dc through Upload cup photo. Traced the actual visible cup outline using pointer input, erased part of the handle opening, and applied it through Apply cup to dream. Added the independent authored umbrella sample mask through its own editor. No sample cup mask, injected segmentation result or model call was used.
- Actual UI Check both objects reports 289 uncompressed frames, zero changed protected pixels for cup (26,826 pixels) and umbrella (18,177 pixels), render p95 5.8 ms on this run. Saved both masks, first/last PNGs, quality report and 12-second WebM. Reloaded and compared the complete two mask arrays and project ID; identical. No POST requests occurred. Browser and temporary Vite 4331 server closed in finally.
- Independent Python/FFmpeg read-back: 800x450 VP9, 11.997920 seconds, 274 encoded frames (variable-rate capture, not the 289 compositor verification samples). Fully decoded and measured every encoded frame. Cup mean encoded channel error 2.6118/255, worst frame mean 2.9132; umbrella 2.8624/255, worst frame mean 2.9675. Endpoint PNG selected pixels match exactly, masks do not overlap, and unprotected environment changes. Lossy video is not pixel-exact.
- Visual review of first/last PNGs exposes quality limits: hand-traced contour retains some background; discrete erase clicks leave a scalloped handle opening; cup and umbrella float at fixed placements without physical contact/shadow. Protection works for the selected pixels, but mask accuracy and cinematic realism are not established. productionReady=false. This is a representative generated-cup integration proof, not a claim of finished visual quality.
- Corrected initial background description: shipped kitchen/ocean are pre-generated local SD1.5 images, not authored illustrations. Verified both current file hashes against public/dream/provenance.json. The umbrella is authored, and transition motion remains a deterministic ripple/reveal, not neural morphing or video-to-video generation.
- Evidence: C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-generated-cup-dream contains cup-selection.png, cup.png, umbrella.png, first.png, last.png, quality.json, dream.webm, workflow.json, independent-check.json. No production code edits in this checkpoint, no paid calls, no push.
- Next quality work should address precise hole/contour correction and scene placement rather than treating zero drift as a segmentation or realism score. Semantic/spatial evaluator and full completion gaps remain open.


### Precise subtractive hole correction
- Added Trace hole alongside the existing trace/add/erase tools in CupMaskEditor. Closing its polygon subtracts only pixels inside that outline from the current mask, preserving all other selected pixels. Initial outline still replaces the mask as before. Pointer and Space/Enter keyboard paths support the new mode; pending outlines prevent Apply. Undo restores the complete prior mask. Empty masks cannot start hole tracing. Existing styles/layout and independent object state retained; no new library or model dependency.
- Added desktop 1440px and mobile 390px browser regressions checking every preview pixel: subtraction stays inside the traced hole, unchanged pixels retain every channel, pending selection cannot apply, Enter closes, and Undo restores exact bytes. First attempt used one matcher per channel and was too expensive; identified and terminated only that test runner tree, then replaced matcher overhead with exhaustive aggregated comparison. No reduced pixel coverage.
- TypeScript passed. Both new tests passed (32.2 seconds); then all four twoAnchors browser tests passed together (59.8 seconds), including original independent cup/umbrella correction, actual export, empty-mask rejection and mobile keyboard handling. Servers closed normally.
- Exercised the tool on the actual locally generated cup from ac4017ff-3dbe-4b9e-83ce-688c500840dc. Traced the handle interior instead of separate eraser clicks. Exported a new two-object demo and inspected the final PNG: continuous hole shows ocean through the handle, removing the prior scalloped artifacts. Hard contour edges and fixed floating placement remain; no cinematic-readiness claim.
- Protection report: 289 raw frames, zero changed selected pixels; cup 24,637 pixels, umbrella 18,177. Independently decoded all 274 variable-rate VP9 frames. Exact endpoint PNG masks match; mean encoded error is 2.4324/255 for cup and 2.8653/255 for umbrella. Raw protection and lossy encoded error remain separate.
- Evidence folder: C:/Users/sunny/.codex/visualizations/2026/10/27/01a17e1a-b49b-7b61-a596-5f0c77661693/anchorshot-generated-cup-dream/precise-hole (editor.png, first.png, last.png, cup.png, umbrella.png, quality.json, dream.webm, independent-check.json). No paid calls or new generation.
- Reference coding: XERJ anchorshot polygonMask located existing scanline polygon fill; reused it for deterministic subtraction. ref-sam2 add_new_points_or_box pointed to sam2/sam2_video_predictor.py:162-198 at 2b90b9f5ceec907a1c18123530e92e794ad901a4; inspected per-object/frame correction identity, no SAM code copied. Queried required ref-prompt-kit Button, ref-shadcn-ui ToggleGroup, ref-motion button, ref-beui Toggle. Read shadcn-ui b8d7baa15b1dca5716f13153e63795fc3d741f6b apps/v4/registry/new-york-v4/ui/toggle-group.tsx:20-48. Retained the existing native aria-pressed buttons instead of replacing the tool strip or adding animation. No new upstream block copied; existing index is stale under disk safeguard.
- Goal remains active: placement/compositing quality, semantic/spatial evaluation and final full audit acceptance are unfinished. No commit or push.


### Restore masks must be renderable
- Reproduced a concrete trust-boundary mismatch: validateSavedRecord accepted an empty binary dream selection even though applyCupSelection rejects fewer than 16 selected fully opaque photo pixels. Transparent or 15-pixel selections similarly passed backup validation, then failed when opening the restored dream study. The regression failed against the old implementation before the fix.
- Saved dream selection validation now requires the same >=16 fully opaque selected pixels as the compositor, in addition to existing typed-array/dimension/binary checks. Null selections remain supported. Validation occurs before reserve/import/publication. Existing damaged records are rejected and retained, not normalized or overwritten.
- New tests cover empty, transparent, 15-pixel and partly transparent masks, exact input preservation, valid minimum masks for both objects, and absent selections. Restore orchestration test proves malformed mask input performs no flush, operation reservation, media request, insertion or finalization.
- Updated previously unrealistic 1-pixel persistence test fixtures to renderable 16+ pixel masks, retaining distinct cup/umbrella patterns, exact RGBA comparisons, stale-tab conflicts and atomic quota failure assertions. This strengthens acceptance evidence rather than changing renderer requirements.
- Validation: 19 focused unit tests passed initially; 7 focused tests passed after adding the no-side-effects case (overlapping counts). All four portable backup browser tests passed (40.4 seconds), including independent service video restoration and interrupted recovery identity. All six storageSafety browser tests passed (22.2 seconds), including preserved corrupt records, quota recovery, cross-tab conflicts and atomic insertion.
- Full npm run check initially caught a previous copy-edit regression: the measured-color success branch had inadvertently been changed to Offline sample wording. Corrected only that branch to Color check passed: the selected object pixels match the measured expected color. Sample initialization retains its explicit sample label. Updated the existing semantic assertion to require the measured-color description and reject Offline sample; unmeasured results cannot claim a pass.
- Final npm run check passes: TypeScript, 10 rendering tests, 1 local-worker test, 218 Vitest tests in 31 files and production build. Largest App chunk 451.47 kB. This is a code/build check plus the 10 focused browser tests above, not a new uninterrupted full-browser run.
- Reference coding: XERJ validateSavedRecord returned stale mask-related hits; direct projectStorage/archive/compositor source controlled the invariant. ref-sam2 add_new_mask led to sam2/sam2_video_predictor.py:301-332 at 2b90b9f5ceec907a1c18123530e92e794ad901a4; inspected shape validation, deliberately did not copy resampling/thresholding because user mask bytes must be retained exactly. XERJ auditShotContinuity returned stale storyboard source; inspected the actual measured-color branch before correction. No UI layout or upstream code copied. No paid calls or push. Goal remains active.


### Dream export interruption and resource cleanup
- Source audit found dream capture lacked a hidden-at-start guard and cleanup for MediaRecorder construction/start or frame/progress exceptions. Native early stop could resolve a partial video; a missing stop event could leave the promise pending. Unified settlement now clears capture/stop timers, removes listeners and stops every capture track for success and failure. Empty output and unexpected early stop reject. Already-aborted/hidden starts reject before allocating a stream.
- During capture, a gap exceeding two seconds rejects rather than exporting a time-jumped partial transition. The threshold is a practical interruption guard, not a guarantee of constant frame rate or detection of every smaller dropped-frame interval. Stop acknowledgement is bounded to five seconds; the stream is closed if no event arrives. A callback that aborts cannot schedule further capture work.
- Validation: TypeScript and diff whitespace checks pass. All 12 dream browser tests pass together (38.2 seconds): original real export/cancel/preservation, mobile/reduced-motion, missing assets, plus hidden start, prior cancellation, injected constructor/start/progress failures, hidden during capture, simulated clock gap, unexpected early stop and missing stop event. Failure cases return no Blob and every allocated MediaStreamTrack ends. Hidden/clock tests simulate browser conditions; no physical OS suspend was performed.
- Reference coding: XERJ anchorshot exportDream located the prior implementation; current source and adjacent canvasEngine.ts:827-860 cleanup were read directly. ref-opencut export returned unrelated routing/use-mobile results; inspected apps/web/src/hooks/use-mobile.ts at e668010778568641babef2cc40be4703ae6916d6 and rejected it as irrelevant to recording. No upstream code copied. Existing index remains stale under the storage safeguard.
- Test servers closed normally. No UI redesign, paid calls, generation, commit or push. Full audit remains active.


### Film fallback recorder parity
- Applied the same failure audit to canvasEngine browser film export. Constructor exceptions previously leaked capture tracks; unexpected recorder stop could return a partial film; canvas draw/timer exceptions could escape without settling the export. Constructor cleanup and unified finish now stop recorder/tracks, detach recorder/visibility callbacks and clear every timer. Unexpected stop is rejected unless all scene durations completed. Frame setup and interval rendering failures reject through cleanup.
- Added a two-second capture-gap guard before drawing and advancing scenes, preventing a long browser stall from yielding a time-jumped partial film. As with the dream guard, this is a bounded interruption check, not proof of constant frame rate or physical OS suspend handling. Existing total-duration watchdog remains active.
- TypeScript passed. All 14 exportFallback Chrome tests passed (23.7 seconds): six real camera-movement exports decoded with FFmpeg, ordered multi-scene holds, hidden interruption/retry, preview visibility pause, and five new actual recorder tests for injected constructor/start failure, unexpected early stop, draw failure and simulated clock gap. Each new failure yields no Blob and every allocated track ends.
- XERJ anchorshot exportAnimaticWebm returned the correct canvasEngine module under its actual exportStoryboardAnimaticVideo symbol; current source read directly. ref-opencut MediaRecorder returned unrelated empty/item UI snippets, so no peer implementation was copied. Current dream exporter lifecycle served as the adjacent implementation reference. No UI changes, paid calls, generation, push or commit. Test server closed. Full audit remains active.


### Full regression after correction and export lifecycle fixes
- Ran all browser tests against an unchanged worktree with test-only HMR disabled: 85/85 Chrome tests passed in one uninterrupted 5.9-minute run. This supersedes the prior complete 69-test browser result. No source or documentation writes occurred while this run was active.
- Coverage includes desktop/mobile actual corrected MP4 and audible narration exports, six camera movements and decoded scene holds, two protected objects, exact hole subtraction/undo, backup into a separate service, conflict/quota/restore recovery, route loading, keyboard/dialog/tour behavior and offline voice-meter privacy. Model responses in this suite remain fixtures; separate fresh CUDA image/video checkpoints provide actual inference evidence.
- Afterwards updated README claims against current source/evidence: removed unverified entirely-by-voice and complete screen-reader promises, universal provider compatibility claims, and the incorrect silent-only MP4 description. Explained typed offline input, local metering, configured transcription, narration-capable MP4 and the distinction between pixel containment and semantic/visual correctness. No new provider capability claims or paid verification.
- Broad goal remains incomplete: general semantic/spatial/character evaluation, physical screen-reader/microphone walkthrough, live paid-provider evidence (not authorized) and cinematic placement/quality are not proven by this suite. Test server closed normally. No push or commit.


### Reviewed video command connection

Replaced the App video-command call to the retired `/modify` route with the existing `/frames` + `/correct` workflow. A command selects only its named cup (including mug alias) or umbrella track, requires source-bound reviewed masks for every frame, and creates a new take. The original saved plan is not mutated. Applying a result also checks the expected source job so a replacement source is not overwritten.

Verification: `npx vitest run tests/videoTracking.test.ts` passed 5/5; `npx tsc --noEmit` passed. The new command integration test executes the real local correction endpoint on the five-frame fixture including cup absence/re-entry, checks purple correction, and exhaustively compares all raw pixels outside the cup mask (including the umbrella). Unsupported objects/colors, missing plans, stale fingerprints and unreviewed frames cannot POST correction. These are local deterministic correction tests, not live voice recognition or semantic tracking proof. App-level command dispatch and project-switch race behavior remain to be verified; previous 85-browser-test result predates this connection.

Reference coding: XERJ `anchorshot` query `correctReviewedVideo` returned stale/unrelated results; inspected current `src/services/videoTracking.ts` directly. XERJ `ref-sam2` query `_obj_id_to_idx` returned `sam2/sam2_video_predictor.py:118`; inspected lines 118-145 at pin `2b90b9f5ceec907a1c18123530e92e794ad901a4`. Retained explicit per-object identity and independent tracks; did not copy predictor code or treat SAM2 as gateway/API proof. Initial restricted lookup could not see the installed index tool; approved local lookup succeeded. No index refresh or paid calls.


### Explicit video intent and browser command proof

Removed the parser's implicit emerald recolor for `track video cup` and incomplete video edit commands. Video recoloring now requires a complete single-object/color command; tracking and malformed/compound directives return guidance without falling through to rebuilding the film. Narrative text containing a video command is not executed as that command. A stale video result now leaves the entire project state unchanged, including its success announcement, when the expected source job no longer matches.

Verification: 29/29 focused Vitest tests (voice command parser and actual local video correction), TypeScript, and 3/3 Chrome browser mask-review tests passed. Browser command test draws and approves cup/umbrella masks, proves tracking leaves scenes unchanged, submits only the purple cup track through typed input, holds the response to verify New project and Switch project are disabled, then confirms the corrected take and original-mask restoration. Existing direct correction and project-switch cancellation tests also pass. Browser correction response is intercepted; actual encoder/pixel protection is covered separately by the local service integration tests. No live ASR or paid calls. Broad 85-test browser result still predates these changes; latest focused browser count is three.

XERJ queries: `anchorshot:parseVoiceCommand` returned stale references; inspected current parser and App dispatch directly. `ref-sam2:_obj_id_to_idx` again returned predictor line118 at the previously recorded pin; kept explicit per-object identity and rejected conflating tracking with recoloring. No UI markup/library changes in this checkpoint.

Next verified finding: `MetaModelClient.editFrameGenerative` has no fetch timeout/abort signal; its App completion handler also needs source/project-bound result handling. This remains uncorrected and must be tested, not inferred from the video command checks.


### Generative-edit request lifecycle

Client generative editing now composes caller cancellation with a 120-second deadline, checks pre-aborted requests before fetch, and aborts on App unmount. App rejects concurrent edits and missing scene targets rather than returning a false success. Completion compares project, shot, source image/job, revision count and mask reference before applying; the state updater repeats the source check. Failure/finalization updates are project-bound. New generative takes explicitly retain generated provenance, and history reports returned outside-pixel counts instead of an unconditional zero-drift claim.

Verification: TypeScript passed; 32/32 tests across `generativeEditRequest`, `studio`, and `api` passed. New request tests cover pre-cancelled zero-request behavior, stalled fetch cancellation by caller and deadline, provider error propagation, and successful retry. Deadline event is injected via AbortSignal.timeout spy rather than waiting two minutes. No model requests. App-level late-response and unmount behavior still require browser proof; client tests alone do not establish those.

Reference coding: XERJ `anchorshot:editFrameGenerative` returned stale unrelated session/frame results; inspected current App, MetaModelClient and server edit-frame route directly. XERJ `ref-opencut:AbortController` returned unrelated form results; direct source search found no AbortController match in that checkout, so no upstream implementation was copied. This is a request-lifecycle fix with no UI/library changes. Previous note identifying the missing timeout is superseded by this checkpoint; completion of the full audit remains unproven.


### Generative command browser failure and retry

Browser test reproduced an unhandled promise rejection from a failed typed generative command, even though its error message and scene preservation worked. The command dispatch now consumes the rejected edit and announces the error; inspector callers still receive rejections for their own failure notices. No UI markup changed.

The exact initially failing Chrome test now passes: intercepted 501 leaves all four scene objects unchanged and unlocks New project; retry holds its response, verifies project controls lock, selects a different scene, then applies the returned image only to the originally requested Shot 2 with generated provenance and uncertain continuity. All other scene objects remain identical, and no page errors occur. This verifies selection changes during a pending request, not arbitrary source replacement or real provider quality. App-unmount cancellation still has only implementation/request-level evidence.

Full `npm run check` passed after these repairs: TypeScript, 10 rendering tests, 1 local-worker test, 230 Vitest tests in 32 files, and production build (largest App chunk 455.03 kB). Full browser suite has not yet been rerun after these changes; the new generative test passed individually.

Reference: XERJ `anchorshot:handleGenerativeEdit` returned broad App/composer/session references; inspected current dispatcher and composer callback. `ref-prompt-kit:handleSubmit` located `components/blocks/conversation-prompt-input.tsx:75`; read lines75-99 at pin `5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a`. Rejected its simulated timeout/response as unsuitable for real failure handling; no code copied. No paid calls, commit, or push.


### Complete browser regression after command and request repairs

`PLAYWRIGHT_CHANNEL=chrome npx playwright test --workers=1`: 87/87 passed in 6.0 minutes, exit 0. Covered corrected MP4s at desktop/mobile sizes, exported narration, late region responses, video commands, generative failure/retry, source preservation, backups into a separate service, masks, storage conflicts/quota/corruption, viewport fit and offline voice overlay. Provider configuration was empty on isolated port4327. The test server stopped afterward. This supersedes the 85-test browser result, not the stated remaining semantic/model-quality/accessibility gaps.

Read-only follow-up found another lifecycle candidate: `understandVideoWithMuseSpark` fetch lacks timeout/caller cancellation, and `handleAnalyzeVideoContinuity` applies returned findings without explicit project/source binding. Needs a targeted delayed-response/failure test and fix; no source changes were made during regression. Generative App-unmount cancellation remains without dedicated browser proof.


### Saved-video review lifecycle and finding scope

The local video-review fetch now has a 30-second deadline, caller cancellation and a pre-abort check. App owns and cancels its request on unmount, prevents duplicate reviews, and checks project, source job/video/poster, rule snapshot and shot position before applying results. Findings for other shot indexes are ignored because this request only reviewed one source. Failure/finalization is project-bound. This does not add semantic video understanding; evidence remains unverified where no evaluator exists.

Validation: 7/7 focused request and video-findings tests passed; new Chrome browser test passed. Browser response first fails with503, proves controls unlock, retries with a delayed result and verifies project switching is disabled while pending. Response includes a finding for another scene; only the requested scene receives the review, other scene objects remain identical, video source is retained, and no page errors occur. Request deadline is injected in a unit test rather than sleeping30seconds. Actual source replacement/rule mutation during a pending request and unmount still need direct lifecycle proof; current guards are source-reviewed. The 87-test full browser run predates this checkpoint.

XERJ `anchorshot:understandVideoWithMuseSpark` returned broad/stale paths; inspected current client, App and server route. `ref-sam2:_obj_id_to_idx` returned predictor118 at previously recorded pin2b90b9f5ceec907a1c18123530e92e794ad901a4; applied its explicit identity separation concept, without copying predictor code. No UI markup, paid requests, commit or push.


### Direct React-unmount request proof

Two new Chrome browser tests passed for generative editing and saved-video review. Test-only interception of the Vite entry module exposes the existing React root's unmount action; production code has no test hook. Each test starts the operation through the actual UI, holds its HTTP response, unmounts the root while the document remains alive, observes the fetch signal abort, releases the delayed response, drains the application's storage queue and compares every saved scene against its pre-request value. No page errors occurred. This specifically proves React cleanup, rather than relying on browser navigation to cancel requests. TypeScript and whitespace checks passed.

These tests close the prior dedicated unmount-proof gaps for both requests. They do not establish arbitrary source/rule mutation during a pending request or live provider response quality. The full 87-test regression predates the later video-review changes; two focused lifecycle tests passed in9.7seconds.

Reference coding: XERJ anchorshot query `generativeEditRequest` returned stale session results, so current App/main and browser tests were read directly. `ref-prompt-kit:useEffect` returned `components/prompt-kit/response-stream.tsx`; inspected lines200-223 at pin5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a (controller plus asynchronous abort gate). Used as cleanup comparison, no upstream code copied. No paid calls, UI changes, commit or push.


### Generative edits enforce source-bound, confirmed masks

Found a real policy mismatch between editing paths: recoloring rejected generated-frame sample masks and ambiguous selections, but generative editing accepted any supplied raster. App generative edits now reject masks whose source URL is absent/different, reject offline sample masks on generated media, and require candidate disambiguation before sending a request. Errors retain the existing scenes and release processing controls. Restored masks with an explicit matching source remain eligible locally; no new live segmentation claim is made.

Five Chrome tests passed in20.5seconds: stale source, missing source, sample-on-generated and ambiguous masks each produced zero edit-frame requests with unchanged saved scenes; the existing valid-mask failure/retry flow still passed. Tests mutate a saved project through the real persistence API and reload it before submitting through the UI. This proves no provider request is made for those cases. No paid calls.

Reference coding: XERJ `anchorshot:sourceImageUrl` located canvas correction; inspected current metaModels recolor/disambiguation guards, App edit handler, mask types and persistence validation. XERJ `ref-sam2:add_new_mask` found `sam2/sam2_video_predictor.py:301`; read301-328 at pin2b90b9f5ceec907a1c18123530e92e794ad901a4. Retained explicit source/frame/object association; did not copy predictor resizing, because local editing requires exact frame/mask dimensions. No UI markup copied or changed. Full audit remains active; broad87-test run predates these later repairs.


### Recoloring honors explicit mask source on every still

Found that applyContinuityFix checked a saved mask's source URL only when isGeneratedShot was true. A sample/restored still with an explicitly stale mask could therefore recolor the wrong region. The guard now matches existing disambiguation behavior: any explicit source mismatch rejects, while generated media still requires an explicit matching source and real mask provenance. Legacy source-less authored sample masks retain their existing sample-only compatibility; generated-frame protections are unchanged.

21/21 focused studio and frame-audit tests plus TypeScript passed. New regression covers both offline and saved-live mask provenance on a sample still, confirms the entire input object remains unchanged, and spies on pixel correction and segmentation to prove neither starts. XERJ anchorshot query applyContinuityFix and ref-sam2 add_new_mask were used; current client guards were authoritative. Same SAM2 source301-328/pin as preceding checkpoint supplies frame/object identity comparison, no code copied. No paid requests or push. Broader audit remains open.


### Candidate confirmation cannot overwrite a later scene/project

Found that handleDisambiguateShot awaited network confirmation without busy state or source/project ownership checks, then replaced a shot by ID. It now cancels superseded confirmations, aborts on project change/unmount, checks that the exact original shot state is still current, and only applies that selection to the originating project. A changed scene prompts re-confirmation. Service health and disambiguation calls share a30-second deadline/caller signal; abort is checked before returning a raster.

21 focused tests and two Chrome tests passed: normal selection retains distinct candidate rasters; held confirmation followed by New project aborts the request and neither new nor old project receives the late candidate. Existing server-restart test's exact fetch-argument expectation was updated to include the new signal after it failed; its one-request and retained-raster assertions remain. TypeScript had passed implementation check. XERJ anchorshot disambiguateMaskSelection returned an older implementation; current source used. ref-sam2 _obj_id_to_idx at recorded pin/path118 remains identity reference, no copied implementation. No paid calls/push. Full audit remains active.


### Correction reports use the corrected object's color-rule revision

Browser reproduction seeded a spatial rule at revision99 before the cup color rule at revision7, then submitted `recolor cup in shot 2 to purple`. The saved color rule correctly became8 but the correction report incorrectly recorded100. The command now derives the increment from the matching targetObject/color rule, using0 for a new rule, rather than the first rule in the list.

The originally failing Chrome test now passes: report and rule both record8, and the other three images remain unchanged. XERJ anchorshot ruleRevision returned report/store references; current App rule update and command code were inspected. ref-sam2 _obj_id_to_idx at previously recorded pin/path118 informs per-object separation; no copied source. This is report identity correctness, not new semantic verification. No paid calls or pushes.


### Explicit scene references cannot fall back to the active shot

The voice/text parser recognized only numeric1-8, so `fix shot 10` lost its explicit target and could correct the current mismatch instead. Numeric scene references are now preserved for App existence validation, spoken cardinal/ordinal forms extend through12, and malformed/non-positive/fractional references in mutation commands return guidance without rebuilding or editing. This does not expand planner scene counts.

34 parser tests, TypeScript and a new Chrome test passed. Browser commands for shot10, shot99, shot0 and scene2.5 leave every saved scene and rule unchanged and show the appropriate missing/invalid-target notice. XERJ anchorshot shotNumberIn missed current implementation; current parser and App existence guard were read directly. ref-sam2 add_new_mask301 at previously recorded pin/path supplied explicit frame identity reference; no code copied. No paid requests, commit or push. Audit remains active.


### Generated-frame segmentation command reaches the working handler

Removed the obsolete isLocalImage early rejection from the segment voice/text intent. The command now calls the same handleSegmentObjectManual path as Review, which sends the selected frame/hash when configured and rejects authored sample masks on generated sources when offline. This connects an existing capability; it does not enable providers or spend credits.

Two Chrome tests passed: typed `segment cup in shot 2` on local generated media sends image bytes/source hash to an intercepted adapter, retains both distinct candidate rasters and confirms the chosen object; with provider configuration empty, the same command sends zero segment/check requests, reports unavailable real segmentation, unlocks controls and leaves saved scenes unchanged. This is adapter/dispatch proof, not live SAM inference quality.

Reference queries anchorshot handleSegmentObjectManual (stale previous guard found) and ref-sam2 add_new_mask301 at the recorded pin; current handler/service source controlled the edit, no copied code. Remaining nearby review: still-image recoloring on a video-backed shot must have explicit media semantics before removing its separate command guard. No UI changes, paid calls, commit or push.


### Frame recolor clears incompatible video state and preserves takes

applyContinuityFix already clears videoUrl/generatedJobId because a pixel recolor corrects a still, not every video frame. It left videoMaskPlan attached to the removed job, causing the saved-library validator to reject the result, and retained stale detected regions/source offset. Corrected stills now clear videoMaskPlan, detectedObjects and timestamp; their new take explicitly records sample/generated provenance. Historical video takes are unchanged and remain restorable with their masks/source offset.

22 focused studio/frame tests passed, TypeScript passed; strengthened frame suite then passed10/10. New test mocks only canvas correction/measurement, calls actual model-client state transformation, restores original video and corrected still via actual take logic, and checks all four states (original, correction, restored video, restored still) through JSON round-trip and actual validateProjectLibrary. Input and historical take remain unchanged. Actual browser save/export after frame correction is still a follow-up, not proved by schema validation alone.

XERJ anchorshot applyContinuityFix returned stale code, current method/shotEdits/persistence validator inspected. ref-opencut mediaId returned unrelated UI hits; no useful upstream media-state implementation or copied code. Explicit source/take separation follows existing local restoration contract. No paid calls/push; audit active.


### Browser video-to-still persistence and real export

Added actual browser coverage for the preceding video-frame fix. With intercepted SAM candidates, the user confirms a mask, retains a saved per-frame video plan, recolors the frame, reloads, restores video Take2 with its exact mask plan, then restores corrected still Take3. Preview changes between video and image correctly and generated provenance persists. A real MP4 download contains the corrected still payload and no old video source, fully decodes with FFmpeg and matches the requested14.5-second sequence.

The first export test failed at14.6seconds. Inspection showed looped still and timecode inputs used FFmpeg's default25fps while output uses30fps. Both still-input argument lists now specify30fps. The identical duration assertion then passed (browser test13.9seconds total);11 animatic tests passed, covering moving clips/audio/timecode. TypeScript passed. This is deterministic fixture/export proof, not live SAM quality. Existing XERJ source/take queries from preceding checkpoint plus anchorshot renderAnimatic were retrieval misses; current animatic.ts and observed ffprobe duration controlled the fix. No reference code copied, no paid calls/push. Full audit remains active.


### Manual color overrides do not redefine continuity rules

Found that a successful measured override (purple) could mark a blue-rule cup consistent and overwrite proposedFix.targetColor, letting repeated edits silently adopt the override as the expected value. Correction now keeps the audited expected color. A confident measured contradiction yields mismatch and explains actual versus expected; failed measurement remains uncertain. Only a matching measured color with no other unresolved checks can be consistent. Explicit rule-changing commands still update their own rules through the separate audit path.

23 focused tests and TypeScript passed. New unit regression covers purple override, repeated purple override, and cobalt/blue repair. Two browser tests passed in23.2seconds: the manual override survives refresh as mismatch with blue still expected (and its real MP4 export/take restoration still work), while an explicit recolor command updates its matching rule/revision correctly. XERJ anchorshot measuredStatus returned no useful current code; direct current applyContinuityFix and caller reads used. ref-sam2 _obj_id_to_idx is only identity-separation reference at recorded pin, not evidence of color semantics. No paid requests/push; audit active.


### Consolidated local validation after the latest repairs

`npm run check` passed:244 Vitest tests/32files,10 rendering checks,1 local-worker test, TypeScript and production build. Immediately afterward, `PLAYWRIGHT_CHANNEL=chrome npx playwright test --workers=1` passed100/100 in7.7minutes, process exit0. The worktree was unchanged throughout both runs. This supersedes earlier230/87 totals and includes the newer candidate cancellation, unmount cleanup, mask-source rejection, explicit scene numbering, generated-frame command routing, corrected-still persistence/export and rule-verdict regressions. Paid providers were empty for the isolated test server; no live model calls.

Remaining scope is unchanged: semantic/spatial/character continuity evaluators, representative visual quality and complete voice/accessibility use are not established by these passing fixtures. Existing fresh local GPU evidence remains separate from the browser regression. No commit/push was performed.


### Competing mutation shortcuts during a pending edit

Reproduced in Chrome: hold the second generative edit response, press Y outside an input, and New project becomes enabled while the original request remains pending. The second correction could change the same shot and clear the shared processing flag prematurely. The new regression failed on the enabled project button before the fix. Global mutation shortcuts (fix, audit, rebuild, take, duration, reorder) now reject while the current project is processing. The voice/text command entry point similarly rejects mutations while processing, including commands arriving outside disabled composer controls. Playback, help, narration and scene selection remain available. This is entry-point protection; it is not proof that every direct callback or same-event-loop dispatch is serialized. Broader operation ownership remains an audit item.

The identical regression now passes, including unchanged pending scenes and correct original-scene application after selecting another scene. TypeScript passed. Workflow plus editor browser regression passed27/27 in2.8minutes, exit0, with paid providers disabled. This targeted run follows the prior full244-unit/100-browser checkpoint; it does not claim a new full-suite run. No visual styling changed, no paid calls or push.

Reference coding: XERJ anchorshot handleExecuteVoiceCommand returned stale App/voice entries; current source was inspected. ref-prompt-kit isLoading returned prompt-input and demo submission blocks. Inspected prompt-kit components/blocks/conversation-prompt-input.tsx:75-99 at recorded pin5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a; its loading state accompanies simulated requests, so it was rejected as sufficient concurrency protection. No upstream code copied. Existing index refresh remains unavailable under the documented low-disk safeguard.


### Voice draft lifetime and manual script authority

A transport-stub test initially appeared to show a cross-project leak, but it incorrectly invoked tools from an ended conversation. Current CleanStudio is keyed by projectId and unmount closes the conversation. Corrected the fixture to assert teardown and open a new conversation; existing project isolation passed without a production change. Removed the unnecessary proposed project-binding change.

A separate real failure within one project was reproduced: set_direction stores a temporary ref, the user then edits Scene Transcript, and generate_storyboard consumes the stale ref and overwrites the new script. The regression observed the old kitchen/cup text replacing the new umbrella/ocean text. The ref now clears when its script has reached React state, retaining only the bridge needed for consecutive tools in one turn. The identical test now passes along with same-turn generation, old-project transcript retention and empty-new-project behavior.

Validation: TypeScript passed;4 Chrome browser tests passed in21.4seconds (voice draft/project scope, project and mask persistence, captions, offline orb). Conversation transport is stubbed, real App callbacks and storage are used; this is not microphone/ASR/model proof. No paid calls or push, no UI markup/styling changes.

References: XERJ anchorshot spokenDirection returned broad/stale entries, so inspected current CleanStudio and App keyed mounting/switchProject. ref-prompt-kit handleSubmit returned components/blocks/conversation-prompt-input.tsx:75 (pin5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a, source inspected in preceding checkpoint). Its simulated single-chat submission is not a project-lifetime solution; no upstream code copied. Agent command result reporting via a100ms render delay remains an audit item, not established by this fix.


### Same-turn duplicate storyboard generation and voice outcomes

Confirmed with a gated browser generation stub that two immediate generate_storyboard tool calls entered generateStoryboardFromTranscript twice before React published processing state. The regression failed with2 calls instead of1. Added a synchronous generation ref at the App handler, plus the current processing-state gate. The owning operation releases the ref in finally, including failure. The handler now returns its empty/busy/failure/success message; CleanStudio's voice generation tool awaits it through a Promise<string> callback rather than returning an unconditional started message. This also lets the sequential agent tool loop await generation before subsequent actions.

The identical regression passes: one held generation, busy rejection for the duplicate, exact failure delivered to the first caller, controls unlocked, and a successful retry returning Generated4shots. The previous voice draft/project/manual-script test still passes (2 browser tests,14.9seconds). Actual transport/model are stubbed in these tests; production App callbacks run. npm run check passed afterward:244 Vitest tests/32files,10 rendering checks,1 local-worker check, TypeScript and build (largest App chunk458.66kB). No new full-browser-suite claim.

Reference coding: XERJ anchorshot handleRebuildFromTranscript returned an older implementation; inspected current App and CleanStudio. ref-prompt-kit handleSubmit at the already inspected pinned conversation-prompt-input.tsx:75-99 uses simulated submission and loading state, not a synchronous operation guard; rejected as adequate serialization, no code copied. No UI styling, paid calls or push. General mutation coordination, command-result reporting outside generation, semantic checks and representative visual quality remain open.


### Delayed full-sequence review preserves newer edits

Reproduced a real overwrite using a gated auditAllShots call and the editor's Increase duration button: the new duration saved while review was pending, then the older audited shots replaced it. Full review now captures project identity and exact source scene/rule arrays. A changed source rejects the entire obsolete result with a rerun message, retaining all newer scenes, masks and metadata. The state updater repeats the source check for already-queued edits and unlocks processing without applying stale shots. Successful results now commit shots, active selection and status together.

TypeScript passed. Three targeted Chrome regressions passed in22.9seconds (pending generative mutation protection, matching recolor rule revision, stale audit protection). The stale-audit regression was then expanded to rerun review and passed again in10.2seconds: retained the extended duration, populated continuity checks, and unlocked controls. Browser comparisons use full-scene hashes to avoid dumping embedded media on failures. These are local fixture/review proofs, not semantic model validation.

Reference coding: XERJ anchorshot handleRunFullAudit produced stale/broad hits; current App and CleanStudio controls inspected. ref-sam2 _obj_id_to_idx returned sam2/sam2_video_predictor.py:118-145 at pin2b90b9f5ceec907a1c18123530e92e794ad901a4, read directly as an object-identity reference, not a React stale-result implementation. No code copied, UI styling changed, paid calls or push. Other asynchronous mutation handlers still need equivalent ownership review; this checkpoint is not a global concurrency-completion claim.


### Delayed per-scene correction preserves newer scene state

Reproduced through real editor controls with gated applyContinuityFix: extending Shot2 from3.5 to4seconds during correction was undone when the correction completed. The test failed with expected4/received3.5. Correction now captures the current project, exact target scene object and rules at invocation. After awaiting, stale source results are rejected; the React updater repeats the identity check to protect queued edits. Failure/final cleanup writes are project-bound. Unrelated scene state is not replaced.

The same test passes: all scenes remain byte-equivalent to the edited saved state when the old result is rejected; retry preserves4seconds, adds exactly one revision, passes pixelVerification, and keeps the other3scenes identical. TypeScript passed. Four targeted Chrome tests passed in30.2seconds: this regression, delayed full review/retry, matching color-rule revision, and source-bound manual SAM corrected-still persistence/take restoration/real MP4 export. This is fixture/pixel evidence, not live SAM accuracy.

Reference coding: XERJ anchorshot handleApplyProposedFix was stale; current source inspected. ref-sam2 add_new_mask returned sam2/sam2_video_predictor.py:301-328 at pin2b90b9f5ceec907a1c18123530e92e794ad901a4; inspected frame/object association as a reference only, no code copied. No paid calls, UI styling changes or push. Overall audit remains active; rule-update/batch handlers and generalized operation ownership still require scrutiny.


### Remove silent cup substitution for object-free offline stories

The existing no-rule test checked prompt text only. Extending it to narration exposed that a courier/market story still rendered and described a blue cup, despite rules being empty. Removed the fallback rule-cup-color from the offline generator. No primary rule now means no object draw, a zero-area object box, no correction proposal, ruleRevision0, generic-preview narration/history, and uncertain continuity instead of a synthetic pass. Explicit cup/umbrella presets retain their existing behavior.

Validation: TypeScript and18 planner/studio unit tests passed. Two Chrome regressions passed in10.4seconds: an object-free user story has no rules/proposals/cup narration, the saved canvas equals the no-object render and differs from cup rendering, and the explicit cup recolor flow still works. Visually inspected C:/Users/sunny/AppData/Local/Temp/anchorshot-no-cup-preview.png: no cup is present. Background/character remain generic offline artwork; this is not a generated market scene. The initial project title also still inherits a diner preset and remains a separate product audit issue.

Reference coding: XERJ anchorshot generateStoryboardFromTranscript located the old fallback, confirmed against current metaModels and canvasEngine; ref-sam2 _obj_id_to_idx at previously inspected pin/path only informs explicit object identity, not generation semantics. No upstream copied. No paid calls or push. This does not generalize the two fixed dream object slots or replace the offline scene templates; those remain open.


### Whole-word offline continuity keywords

Added negative controls for occupied, cupboard, carpet, address and smuggler. All five incorrectly produced tracked-object rules; tired also supplied red and carries supplied car. Six new regressions failed before the change. Offline object/color extraction now requires whole words; common object plurals and mug-to-cup aliases remain supported. This prevents fabricated cup/car/dress constraints from ordinary unrelated words.

TypeScript and61 targeted unit tests passed across planner/studio/command parser. Three Chrome browser tests passed in11.8seconds: courier/market and occupied-room/cupboard/carpet stories both retain no continuity object or cup visual, and explicit cup recolor still works. Rule extraction remains a limited heuristic (first known object, default colors/spatial assumptions), not general language understanding; those remaining semantics are not claimed fixed.

Reference coding: XERJ anchorshot extractContinuityRules located stale includes-based code, confirmed in current source; ref-prompt-kit handleSubmit at the previously inspected pin is submission plumbing and offers no language parser, so no code copied. Current negative-control evidence drove this correction. No paid calls, visual styling changes or push; audit active.


### Stale rule updates stop before recoloring

Both a plain rule command and make-the-cup-purple reproduced the same stale-scene overwrite: a4second edit reverted to3.5seconds while auditAllShots was pending. Rule updates now capture the current source project/scenes/rules, reject changed source after awaiting, and recheck in the state updater. Errors release only their source project's processing state. The command dispatcher now consumes thrown rule/audit failures instead of leaving button-submitted promises unhandled. A rejected rule audit does not proceed into the recolor loop.

TypeScript and4 targeted Chrome tests passed in25.4seconds: both stale rule/recolor commands preserve all edited scene bytes and original rules with zero page errors, a normal explicit recolor still records the correct revision, and stale mask correction/retry remains working. Reference searches/readbacks for handleAddOrUpdateRule and ref-prompt-kit handleSubmit were completed earlier in this same audit before the cup question; refreshed the authoritative source before editing. No reference code copied. No UI change, paid call or push. This does not yet prove all queued same-turn operation combinations safe.


### Consolidated regression after voice, stale-result and cup-fallback repairs

Full npm run check passed253 Vitest tests/32files,10 rendering checks,1 local-worker check, TypeScript and production build. Full Chrome suite then completed107passed/1failed in7.7minutes with unchanged worktree. The one failure never reached the scene-command assertions: initial Kitchen to ocean button did not load; trace records net::ERR_NO_BUFFER_SPACE on node_modules/@fontsource-variable/plus-jakarta-sans/index.css. Preserved that trace at C:/Users/sunny/AppData/Local/Temp/anchorshot-full108-buffer-timeout-trace.zip. An unchanged isolated rerun passed (one test,12.7seconds). No assertions/timeouts were weakened and no automatic retries were enabled.

The resource failure remains visible in the result; it is not evidence of a command parser failure or a clean full108-test pass. The broader audit remains open: general objects/dream backgrounds, semantic/spatial/character evaluation, remaining async ownership and representative voice/film quality. No paid generation, code commit or push. Test server stopped after rerun.


### Unsupported offline objects no longer become cups

Four negative controls (dog,dress,notebook,carpet) exposed that the offline renderer's final else branch drew a cup while reporting continuity for the requested object. Added an explicit authored-sample capability check. Unsupported concepts have a zero-area sample box, no object drawing, no injected mismatch/correction proposal, uncertain status and explicit not-rendered narration/history. Requested rules are retained. Offline segmentation rejects unsupported sample objects rather than fabricating a cup-shaped mask. Live-provider object names are not restricted by this sample-only check.

TypeScript and all257 Vitest tests/32files passed. Four Chrome regressions passed in14.1seconds: explicit cup recolor, both object-free stories, and an actual dress prompt whose saved raster equals the no-object canvas and whose requested offline mask rejects. This removes false evidence; it does not implement rendering/recognition of arbitrary objects. Real user images/manual masks and configured generation remain the paths for such objects, and general dream-slot support remains unfinished.

Reference coding: XERJ anchorshot drawTargetObjectInBox located the fallback, confirmed against current canvasEngine and metaModels. ref-sam2 _obj_id_to_idx at the previously inspected118-145/pin2b90b9f5ceec907a1c18123530e92e794ad901a4 reinforces retaining requested identity instead of substituting an object; no upstream code copied. No paid requests, UI styling changes or push.


### Fresh project naming does not imply the diner preset was selected

First launch initialized an empty project with DIRECTOR_PRESETS[0].title even though transcript/scenes/rules were empty. Changed only that initial title to Untitled film, matching New project. Saved projects still hydrate with their saved names, and explicit preset selection still sets the chosen preset title. No migration/renaming of existing user projects. TypeScript and existing project rename/switch/mask persistence plus desktop/mobile non-scrolling landing tests passed (3tests,13.6seconds).

Reference coding: XERJ anchorshot initialPreset led to current App initialization; ref-prompt-kit messages returned conversation-prompt-input.tsx:73 at the already inspected pinned reference. Its seeded demo messages were deliberately not treated as user content. No copied code or visual changes, paid calls or push. The earlier initial-title issue is resolved for newly created initial projects; broader object-independent workflow remains open.


### Fix command accepts approved generated-image masks

Reproduced through the real command composer: a generated frame with confirmed candidate1 and exact source-bound live-SAM fixture mask was rejected by an obsolete isLocalImage early return. Removed that command-only blanket rejection; applyContinuityFix remains authoritative and rejects missing target, sample masks on generated media, source mismatch and ambiguous candidates. No general bypass of mask checks.

TypeScript and23 mask/studio tests passed. Three Chrome regressions passed in19.6seconds: generated-image fix command creates exactly one verified generated revision with its mask rebound to the corrected image; manual corrected-still save/take/export remains working; unconfigured segmentation stays offline. SAM transport is intercepted and uses test rasters; no live inference claimed.

Reference coding: XERJ anchorshot applyContinuityFix returned old code, so inspected current source validation and App guard. ref-sam2 add_new_mask:301-328 at recorded pin provides source/object association reference only, no code copied. No paid calls, UI changes or push. The separate batch recolor generated-image filter remains an audit item; this fix covers explicit fix commands.


## Completed-fix delivery validation — 3 November 2026

At the user's explicit request, commit and push completed repairs and this evidence to main. Final npm run check passed257 Vitest tests/32files,10 rendering checks,1 local-worker test, TypeScript and production build (App460.49kB). Final focused Chrome checks passed7/7 in23.8seconds: desktop/mobile non-scrolling landing, rename/project/mask persistence, approved generated-image fix command, object-free previews and unsupported-object rejection. The previous full108-test attempt remains recorded as107passed/1startup resource timeout with an unchanged successful isolated rerun; no clean full110-test claim is made.

Keep the black-and-white UI and existing component theme. No new design work was performed for delivery. Existing audit UI changes are functional controls/provenance/accessibility and layout bug fixes, not a theme replacement. .claude, environment files, generated media, caches, weights and local test artifacts are excluded. Original Nikku/Fylmer is untouched. Outstanding general-object, semantic-continuity and end-to-end quality limitations remain documented. The shortcut-modifier collision found when the goal was cleared was not fixed; its unfinished test was removed on cancellation. No paid provider calls.
