# AnchorShot

**Direct a film by voice, and get evidence that it stays consistent, even if you can't see the screen.**

AnchorShot is an accessible storyboard and film studio for blind and low-vision filmmakers. You describe a scene out loud, and a voice co-director plans the shots, draws them, turns them into video and reads back what happened. When a prop must stay the same across shots, AnchorShot checks the real pixels with SAM 3.1 instead of asking you to look.

Built for the **Meta Global AI Developer Hackathon**, Indie Developer track, under the **Build for Your World** problem statement.

## Why it exists

AI video tools generate frames, but they assume someone can look at the result. A blind director can't tell whether the jacket turned from emerald to blue in shot three. AnchorShot makes continuity something the software measures and speaks aloud:

1. **A rule:** "the jacket must be emerald" becomes a continuity rule.
2. **A real mask:** SAM 3.1 finds the object in the frame.
3. **A measurement:** the colour is read from the masked pixels and reported out loud. Results stay "uncertain" when the object can't be confirmed.
4. **A contained fix:** a recolour changes only the masked pixels, and the app records how many pixels changed outside the mask.

## How Meta models are used

| Job | Model | Access |
| :--- | :--- | :--- |
| Shot planning, cast briefs, continuity rules | `muse-spark-1.3` | Meta Model API |
| Voice co-director with 14 studio tools | `muse-spark-1.3` | Meta Model API |
| Storyboard frames and video start frames | `muse-image-1.0` | Meta Model API |
| Object masks and colour checks | `sam-3.1` | Meta Model API |
| Speech to text | `muse-voice-transcribe-1.0` | Meta Model API |
| Backup planner | `meta-models/muse-spark-open-1026` | Baseten |

**Not Meta models:** video clips are rendered by **Wan 2.2 on Modal**, starting from each Muse Image frame. Spoken replies use the browser's own voice, and film export uses local ffmpeg.

## What you can do by voice

- **Create:** "Make a film of a courier in a rainy night market, and generate it now."
- **Navigate:** "Open shot two." "Play the film." "Pause." "Read me the storyboard."
- **Set rules and check them:** "The jacket must be emerald." "Check continuity."
- **Change a colour:** "Make the jacket red in shot one."
- **Change an object:** "In shot two, change the bicycle into a motorbike."
- **Redo one scene:** "Remake scene two."
- **Organise:** move shots, change shot lengths, switch takes and workspaces, and export the film.

Changes are read back for your confirmation before they run. The conversation and script stay visible in the left panel, and the main actions have keyboard shortcuts. Press `?` in the app for the list.

## How it works

```text
Voice or text
  -> Muse Voice Transcribe
  -> Muse Spark (voice agent and shot plan)
  -> Muse Image (a start frame per shot, reusing character references)
  -> Wan 2.2 on Modal (25 fps clip, frame rate verified with ffprobe)
  -> SAM 3.1 (masks, colour checks, contained edits)
  -> ffmpeg (exported MP4)
```

Models sit behind small server-side adapters, so API keys never reach the browser. Paid calls share a per-session request limit.

## Run it

**You need:** Node.js 22.12 or newer, plus `ffmpeg` and `ffprobe` on your `PATH`.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4317. With no keys, the app runs with offline sample planning and frames.

To connect the models, create `.env.local` (git-ignored; see [.env.example](.env.example) for more settings):

```dotenv
META_API_KEY="<your Meta key>"
SAM_MAX_REQUESTS="60"

PLANNER_PROVIDER="openai-compatible"
PLANNER_BASE_URL="https://api.meta.ai/v1"
PLANNER_API_KEY="<your Meta key>"
PLANNER_MODEL="muse-spark-1.3"

IMAGE_PROVIDER="openai-compatible"
IMAGE_BASE_URL="https://api.meta.ai/v1"
IMAGE_API_KEY="<your Meta key>"
IMAGE_MODEL="muse-image-1.0"

TRANSCRIBE_PROVIDER="meta"
AGENT_PROVIDER="meta"
```

For video clips, deploy [scripts/modal_wan.py](scripts/modal_wan.py) to Modal, then add:

```dotenv
VIDEO_PROVIDER="modal"
VIDEO_MODEL="Wan 2.2 on Modal"
MODAL_VIDEO_ENDPOINT="<your Modal endpoint>"
MODAL_VIDEO_KEY="<the key stored in the anchorshot-wan-endpoint Modal secret>"
```

Without a video provider, scenes are real Muse Image frames, and exports use camera moves across them.

**Checks:**

```bash
npm run typecheck
npm test
```

## Built during the hackathon

This repository started on **28 October 2026**, during the building period. Its commit history shows the work step by step.

**Built during the event:** the studio UI, voice agent and tools, planner and image adapters, SAM continuity checks and contained recolouring, automatic film flow, Wan and Modal integration, export, and tests.

**Adapted from earlier or third-party work:**
- The shot vocabulary, prompt order, identity lock and cast brief were adapted from the author's earlier project, Fylmer, then ported and extended here. See [src/lib/shotLanguage.ts](src/lib/shotLanguage.ts).
- UI primitives come from open-source libraries, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Current limits

- **Accessibility:** no screen-reader walkthrough or testing with blind filmmakers has been completed yet.
- **Continuity:** checks measure colour and pixel containment. They don't yet verify character identity or spatial continuity.
- **Video edits:** object edits apply to still frames, so an edited video shot needs its clip remade.
- **Speed:** model-backed edits and clips take from about a minute to several minutes, and they aren't instant.
- **Browser tests:** the end-to-end suite still needs updating for the automatic film flow.

More detail is in [the audit notes](docs/FULL_AUDIT.md).

## License

[Apache 2.0](LICENSE). Third-party licenses are in [licenses/](licenses/) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
