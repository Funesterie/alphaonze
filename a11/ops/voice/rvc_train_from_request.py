import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


SAMPLE_RATE_HZ = {
    "32k": 32000,
    "40k": 40000,
    "48k": 48000,
}


def run_python(rvc_root: Path, script: str, args: list[str], *, env: dict[str, str]) -> None:
    command = [sys.executable, script, *args]
    print("RVC:", " ".join(command), flush=True)
    subprocess.run(command, cwd=str(rvc_root), env=env, check=True)


def cpu_safe_env(gpu: str) -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    if gpu.lower() in {"", "cpu", "none", "-1"}:
        env["CUDA_VISIBLE_DEVICES"] = "-1"
        env["NVIDIA_VISIBLE_DEVICES"] = "none"
    else:
        env["CUDA_VISIBLE_DEVICES"] = gpu
    return env


def copy_config(rvc_root: Path, exp_dir: Path, sample_rate: str, version: str) -> Path:
    # RVC WebUI uses v1/40k.json even for v2 40k training.
    config_version = "v1" if sample_rate == "40k" else version
    source = rvc_root / "configs" / config_version / f"{sample_rate}.json"
    if not source.exists():
        raise FileNotFoundError(f"Missing RVC config: {source}")
    exp_dir.mkdir(parents=True, exist_ok=True)
    target = exp_dir / "config.json"
    shutil.copy2(source, target)
    return target


def build_filelist(rvc_root: Path, exp_dir: Path, sample_rate: str, version: str) -> Path:
    gt_dir = exp_dir / "0_gt_wavs"
    feature_dir = exp_dir / ("3_feature256" if version == "v1" else "3_feature768")
    f0_dir = exp_dir / "2a_f0"
    f0_nsf_dir = exp_dir / "2b-f0nsf"

    lines: list[str] = []
    for gt in sorted(gt_dir.glob("*.wav")):
        stem = gt.stem
        feature = feature_dir / f"{stem}.npy"
        f0 = f0_dir / f"{gt.name}.npy"
        f0_nsf = f0_nsf_dir / f"{gt.name}.npy"
        if feature.exists() and f0.exists() and f0_nsf.exists():
            lines.append("|".join([gt.as_posix(), feature.as_posix(), f0.as_posix(), f0_nsf.as_posix(), "0"]))

    if not lines:
        raise RuntimeError(f"No complete RVC training rows found in {exp_dir}")

    mute_root = rvc_root / "logs" / "mute"
    mute_gt = mute_root / "0_gt_wavs" / f"mute{sample_rate}.wav"
    mute_feature = mute_root / feature_dir.name / "mute.npy"
    mute_f0 = mute_root / "2a_f0" / "mute.wav.npy"
    mute_f0_nsf = mute_root / "2b-f0nsf" / "mute.wav.npy"
    if all(item.exists() for item in (mute_gt, mute_feature, mute_f0, mute_f0_nsf)):
        mute_line = "|".join(
            [mute_gt.as_posix(), mute_feature.as_posix(), mute_f0.as_posix(), mute_f0_nsf.as_posix(), "0"]
        )
        lines.extend([mute_line, mute_line])

    filelist = exp_dir / "filelist.txt"
    filelist.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"RVC: filelist rows={len(lines)} path={filelist}", flush=True)
    return filelist


def build_index(exp_dir: Path, exp_name: str, version: str) -> Path:
    import faiss
    import numpy as np

    feature_dir = exp_dir / ("3_feature256" if version == "v1" else "3_feature768")
    arrays = [np.load(path) for path in sorted(feature_dir.glob("*.npy"))]
    if not arrays:
        raise RuntimeError(f"No features found for index in {feature_dir}")

    big = np.concatenate(arrays, axis=0).astype("float32")
    if big.ndim != 2:
        raise RuntimeError(f"Unexpected feature matrix shape: {big.shape}")

    np.random.seed(1234)
    np.random.shuffle(big)
    total_path = exp_dir / "total_fea.npy"
    np.save(total_path, big)

    dimension = big.shape[1]
    rows = big.shape[0]
    if rows < 64:
        index = faiss.IndexFlatL2(dimension)
        index.add(big)
        index_path = exp_dir / f"added_Flat_nprobe_1_{exp_name}_{version}.index"
    else:
        n_ivf = max(1, min(256, int(16 * (rows**0.5))))
        index = faiss.index_factory(dimension, f"IVF{n_ivf},Flat")
        faiss.extract_index_ivf(index).nprobe = 1
        trained_path = exp_dir / f"trained_IVF{n_ivf}_Flat_nprobe_1_{exp_name}_{version}.index"
        index.train(big)
        faiss.write_index(index, str(trained_path))
        index.add(big)
        index_path = exp_dir / f"added_IVF{n_ivf}_Flat_nprobe_1_{exp_name}_{version}.index"

    faiss.write_index(index, str(index_path))
    print(f"RVC: index rows={rows} dim={dimension} path={index_path}", flush=True)
    return index_path


def copy_latest_model(rvc_root: Path, exp_name: str, exp_dir: Path, target: Path) -> Path:
    weights_dir = rvc_root / "assets" / "weights"
    candidates = sorted(weights_dir.glob(f"{exp_name}*.pth"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        candidates = sorted(exp_dir.glob("G_*.pth"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No trained model generated for {exp_name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(candidates[0], target)
    return candidates[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="Train one Funesterie RVC persona from a training-request.json file.")
    parser.add_argument("--request", required=True)
    parser.add_argument("--rvc-root", default="D:/agent-bus/voice/RVC-WebUI")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--save-epoch", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--gpu", default="cpu")
    parser.add_argument("--sample-rate", default="40k")
    parser.add_argument("--version", default="v2")
    parser.add_argument("--f0-method", default="rmvpe")
    parser.add_argument("--cache-gpu", action="store_true")
    args = parser.parse_args()

    request_path = Path(args.request).resolve()
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    rvc_root = Path(args.rvc_root).resolve()
    exp_name = f"funesterie-{request['persona']}"
    exp_dir = rvc_root / "logs" / exp_name
    chunks_dir = Path(request["chunksDir"]).resolve()
    expected_model = Path(request["expectedModel"]).resolve()
    expected_index = Path(request["expectedIndex"]).resolve()

    if not chunks_dir.exists():
        raise FileNotFoundError(f"Chunks directory missing: {chunks_dir}")
    if args.sample_rate not in SAMPLE_RATE_HZ:
        raise ValueError(f"Unsupported sample rate: {args.sample_rate}")

    pretrained_g = rvc_root / "assets" / "pretrained_v2" / f"f0G{args.sample_rate}.pth"
    pretrained_d = rvc_root / "assets" / "pretrained_v2" / f"f0D{args.sample_rate}.pth"
    for item in (pretrained_g, pretrained_d, rvc_root / "assets" / "hubert" / "hubert_base.pt"):
        if not item.exists():
            raise FileNotFoundError(f"Missing RVC asset: {item}")

    env = cpu_safe_env(args.gpu)
    status = {
        "schema": "funesterie.rvc-training-result.v1",
        "persona": request["persona"],
        "expName": exp_name,
        "request": str(request_path),
        "expectedModel": str(expected_model),
        "expectedIndex": str(expected_index),
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "gpu": args.gpu,
        "sampleRate": args.sample_rate,
        "version": args.version,
        "f0Method": args.f0_method,
        "steps": [],
    }

    try:
        copy_config(rvc_root, exp_dir, args.sample_rate, args.version)
        status["steps"].append("config")

        run_python(
            rvc_root,
            "infer/modules/train/preprocess.py",
            [str(chunks_dir), str(SAMPLE_RATE_HZ[args.sample_rate]), str(args.threads), str(exp_dir), "False", "3.7"],
            env=env,
        )
        status["steps"].append("preprocess")

        run_python(
            rvc_root,
            "infer/modules/train/extract/extract_f0_print.py",
            [str(exp_dir), str(args.threads), args.f0_method],
            env=env,
        )
        status["steps"].append("extract_f0")

        for part in range(max(1, args.threads)):
            run_python(
                rvc_root,
                "infer/modules/train/extract_feature_print.py",
                ["cpu", str(max(1, args.threads)), str(part), str(exp_dir), args.version, "false"],
                env=env,
            )
        status["steps"].append("extract_features")

        build_filelist(rvc_root, exp_dir, args.sample_rate, args.version)
        status["steps"].append("filelist")

        gpu_arg = "cpu" if args.gpu.lower() in {"", "cpu", "none", "-1"} else args.gpu
        run_python(
            rvc_root,
            "infer/modules/train/train.py",
            [
                "-e",
                exp_name,
                "-sr",
                args.sample_rate,
                "-f0",
                "1",
                "-bs",
                str(args.batch_size),
                "-g",
                gpu_arg,
                "-te",
                str(args.epochs),
                "-se",
                str(args.save_epoch),
                "-pg",
                str(pretrained_g),
                "-pd",
                str(pretrained_d),
                "-l",
                "1",
                "-c",
                "1" if args.cache_gpu else "0",
                "-sw",
                "1",
                "-v",
                args.version,
            ],
            env=env,
        )
        status["steps"].append("train")

        index_source = build_index(exp_dir, exp_name, args.version)
        expected_index.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(index_source, expected_index)

        model_source = copy_latest_model(rvc_root, exp_name, exp_dir, expected_model)
        status["ok"] = True
        status["modelSource"] = str(model_source)
        status["indexSource"] = str(index_source)
    except Exception as exc:
        status["ok"] = False
        status["error"] = str(exc)
        raise
    finally:
        result_path = request_path.with_name("training-result.json")
        result_path.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
