# Local generation restoration — 2026-11-03

The local checkout had no node_modules or .artifacts/local-ai/venv. npm run dev failed because Vite was missing. Existing model directories and manifests were retained. Restored dependencies with npm ci and scripts/setup_local_ai.ps1 -SkipModels using the existing checksum-verified CUDA wheel. CUDA detected RTX 3050 Laptop GPU.

Started localhost:4317 with META_API_KEY empty and PLANNER_PROVIDER, IMAGE_PROVIDER, TRANSCRIBE_PROVIDER and AGENT_PROVIDER set to offline. No paid provider calls. Story submission still produces explicitly labelled offline sample storyboard frames; local GPU media is generated separately in scene review and applied with Use video/image in Shot.

UI changes: local generation disclosure opens by default; checking, submitting and running states show a monochrome structural skeleton; reduced motion disables pulsing. Refresh selects an active job before older saved results. Worker errors and cancellation remain visible; no simulated progress percentages were added.

Reference coding: XERJ searches for LocalGenerationPanel (anchorshot) and skeleton (ref-prompt-kit) failed because its executable is missing. Inspected current source and prompt-kit/components/ui/skeleton.tsx directly, pinned 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a. Reused its structural skeleton primitive, adapting import, monochrome colour and reduced-motion class. No layout redesign.

Validation: TypeScript passed; 257 tests / 32 files passed; local-worker integration test passed. Real browser GPU job: b5b44842-fdc5-42fc-8840-beb73f3ba034 (result recorded below after completion).

Fresh GPU video completed: 512x512, 16 frames / 2 seconds, 78.6 seconds inference. Browser confirmed completed result, Use video in Shot 2, generated scene provenance and saved take. Timeline played to completion, but exact generated-clip currentTime was not captured before the browser tab became unavailable. Production build passed. Added npm run dev:local for repeatable credit-free startup.
