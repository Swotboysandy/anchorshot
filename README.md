# Anchorshot — Accessible Voice-Directed Storyboard Studio

**Anchorshot** is a storyboard and dream-transition editor designed around voice direction, keyboard controls and object continuity. Built for the Meta Global AI Developer Hackathon (Indie Developer track). Offline use supports typed direction, sample planning, manual masks and optional installed local GPU models. Live transcription requires a configured provider; complete voice-only and screen-reader workflows have not yet been verified.

**Current verification scope:** AnchorShot measures selected-frame colour and pixel containment. General visual understanding, character identity and spatial continuity remain incomplete. Supported colour rules can be checked against selected pixels; manual masks can protect cup and umbrella layers through a deterministic kitchen-to-ocean composite. Zero raw-pixel drift proves preservation of the selected pixels, not selection accuracy or cinematic quality. See [the current audit](docs/FULL_AUDIT.md) for source, browser, GPU and export evidence and remaining gaps.

---

## 1. What runs on which model

Each AI role sits behind a small provider adapter on the local server. Prompts and output schemas live in the app, each role validates its expected response shape. Provider settings live in `.env.local`; a different model still needs compatibility and quality testing. With nothing configured, planning and storyboard samples work without keys. Unsupported model actions fail explicitly; connected-provider failures never count as sample-model success.

| Role | Server endpoint | Configured provider adapter | Offline fallback |
| :--- | :--- | :--- | :--- |
| Shot planning and continuity rules | `POST /api/muse/spark` | Meta Muse Spark / compatible chat adapter; provider-specific validation required | Keyword planner |
| Object segmentation and colour check | `POST /api/segment`, `/api/segment/check` | **Meta `sam-3.1`**: real masks on generated frames; colour is measured from the masked pixels | Fixture masks, clearly labelled "offline fixture" |
| Storyboard frames | `POST /api/muse/image` | **Meta `muse-image-1.0`** / compatible image adapter; generated frames remain unreviewed until supported checks are performed | Canvas-drawn sample frames |
| Voice to script | `POST /api/muse/transcribe` | **Meta `muse-voice-transcribe-1.0`** through `POST /asr/transcribe` or the configured Whisper-compatible adapter; compatibility must be tested | Typed input / local orb metering only; no browser cloud recognition |
| Spoken narration | Browser | Browser `speechSynthesis`; recorded narration can also be attached to a scene | Same |
| Voice co-director | `POST /api/agent/turn` | **Meta `muse-spark-1.3`** with studio actions as tools; hands-free turns through Meta voice, spoken by the browser, with live captions | Orb meters the microphone locally |
| Film export | `POST /api/export/animatic` | Local ffmpeg: 1280x720 H.264 MP4 with camera moves, video clips and attached narration/source audio | Silent still-frame browser WebM; video, narration and BITC cannot silently fall back |

The configured adapters can route planning, frames, segmentation, transcription and agent requests to external providers; offline operation does not. Local GPU image/video generation uses installed SD1.5/AnimateDiff weights separately. Speech synthesis uses the browser voice. Earlier builds recorded limited live calls; the current audit has not repeated paid-provider validation. Video generation is opt-in from Generate new media and never starts by itself. A standalone offline dream workbench is at `/dream`.

---

## 2. Configuration (`.env.local`)

Copy `.env.example` to `.env.local` (git-ignored) and fill only the roles you want live. API keys stay on the local server and are never sent to the browser.

```dotenv
# Meta muse-spark for planning
PLANNER_PROVIDER="openai-compatible"
PLANNER_BASE_URL="https://api.meta.ai/v1"
PLANNER_API_KEY="<your Meta key>"
PLANNER_MODEL="muse-spark-1.3"

# Meta SAM 3.1 gateway
META_API_KEY="<your Meta key>"

# Meta voice and the voice agent use META_API_KEY
TRANSCRIBE_PROVIDER="meta"
AGENT_PROVIDER="meta"

# Meta muse-image for storyboard frames
IMAGE_PROVIDER="openai-compatible"
IMAGE_BASE_URL="https://api.meta.ai/v1"
IMAGE_API_KEY="<your Meta key>"
IMAGE_MODEL="muse-image-1.0"
```

`.env.example` documents the remaining settings, including `AGENT_MODEL` and `IMAGE_SIZE`. Paid calls share a per-session request limit (`SAM_MAX_REQUESTS`, default 25 under `npm run dev`).

---

## 3. Running locally

**Prerequisites:** Node.js 22.12 or newer and npm. MP4 export needs `ffmpeg` and `ffprobe` on `PATH`; without them still-only exports can use a silent WebM. Video-clip, recorded narration or BITC exports require ffmpeg.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4317. `npm run dev` and `npm run dev:server` both load the providers from `.env.local`.

**Checks:**

```bash
npm run typecheck
npm test
npm run test:e2e
```

Browser tests start their own server on port 4327 with every model provider switched off, so they never call a paid service.

---

## 4. Accessible Keyboard Shortcuts & Voice Workflow

The shortcuts below are implemented and covered in part by keyboard/browser tests. A complete walkthrough with an actual screen reader remains unverified:

| Shortcut | Action |
| :--- | :--- |
| **`[V]`** | Start / Stop dictation when a transcription provider is connected; offline input remains typed |
| **`[SPACE]`** | Play / Pause Animatic Sequence with synchronized spoken narration |
| **`[←]` / `[→]`** | Navigate Previous / Next Storyboard Shot with automatic status readback |
| **`[1]` – `[4]`** | Jump directly to Shot 1 through Shot 4 |
| **`[N]`** | Narrate active shot visual description and continuity state aloud |
| **`[Y]`** | Accept and apply the proposed `sam-3.1` continuity fix on the active shot |
| **`[B]`** | Compare before/after repair; measured pixel-containment results are separate from visual correctness |
| **`[M]`** | Toggle the `sam-3.1` segmentation bounding box and alpha mask overlay |
| **`[A]`** | Run supported sequence continuity checks; unsupported properties remain uncertain |
| **`[G]`** | Parse transcript and prepare storyboard frames using the configured provider or offline samples |
| **`[?]`** | Open / Close the Accessible Keyboard & Voice Command Reference modal |

### Example Voice / Text Directives
Speak via `[V]` or type into the **Direct Voice / Text Command** input:
- `"Fix continuity mismatch in Shot 2 using SAM 3.1"`
- `"Change continuity rule: cup color must be emerald"`
- `"Narrate all shots and continuity status"`

## Free local GPU generation

See [Local AI setup and in-app testing](docs/LOCAL_AI_GENERATION.md). The shot inspector can generate actual images and short videos using the installed local models without hackathon credits. The original sample storyboard controls remain available.
