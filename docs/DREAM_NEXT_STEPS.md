# Dream lab: resource audit and next work

Reviewed 28 October 2026 on `dream-journey`. Main and the original Fylmer checkout are outside this change.

## Designeer catalogue

Observed directly at https://designeer.xyz/resources and its Motion & 3D filter.

- Components: shadcn/ui, Base UI, Radix, 21st.dev, Motion Primitives, React Bits, Fancy Components, ForgeUI, Opensource UI, NumberFlow.
- Motion and rendering: Motion, GSAP, Three.js, React Three Fiber, Drei, Theatre.js, Rive, Lottie.
- Shaders and learning: Paper Shaders, OpenShaders, shadercn, compute.toys, Shaderfrog, Book of Shaders, Orbkit, glimm, Morphrig, morphicons, textmotion, Easing Wizard, Devouring Details.
- Asset tools: Blender, Poly Haven, gltf.report.
- Typography and colour: Fontsource, Fontshare, Klim, Utopia, Velvetyne, Departure Mono, Wakamai Fondue, OKLCH, Color.review, Huetone, APCA, Ramps, Atmos.

These are observed directory listings, not an exhaustive inventory or a license approval for all resources. Review each upstream license before adopting code/assets.

## Selected direction

Motion for React is now used for short interface entrances, scene selection feedback and export-panel entry/exit. Reduced-motion preferences and Gentle playback remove these animations. Film frames still use one deterministic Canvas timeline for preview and export.

The dream editor now uses a custom monochrome workbench: white surfaces, black controls, a large preview, a right-side inspector and an editable scene sequence. Self-hosted DM Sans supplies headings and controls, with 16px mobile text inputs. InspectorSection is a shared local React component. Source media keeps its original colours; the UI palette is monochrome. No external font service is needed.

Sources: https://motion.dev/docs/react and https://base-ui.com/react/overview/quick-start . Base UI is a candidate for future dialogs/popovers, not a dependency added in this pass. Do not install several competing component or animation systems. Shader effects could improve transitions later, but they do not generate coherent scenes or preserve identity by themselves.

## What remains, in priority order

1. Completed in this branch: local scene image import, provenance labels, reset, bounded-file validation and local persistence. Original target: import three source images, show their provenance, and replace sample worlds without network calls. Include reset and invalid-file handling.
2. Directing: scene titles and captions are editable, with an explicit three-paragraph apply action. Remaining: editable scene order, an approval step, and import of saved plans. Story text does not generate images.
3. Narration: local recording/import, playback sync and audio-inclusive export. Current output is silent WebM.
4. Meta integration, after the user enables it: transcription/reasoning, image generation and actual SAM selection. Current dream flow performs zero model calls. The frame editor adapter has not been verified live.
5. Cinematic transitions: compare a controlled distortion or portal shader with the existing doorway; validate rendered export and reduced-motion fallback. Do not label it generative morphing.
6. Delivery: MP4 path, real device/export coverage, screen-reader and creator testing, and a complete three-minute hackathon demo.

The immediate product gap is making the user's own story and media change the film. More decorative UI libraries do not solve that gap.
