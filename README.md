# Anchorshot — Accessible Voice-Directed Storyboard Studio

**Anchorshot** lets a blind or low-vision director build a film storyboard entirely by voice and keep it visually consistent without having to see it. Built for the Meta Global AI Developer Hackathon (Indie Developer track).

**The moat:** other tools generate frames; Anchorshot proves continuity. Every prop that must stay the same ("the cup is blue in every shot") becomes a rule. SAM masks locate the prop, a mismatch is spoken aloud, the fix recolours only the masked pixels, and an evidence trail records the source hash, mask provenance and how many pixels changed inside and outside the mask. Accessibility is the core of the product, not an add-on: voice in, spoken narration and on-screen captions out, full keyboard control.

---

## 1. What runs on which model

Each AI role sits behind a small provider adapter on the local server. Prompts and output schemas live in the app, every model's reply is validated against the same schema, and swapping a model is a `.env.local` change. With nothing configured, every role falls back to an offline fixture so the whole app runs without keys.

| Role | Server endpoint | Live provider used in this build | Offline fallback |
| :--- | :--- | :--- | :--- |
| Shot planning and continuity rules | `POST /api/muse/spark` | **Meta `muse-spark-1.3`** (also verified: `muse-spark-open-1026` through the Baseten x Meta endpoint; any OpenAI-compatible chat model works) | Keyword planner |
| Object segmentation and colour check | `POST /api/segment`, `/api/segment/check` | **Meta `sam-3.1`**: real masks on generated frames; colour is measured from the masked pixels | Fixture masks, clearly labelled "offline fixture" |
| Storyboard frames | `POST /api/muse/image` | **Meta `muse-image-1.0`** (any OpenAI-compatible `/images/generations` endpoint works); frames stay unreviewed until the continuity check runs | Canvas-drawn sample frames |
| Voice to script | `POST /api/muse/transcribe` | ElevenLabs Scribe v2 (or any Whisper-compatible endpoint) | Browser speech recognition |
| Spoken narration | `POST /api/muse/speak` | ElevenLabs premade voice, Flash model; each sentence cached so it is paid for once, per-session character budget | Browser `speechSynthesis` |
| Voice co-director | `POST /api/agent/session` | ElevenLabs Agent on the orb, server-signed link, studio actions as client tools, live captions | Orb meters the microphone locally |
| Film export | `POST /api/export/animatic` | Local ffmpeg: narrated 1280x720 H.264/AAC MP4, each shot held until its narration ends | Silent browser WebM |

Planning, frames and segmentation are verified in a live run on Meta models, with one scene and one tracked prop so far. Dictation, narration and the voice agent run on ElevenLabs: `muse-voice-transcribe-1.0` did not accept the batch request styles tried, and the agent's default LLM is not Meta. Video generation is opt-in from Generate new media and never starts by itself.

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

# ElevenLabs: dictation, narration and the voice agent
ELEVENLABS_API_KEY=""
TRANSCRIBE_PROVIDER="elevenlabs"
NARRATION_PROVIDER="elevenlabs"
AGENT_PROVIDER="elevenlabs"
ELEVENLABS_AGENT_ID=""

# Meta muse-image for storyboard frames
IMAGE_PROVIDER="openai-compatible"
IMAGE_BASE_URL="https://api.meta.ai/v1"
IMAGE_API_KEY="<your Meta key>"
IMAGE_MODEL="muse-image-1.0"
```

`.env.example` documents the remaining settings, including `NARRATION_VOICE_ID`, `NARRATION_MODEL` and `IMAGE_SIZE`. Paid calls share a per-session request limit (`SAM_MAX_REQUESTS`, default 25 under `npm run dev`), and narration has its own character budget.

---

## 3. Running locally

**Prerequisites:** Node.js 22.12 or newer and npm. MP4 export needs `ffmpeg` and `ffprobe` on `PATH`; without them the app exports a silent WebM.

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

Anchorshot is engineered for complete keyboard-only and screen-reader operation:

| Shortcut | Action |
| :--- | :--- |
| **`[V]`** | Start / Stop Voice Dictation (`muse-voice-transcribe-1.0`) |
| **`[SPACE]`** | Play / Pause Animatic Sequence with synchronized spoken narration |
| **`[←]` / `[→]`** | Navigate Previous / Next Storyboard Shot with automatic status readback |
| **`[1]` – `[4]`** | Jump directly to Shot 1 through Shot 4 |
| **`[N]`** | Narrate active shot visual description and continuity state aloud |
| **`[Y]`** | Accept and apply the proposed `sam-3.1` continuity fix on the active shot |
| **`[B]`** | Compare Before / After `sam-3.1` repair (0 outside-mask pixel drift) |
| **`[M]`** | Toggle the `sam-3.1` segmentation bounding box and alpha mask overlay |
| **`[A]`** | Run full sequence continuity audit (`muse-spark-1.3`) |
| **`[G]`** | Parse transcript and regenerate storyboard frames (`muse-image-1.0`) |
| **`[?]`** | Open / Close the Accessible Keyboard & Voice Command Reference modal |

### Example Voice / Text Directives
Speak via `[V]` or type into the **Direct Voice / Text Command** input:
- `"Fix continuity mismatch in Shot 2 using SAM 3.1"`
- `"Change continuity rule: cup color must be emerald"`
- `"Narrate all shots and continuity status"`

## Free local GPU generation

See [Local AI setup and in-app testing](docs/LOCAL_AI_GENERATION.md). The shot inspector can generate actual images and short videos using the installed local models without hackathon credits. The original sample storyboard controls remain available.
