#!/usr/bin/env python3
"""
primevoice_test.py - Funesterie PrimeVoice bench

Exploratory audio metric for checking whether a normalized c7 frequency grid
is more stable across several versions of the same voice than two baselines:
equal temperament and a fixed random grid.

This is not a proof of voice quality. It is a repeatable comparison tool.

Usage:
    python tools/audio/primevoice_test.py clean.wav noisy.wav compressed.mp3 --json

Dependencies:
    pip install numpy scipy soundfile
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, stft


PHI = (1 + math.sqrt(5)) / 2
JHI = math.pi / 2 - PHI
C7 = abs(JHI) / PHI
N_MODES = 50
SR_TARGET = 16000
NPERSEG = 512


def load_mono(path: Path, sr: int = SR_TARGET) -> np.ndarray:
    data, file_sr = sf.read(str(path), always_2d=True)
    signal = data.mean(axis=1).astype(np.float32)
    if file_sr == sr:
        return signal

    gcd = math.gcd(int(file_sr), int(sr))
    up = sr // gcd
    down = file_sr // gcd
    return resample_poly(signal, up, down).astype(np.float32)


def mean_spectrum(signal: np.ndarray, sr: int = SR_TARGET) -> tuple[np.ndarray, np.ndarray]:
    if signal.size < 16:
        raise ValueError("audio_too_short")
    freqs, _, zxx = stft(signal, fs=sr, nperseg=min(NPERSEG, signal.size))
    power = np.mean(np.abs(zxx) ** 2, axis=1)
    freqs_norm = freqs / (sr / 2)
    return freqs_norm, power


def build_grid(step: float, n: int = N_MODES) -> np.ndarray:
    modes = np.array([(k + 1) * step for k in range(n)], dtype=np.float64)
    return modes[modes <= 1.0]


def score_grid(freqs_norm: np.ndarray, power: np.ndarray, grid: np.ndarray, label: str) -> dict:
    mask = power > 0
    f_used = freqs_norm[mask]
    p_used = power[mask]
    if f_used.size == 0 or p_used.sum() <= 0:
        return {"grid": label, "step": float(grid[0]), "w_mean_dist": None, "coherence": 0.0, "top_modes_hz": []}

    dist = np.min(np.abs(f_used[:, None] - grid[None, :]), axis=1)
    step = float(grid[0])
    weighted = float(np.average(dist, weights=p_used))
    coherence = float(np.clip(1.0 - weighted / step, 0, 1))

    activated = dist < (step / 4)
    top_modes_hz: list[int] = []
    if activated.any():
        top_freqs = f_used[activated]
        top_power = p_used[activated]
        order = np.argsort(top_power)[::-1]
        top_modes_hz = [round(float(top_freqs[i]) * (SR_TARGET / 2)) for i in order[:5]]

    return {
        "grid": label,
        "step": round(step, 8),
        "w_mean_dist": round(weighted, 8),
        "coherence": round(coherence, 5),
        "top_modes_hz": top_modes_hz,
    }


def analyze_file(path: Path) -> dict:
    signal = load_mono(path)
    freqs, power = mean_spectrum(signal)
    rng = np.random.default_rng(42)
    return {
        "file": str(path),
        "duration_sec": round(signal.size / SR_TARGET, 3),
        "c7": score_grid(freqs, power, build_grid(C7), "c7"),
        "equal_temperament": score_grid(freqs, power, build_grid(1 / 12), "1/12"),
        "random": score_grid(freqs, power, np.sort(rng.uniform(0, 1, N_MODES)), "random"),
    }


def compare(results: list[dict]) -> dict:
    summary = {}
    for key in ("c7", "equal_temperament", "random"):
        scores = np.array([float(item[key]["coherence"]) for item in results], dtype=np.float64)
        summary[key] = {
            "mean": round(float(scores.mean()), 5),
            "sigma": round(float(scores.std()), 5),
        }
    sigmas = {key: value["sigma"] for key, value in summary.items()}
    winner = min(sigmas, key=sigmas.get)
    summary["winner"] = winner
    summary["primevoice_v2_candidate"] = winner == "c7"
    return summary


def print_human(results: list[dict], summary: dict | None) -> None:
    print("PrimeVoice bench")
    print(f"phi={PHI:.10f} jhi={JHI:.10f} c7={C7:.10f}")
    print("c7 modes Hz:", ", ".join(f"{n * C7 * (SR_TARGET / 2):.1f}" for n in range(1, 8)))
    for result in results:
        print("\n" + "-" * 72)
        print(f"file: {result['file']} ({result['duration_sec']}s)")
        for key in ("c7", "equal_temperament", "random"):
            grid = result[key]
            print(
                f"{grid['grid']:>8}  coherence={grid['coherence']:.5f}  "
                f"dist={grid['w_mean_dist']}  top_hz={grid['top_modes_hz']}"
            )
    if summary:
        print("\nInter-condition stability")
        for key in ("c7", "equal_temperament", "random"):
            item = summary[key]
            print(f"{key:>18}  mean={item['mean']:.5f}  sigma={item['sigma']:.5f}")
        print(f"winner={summary['winner']} primevoice_v2_candidate={summary['primevoice_v2_candidate']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    results = [analyze_file(path) for path in args.files]
    summary = compare(results) if len(results) >= 2 else None
    payload = {
        "schema": "funesterie.primevoice.bench.v1",
        "constants": {"phi": PHI, "jhi": JHI, "c7": C7, "sample_rate": SR_TARGET},
        "results": results,
        "summary": summary,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_human(results, summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
