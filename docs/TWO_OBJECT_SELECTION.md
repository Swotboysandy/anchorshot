# Offline cup and umbrella selection

Open the Kitchen to ocean study. Select real cup, load a photo/sample, trace or correct its mask, and Apply cup to dream. Select umbrella, upload a photo or Use umbrella sample, trace or load the authored sample mask, correct it, and Apply umbrella to dream.

Each editor has separate source pixels, mask, undo history for the current editing session and approval revision. Trace, Add brush, Erase brush, Clear and Undo work for both. Cancel retains the last approval. Editing clears the quality report and disables transition exports until the draft is applied or cancelled. Approved sources and masks now persist locally per project in IndexedDB; refresh and switching are covered by browser tests. Draft undo history is still limited to the current editing session.

Cup and umbrella are fitted to distinct fixed slots: cup centered x250, bottom360, max200x190; umbrella centered x600, bottom380, max250x300 in the 800x450 frame. The masks remain independent and are combined only for rendering. Any overlap is rejected. Restoring the illustrated cup retains the umbrella; removing the umbrella retains the cup. This is stationary pixel protection, not motion tracking, relighting, automatic semantic selection or neural morphing.

The cup sample is the existing CC0 photograph. The umbrella sample is an authored canvas illustration, not a real photograph or SAM output. The saved demo deliberately includes an erased hole to demonstrate mask correction. Users can upload their own umbrella photo instead.

## Validation, 2026-10-30

- npm run check: TypeScript, production build and 54 tests passed (45 Vitest + 8 rendering + 1 local API).
- npm run test:ui: all 9 browser tests passed in one run, including existing cup/dream flows, separate umbrella correction and undo, cancelling an empty draft, removal, mobile upload, preservation reporting and actual WebM download. No POSTs or page errors in the two-object flow.
- Browser ImageData dimensions are copied explicitly; a regression test covers nonenumerable dimensions.
- 289 uncompressed samples: cup 21,041 protected pixels, umbrella 17,902, each with zero changed pixels and zero maximum channel difference. Render p95: 11.8 ms on this run.
- scripts/verify_two_anchor_export.py: both independently downloaded masks preserve their pixels in first/last PNGs; masks do not overlap and the environment changes. WebM fully decodes: VP9,800x450,288 frames,11.994543 seconds,strictly increasing timestamps. Lossy encoding mean channel errors are recorded per object, not claimed as zero.
- No Meta/Muse/Baseten calls, downloads or credits are needed for this feature. No new GPU inference was performed for these compositing tests.

Evidence: [preview](two-anchor-demo/study.png), [video](two-anchor-demo/dream.webm), [quality](two-anchor-demo/quality.json), [decoded export](two-anchor-demo/export.json), [cup mask](two-anchor-demo/cup.png), [umbrella mask](two-anchor-demo/umbrella.png).

Reproduce: npm run check; npm run test:ui; run scripts/verify_two_anchor_export.py with Python, NumPy, Pillow and FFmpeg/ffprobe available.
