import modal
from fastapi import FastAPI, Header, Response, HTTPException
from pydantic import BaseModel
import hmac
import io
import os
import tempfile

app = modal.App("anchorshot-video")

# Persistent volume for HuggingFace model weights cache
model_volume = modal.Volume.from_name("ltx-model-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]>=0.111.0",
        "pydantic>=2.0",
        "torch>=2.4.0",
        "diffusers>=0.31.0",
        "transformers>=4.45.0",
        "accelerate>=0.33.0",
        "sentencepiece>=0.2.0",
        "imageio[ffmpeg]>=2.34.0",
        "safetensors>=0.4.0",
        "huggingface_hub>=0.25.0",
    )
)

web_app = FastAPI(title="AnchorShot LTX-Video Serverless API")

# Every clip uses paid GPU time, so only the AnchorShot server may ask for one.
FPS = 25

def require_key(authorization: str | None):
    expected = f"Bearer {os.environ['VIDEO_ENDPOINT_KEY']}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")

class VideoPromptRequest(BaseModel):
    prompt: str
    negative_prompt: str = "low quality, worst quality, deformed, distorted, blurry, jerky movement"
    num_frames: int = 97  # (8 * k + 1) for LTX-Video; 97 frames is about 4 seconds at 25 fps
    width: int = 704     # Divisible by 32
    height: int = 480    # Divisible by 32
    num_inference_steps: int = 25
    seed: int = 42

# Global cached pipeline
cached_pipe = None

def get_pipeline():
    global cached_pipe
    if cached_pipe is not None:
        return cached_pipe

    import torch
    from diffusers import LTXPipeline

    print("[Modal LTX] Loading Lightricks/LTX-Video in bfloat16...")
    pipe = LTXPipeline.from_pretrained(
        "Lightricks/LTX-Video",
        torch_dtype=torch.bfloat16,
    )
    pipe.to("cuda")

    cached_pipe = pipe
    print("[Modal LTX] Pipeline loaded successfully on GPU.")
    return cached_pipe

@web_app.get("/")
def health():
    return {
        "status": "online",
        "service": "AnchorShot Serverless Cloud Video Generator",
        "partner": "modal.com",
        "gpu": "NVIDIA A10G",
        "model": "Lightricks/LTX-Video",
        "pipeline": "LTXPipeline (bfloat16)",
        "ready": True
    }

@web_app.post("/")
@web_app.post("/generate")
def generate_video(req: VideoPromptRequest, authorization: str | None = Header(default=None)):
    require_key(authorization)
    import torch
    from diffusers.utils import export_to_video

    pipe = get_pipeline()
    generator = torch.Generator("cuda").manual_seed(req.seed)

    # Ensure frame count is 8k + 1 (LTX requirement)
    num_frames = min(req.num_frames, 193)
    if (num_frames - 1) % 8 != 0:
        num_frames = ((num_frames - 1) // 8) * 8 + 1
        if num_frames < 9:
            num_frames = 17

    # Ensure width and height are divisible by 32
    width = (req.width // 32) * 32
    height = (req.height // 32) * 32

    print(f"[Modal LTX] Generating video: '{req.prompt}' (frames={num_frames}, steps={req.num_inference_steps}, {width}x{height})")
    output = pipe(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=width,
        height=height,
        num_frames=num_frames,
        num_inference_steps=req.num_inference_steps,
        generator=generator,
    )
    frames = output.frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        export_to_video(frames, tmp_path, fps=FPS)
        with open(tmp_path, "rb") as f:
            video_bytes = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    print(f"[Modal LTX] Generation complete: {len(video_bytes)} bytes.")
    return Response(
        content=video_bytes,
        media_type="video/mp4",
        headers={"Content-Disposition": 'inline; filename="generated-video.mp4"'},
    )

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/cache/huggingface": model_volume},
    env={"HF_HOME": "/cache/huggingface"},
    timeout=600,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("anchorshot-video")],
)
@modal.asgi_app()
def fastapi_app():
    return web_app
