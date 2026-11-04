import base64
import gc
import hmac
import io
import os
import pathlib
import tempfile
import threading

import modal
from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel

app = modal.App("anchorshot-wan")
volume = modal.Volume.from_name("wan-model-cache", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.11").apt_install("ffmpeg").pip_install(
    "fastapi[standard]>=0.111.0", "pydantic>=2.0", "torch>=2.4.0", "diffusers>=0.35.0", "transformers>=4.51.0,<5",
    "accelerate>=1.0.0", "ftfy", "sentencepiece", "imageio[ffmpeg]", "safetensors", "huggingface_hub", "pillow",
)
web_app = FastAPI(title="AnchorShot Wan 2.2")
# Wan 2.2 TI2V is designed for 24 fps; its frames are encoded at 25 without duplication.
FPS = 25
cached_pipe = None
cached_t2v_pipe = None


class ClipRequest(BaseModel):
    prompt: str
    image: str | None = None  # optional base64 start frame
    seed: int = 7
    num_frames: int = 97  # 4k + 1; about 3.9 seconds at 25 fps


def require_key(authorization: str | None):
    # Every clip uses paid GPU time, so only the AnchorShot server may ask for one.
    expected = f"Bearer {os.environ['VIDEO_ENDPOINT_KEY']}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def get_pipeline():
    global cached_pipe
    if cached_pipe is None:
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

        name = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
        vae = AutoencoderKLWan.from_pretrained(name, subfolder="vae", torch_dtype=torch.float32)
        cached_pipe = WanImageToVideoPipeline.from_pretrained(name, vae=vae, torch_dtype=torch.bfloat16).to("cuda")
        # Decoding a whole clip at once can exhaust the GPU after the render succeeds.
        cached_pipe.vae.enable_tiling()
        cached_pipe.vae.enable_slicing()
    return cached_pipe


def get_t2v_pipeline():
    global cached_t2v_pipe
    if cached_t2v_pipe is None:
        from diffusers import WanPipeline

        pipe = get_pipeline()
        cached_t2v_pipe = WanPipeline(
            tokenizer=pipe.tokenizer,
            text_encoder=pipe.text_encoder,
            transformer=pipe.transformer,
            vae=pipe.vae,
            scheduler=pipe.scheduler,
        )
    return cached_t2v_pipe


# A cancelled request keeps running on the GPU, so renders must never overlap.
render_lock = threading.Lock()


@web_app.post("/generate")
def generate(req: ClipRequest, authorization: str | None = Header(default=None)):
    require_key(authorization)
    import torch
    from diffusers.utils import export_to_video
    from PIL import Image

    num_frames = ((min(max(req.num_frames, 17), 121) - 1) // 4) * 4 + 1
    with render_lock:
        try:
            gen = torch.Generator("cuda").manual_seed(req.seed)
            if req.image:
                start = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB").resize((1280, 704))
                frames = get_pipeline()(image=start, prompt=req.prompt, height=704, width=1280, num_frames=num_frames,
                                        num_inference_steps=40, guidance_scale=5.0,
                                        generator=gen).frames[0]
            else:
                frames = get_t2v_pipeline()(prompt=req.prompt, height=704, width=1280, num_frames=num_frames,
                                            num_inference_steps=40, guidance_scale=5.0,
                                            generator=gen).frames[0]
        finally:
            gc.collect()
            torch.cuda.empty_cache()
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        export_to_video(frames, tmp.name, fps=FPS)
        return Response(content=pathlib.Path(tmp.name).read_bytes(), media_type="video/mp4")


@app.function(image=image, gpu="A100-40GB", volumes={"/cache": volume}, env={"HF_HOME": "/cache"},
              timeout=1200, scaledown_window=60, secrets=[modal.Secret.from_name("anchorshot-wan-endpoint")])
@modal.asgi_app()
def fastapi_app():
    return web_app
