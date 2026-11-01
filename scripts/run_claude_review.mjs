import { execSync } from 'child_process';

const prompt = `You are Claude Opus reviewing the Anchorshot codebase.
Context:
- Live Meta API (https://api.meta.ai/v1) is available with models: muse-spark-1.3, muse-image-1.0, muse-wonder-1.0, sam-3.1.
- In CleanStudio.tsx, the Storyboard Canvas currently only renders a still image (<SceneTransition source={shot.currentImageUrl} />) even when a video has been generated.
- The user states: "I want to render the video/image using meta api and Pipeline Phase, then tell us what is not in the code because in the canvas this video should be generated after the voice prompt and ready to preview".

Review and answer clearly:
1. Exact Code Gaps: What is NOT in the code right now preventing the video from being generated and mounted directly in the canvas after the voice prompt?
2. Step-by-Step Architecture: How should the pipeline flow from Voice Prompt -> Meta Muse Spark 1.3 -> Meta Muse Image 1.0 -> Meta Wonder 1.0 / Video Pipeline -> Storyboard Canvas auto-playing the video preview?
3. Exact code changes needed in CleanStudio.tsx, App.tsx, and metaModels.ts.`;

try {
  const out = execSync(`claude --dangerously-skip-permissions -p "${prompt.replace(/\r?\n/g, ' ').replace(/"/g, '\\"')}"`, {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    timeout: 90000,
  });
  console.log(out);
} catch (err) {
  console.error(err.stdout || err.message);
}
