# Dream Journey experiment

Branch: `dream-journey`. Keep this work separate from `main` until the direction has been discussed. Framelock remains a working title.

Open `/dream` on the local server. The original object editor is still at `/`.

## This first slice

- A 20-second kitchen → ocean → moon sequence using newly authored procedural sample illustrations.
- An expanding doorway reveal or dissolve, with play, pause, restart, scene jumping and keyboard scrubbing.
- The existing hand-authored cup mask is reused to extract one foreground cutout. The same cutout is composited at fixed coordinates in all scenes. This is controlled compositing, not generated cross-scene identity preservation.
- Each scene accepts a local JPEG, PNG or WebP (up to 8 MB and 24 megapixels). Images are fitted without cropping into a 1120 x 700 dark frame and stored as resized JPEG copies. No files leave the browser. A scene can reset to its sample illustration without losing its title or caption.
- Scene titles and captions are editable. The explicit "Use paragraphs as captions" action applies exactly three paragraphs of up to 160 characters each; invalid input leaves the current captions unchanged. This is local text editing, not model inference.
- Story, titles, captions, settings and resized images save locally. If browser storage is unavailable or full, the interface reports that the plan was not saved; downloading the plan preserves the current edits and embedded images. Clearing browser storage deletes its saved copy. JSON plan import is not yet implemented.
- Uploaded images do not receive the sample ocean's animated water overlay. Turning off the sample mug also removes its foreground ledge; a caption strip remains for readability.
- Reduced-motion preferences default to still cuts and no environmental motion. Playback never starts automatically.
- Download a still PNG, the editable JSON plan, or an actual 20-second silent WebM recorded from the canvas. Export requires a supported browser and an active tab. Cancelling discards the partial recording. There is no narration or MP4 export yet.

The branch does **not** call Meta or another generation provider. All visual sources and the sample mask are labelled. SAM and generative-video integration remain unverified and unimplemented in the dream flow; the original editor's server-side SAM adapter remains available separately. WebM output is for viewing/sharing, not direct input to Meta's documented SAM video endpoint.

## What this experiment should answer

Does one persistent foreground object make the transition feel like a connected dream? Are doorway reveals compelling enough to be the signature interaction? Does a creator want to direct which objects stay, which worlds appear, and how the transitions happen?

## Next implementation after discussion

1. Turn a recorded or typed dream into a user-approved three-scene plan using Meta transcription and reasoning.
2. Generate source images with explicit reference/anchor choices, then test real SAM segmentation.
3. Replace the sample transitions only when the chosen animation/video pipeline has demonstrated reliable results. A mask alone cannot produce a generative morph.
4. Add recorded narration and test the complete directing flow with users. Keep consent and source attribution with any personal media.

## Verification

Run `npm run check` and `npm run test:e2e`. Dream tests cover timeline boundaries, plan validation, persistence, playback controls, foreground pixel consistency, export/cancel, decoded WebM dimensions, responsive layouts and automated accessibility. Screenshots and video output are ignored under `.artifacts/dream/`.

The verified sample export is VP9 WebM at 1120 × 700, approximately 20 seconds, with duration metadata and local-file seeking checked. The fixed cutout's opaque interior was compared across all three scenes. This does not imply that generated identities or translucent edge pixels remain invariant. Automated accessibility checks cover the tested rules; screen-reader and user testing remain outstanding.

## Offline editing verification

The local-media browser test selects a real PNG fixture, edits the story and scene title, reloads, checks the rendered image pixels, downloads a plan with the resized image and correct source labels, rejects a corrupt replacement, and resets the scene image without losing its text. It also checks that the flow makes no POST or external HTTP requests. Real personal images are never used as test fixtures.
