"""Apply prime-spiral modulation to a PCM WAV file.

This is a safe A/B listening experiment. It does not need numpy/scipy and only
supports uncompressed PCM WAV files. For production-grade spectral morphing,
replace this with an STFT/WORLD stage later.
"""

from __future__ import annotations

import argparse
import math
import pathlib
import sys
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import prime_spiral_morph as psm


def _sample_to_float(raw: bytes, width: int) -> float:
    if width == 1:
        return (raw[0] - 128) / 128.0
    return int.from_bytes(raw, "little", signed=True) / float(1 << ((8 * width) - 1))


def _float_to_sample(value: float, width: int) -> bytes:
    clipped = max(-1.0, min(1.0, value))
    if width == 1:
        return bytes([max(0, min(255, int(round((clipped * 127.0) + 128.0))))])
    limit = (1 << ((8 * width) - 1)) - 1
    as_int = max(-limit - 1, min(limit, int(round(clipped * limit))))
    return as_int.to_bytes(width, "little", signed=True)


def _rms(raw: bytes, width: int) -> int:
    if not raw:
        return 0
    total = 0.0
    count = 0
    for offset in range(0, len(raw) - width + 1, width):
        value = _sample_to_float(raw[offset : offset + width], width)
        total += value * value
        count += 1
    if not count:
        return 0
    return int(round(math.sqrt(total / count) * 32768))


def apply_morph(
    input_path: pathlib.Path,
    output_path: pathlib.Path,
    mode: str = "hybrid",
    dry_wet: float = 0.18,
    max_db: float = 3.0,
    prime_boost_db: float = 0.75,
    phi: float = psm.PHI,
    j_value: float = 1.0,
    orientation: str = "right",
    frame_ms: float = 20.0,
) -> dict:
    dry_wet = max(0.0, min(1.0, dry_wet))

    with wave.open(str(input_path), "rb") as src:
        params = src.getparams()
        channels = src.getnchannels()
        sample_rate = src.getframerate()
        width = src.getsampwidth()
        frames = src.getnframes()
        if width not in (1, 2, 3, 4):
            raise ValueError(f"unsupported sample width: {width}")
        raw = src.readframes(frames)

    frame_samples = max(1, int(sample_rate * (frame_ms / 1000.0)))
    control_len = max(1, math.ceil(frames / frame_samples))
    curve = psm.control_curve(
        control_len,
        phi=phi,
        j_value=j_value,
        orientation=orientation,
        max_db=max_db,
        prime_boost_db=prime_boost_db,
        mode=mode,
    )

    output = bytearray(len(raw))
    stride = width * channels
    sample_index = 0
    for offset in range(0, len(raw), stride):
        control_index = min(len(curve) - 1, sample_index // frame_samples)
        gain = curve[control_index]
        for channel in range(channels):
            start = offset + (channel * width)
            end = start + width
            dry = _sample_to_float(raw[start:end], width)
            wet = max(-1.0, min(1.0, dry * gain))
            mixed = (dry * (1.0 - dry_wet)) + (wet * dry_wet)
            output[start:end] = _float_to_sample(mixed, width)
        sample_index += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as dst:
        dst.setparams(params)
        dst.writeframes(bytes(output))

    in_rms = _rms(raw, width)
    out_rms = _rms(bytes(output), width)
    return {
        "input": str(input_path),
        "output": str(output_path),
        "mode": mode,
        "dryWet": dry_wet,
        "maxDb": max_db,
        "primeBoostDb": prime_boost_db,
        "frameMs": frame_ms,
        "sampleRate": sample_rate,
        "channels": channels,
        "frames": frames,
        "controlPoints": len(curve),
        "inputRms": in_rms,
        "outputRms": out_rms,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a prime-spiral morphed WAV for A/B listening.")
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--mode", default="hybrid", choices=psm.MODES)
    parser.add_argument("--dry-wet", type=float, default=0.18)
    parser.add_argument("--max-db", type=float, default=3.0)
    parser.add_argument("--prime-boost-db", type=float, default=0.75)
    parser.add_argument("--phi", type=float, default=psm.PHI)
    parser.add_argument("--j", dest="j_value", type=float, default=1.0)
    parser.add_argument("--orientation", default="right", choices=sorted(psm.ORIENTATIONS))
    parser.add_argument("--frame-ms", type=float, default=20.0)
    args = parser.parse_args()

    meta = apply_morph(
        args.input,
        args.output,
        mode=args.mode,
        dry_wet=args.dry_wet,
        max_db=args.max_db,
        prime_boost_db=args.prime_boost_db,
        phi=args.phi,
        j_value=args.j_value,
        orientation=args.orientation,
        frame_ms=args.frame_ms,
    )
    for key, value in meta.items():
        print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
