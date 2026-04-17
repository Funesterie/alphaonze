# A11 Video Generation

## Overview

`video.generate` reuses the existing A11 image stack:

- Stable Diffusion generate pipeline
- adaptive prompt compiler / image mask runtime
- optional Janus vision analysis for first-frame diagnostics

The current backend is modular and uses `sd-frame-sequence`:

1. compile the user prompt with the existing image prompt engine
2. render a sequence of coherent frames through the SD pipeline
3. assemble the frames with `ffmpeg`
4. return an `mp4` or `gif`

Later, `A11_VIDEO_BACKEND` can be switched to a true text-to-video backend without changing the public intent or route contract.

## Routes

- `POST /api/video/generate`
- `POST /api/tools/generate_video`

Natural-language requests routed through chat can also resolve to `video.generate`.

## Request body

```json
{
  "prompt": "dragon bleu en vol au-dessus des montagnes",
  "durationSeconds": 3,
  "fps": 6,
  "format": "mp4"
}
```

Accepted controls:

- `prompt` or `message`
- `durationSeconds` / `duration_seconds` / `duration`
- `fps`
- `format`: `mp4` or `gif`
- optional `width` / `height`
- optional source media:
  - `sourceImageUrl` / `sourceImagePath`
  - `sourceVideoUrl` / `sourceVideoPath`
  - generic `sourceUrl` / `sourcePath` with `sourceType=image|video`

## Environment

Add or override these variables in `.env.local` or Railway:

```env
A11_VIDEO_ENABLED=true
A11_VIDEO_BACKEND=sd-frame-sequence
A11_VIDEO_DEFAULT_DURATION_SEC=3
A11_VIDEO_MAX_DURATION_SEC=8
A11_VIDEO_DEFAULT_FPS=6
A11_VIDEO_MAX_FPS=12
A11_VIDEO_MAX_RENDER_FRAMES=24
A11_VIDEO_DEFAULT_FORMAT=mp4
A11_VIDEO_FFMPEG_BIN=ffmpeg
A11_VIDEO_FRAME_INIT_STRENGTH=0.28
A11_VIDEO_USE_JANUS_FRAME_ANALYSIS=false
```

## Installation

### ffmpeg

`ffmpeg` must be available on the runtime:

- Windows: install ffmpeg and expose it in `PATH`, or set `A11_VIDEO_FFMPEG_BIN=C:\\path\\to\\ffmpeg.exe`
- Linux/Railway: install ffmpeg in the image, or provide a valid binary path through `A11_VIDEO_FFMPEG_BIN`
- The Railway Docker image in `apps/server/Dockerfile` is expected to ship with `ffmpeg`

### Image backend

Video generation depends on the existing image backend:

- `A11_SD_PROXY_URL`
- or local SD runtime if allowed

### Optional Janus

If you want first-frame diagnostic logs:

```env
A11_VIDEO_USE_JANUS_FRAME_ANALYSIS=true
A11_VISION_PROVIDER=janus
A11_JANUS_ENABLED=true
```

## Notes

- The current implementation favors compatibility and reuse over temporal smoothness.
- Consecutive frames reuse the previous frame as `init_image_url` to keep continuity.
- If a source image or video is provided, A11 uses it to bootstrap the first generated frame.
- This is intentionally isolated from `image.generate`, so image generation behavior stays unchanged.
