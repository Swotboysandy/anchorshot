# Automatic prompt/voice film flow — 4 November 2026

## Implemented locally
Start-chat generation and the existing voice generate_storyboard tool now share generateFilmFromTranscript. The path requires a live planner and video provider, plans at most three shots for this test, generates scene-specific clips sequentially, validates 25 fps video metadata, and assembles the timeline using actual clip durations. It never invokes the offline cup/diner renderer. Input is retained on failure. All generated continuity remains unreviewed.

The server-only Baseten adapter follows the library prediction contract (prompt to base64 MP4), bounds response size, disallows redirects and non-Baseten endpoints, disables automatic retries, decodes with ffmpeg and verifies fps/frame count/duration with ffprobe. No frame duplication/retiming is performed. Clips and thumbnails use the existing persistent media store.

References: https://www.baseten.co/library/wan-2-2-t2v/ and https://docs.baseten.co/reference/management-api/models/gets-all-models . XERJ executable remains missing; earlier requested local and upstream searches failed. Inspected current planner, agent, local-media and shot generation code directly. No new UI library or layout changes.

## Verified
263 unit/integration tests across 33 files passed; TypeScript and production build passed. Added tests for unavailable provider/no samples, prompt-derived scenes, non-25-fps and invalid frame rates, configuration isolation and authenticated request limits. These use fixture transports and do not prove live video inference.

## Deployment blocker
Authenticated GET /v1/models returned an empty models list. /v1/library_listings and /v1/instance_type_prices returned 403 with the existing planner key. The Baseten Wan deployment page requires sign-in. No video deployment has been created, no VIDEO_PROVIDER configured, and no paid video inference was run. Planner live inference was verified in the preceding task; actual microphone-to-video and new generated-video playback remain unverified.

User budget: $10 maximum, 25 frames per second. Before activation, verify actual instance pricing and shutdown/scale-to-zero controls. The adapter's durable three-attempt limit and explicit expiration window are request safeguards, NOT an enforceable dollar budget or an infrastructure shutdown mechanism. Do not describe them as a $10 hard cap. The library endpoint's acceptance of fps=25 still requires live confirmation; output at another rate will be rejected, not relabelled.

Known remaining implementation limits: generation returns the complete film only after every clip succeeds; a later failure leaves completed media on disk but does not yet offer partial-film recovery. Explicit cancel UI and cross-project/unmount cancellation need completion before a broader release. Existing browser tests that expect the automatic demo flow need migration to real-video fixtures. Preset/dream workbench remains a separate legacy surface; no existing projects were deleted.

## Follow-up using the existing key
GET /v1/library_models succeeded and included baseten/wan2-2-t2v. The earlier /v1/library_listings endpoint is organization-owned listings, not the deployment catalog. Both Bearer and Api-Key authentication were checked where documented. GET /v1/instance_type_prices, /v1/instance_types and /v1/billing/usage_summary returned PERMISSION_DENIED (403). User reiterated that the key should be used; attempted authorized POST /v1/models with the catalog source and name AnchorShot bounded video test, intending immediate deactivation. Baseten rejected creation with 403 PERMISSION_DENIED / Authorization error. No deployment was created and no video GPU was started. Account access or an already-deployed video endpoint remains necessary. Public H100 list price found on baseten.co/pricing is $0.10833/minute; actual deployment hardware and billing still require verification before activation.
