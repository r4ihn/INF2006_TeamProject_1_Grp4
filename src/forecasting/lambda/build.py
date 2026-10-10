"""Builds the forecast Lambda's deployment package: `npm run lambda:build`.

Works the same on Windows, macOS and Linux: pip downloads the *Linux* (x86_64, Python 3.13)
builds of the pinned packages, so nothing is compiled and nothing from this computer ends up
in the package. Output: dist/lambda/forecast-lambda-<hash>.zip (upload it to S3; the hash in
the name changes whenever the contents do, so CloudFormation sees a new version).

What goes in:
  cafestock_forecast/        the forecasting code (same as on the laptop)
  lightgbm, numpy, scipy, pg8000, …   from forecasting/lambda/requirements.txt
  lib/libgomp.so.1           OpenMP, which LightGBM needs and Lambda's base image may lack
                             (taken from scikit-learn's Linux wheel; Lambda searches lib/)
  selftest/                  the Task 8b demand snapshot, for the {"selfTest": true} event
  rds-global-bundle.pem      Amazon RDS certificates, to verify the database (Task 11)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # src/ (the runnable project)
PROJECT = ROOT.parent  # the submission root: data/, analytics/, evidence/ live here
OUT = ROOT / "dist" / "lambda"
CACHE = OUT / ".downloads"  # wheels are downloaded once and reused
STAGE = OUT / "package"

PYTHON = "3.13"  # must match the template's Runtime: python3.13
PLATFORMS = ["manylinux_2_28_x86_64", "manylinux_2_17_x86_64", "manylinux2014_x86_64"]
# OpenMP for LightGBM: scikit-learn's Linux wheel carries a portable copy (needs glibc 2.17+)
GOMP_WHEEL = "scikit-learn==1.9.1"
RDS_BUNDLE_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
LAMBDA_UNZIPPED_LIMIT = 262_144_000  # 250 MB, AWS's limit for a zip-based function
SNAPSHOT = "demand_2025-03-23.csv"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # same timestamps every build → same hash for same contents


def say(msg: str) -> None:
    print(msg, flush=True)


def pip_download(args: list[str], dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "pip", "download", "--disable-pip-version-check",
        "--only-binary=:all:", "--no-deps",
        *[f"--platform={p}" for p in PLATFORMS],
        f"--python-version={PYTHON}", "--implementation=cp", "--abi=cp313", "--abi=abi3", "--abi=none",
        "--dest", str(dest), *args,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-2000:] + result.stderr[-2000:])
        raise SystemExit("pip couldn't download the Linux packages (see above). Are you online?")


def requirements() -> list[str]:
    lines = (HERE / "requirements.txt").read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]


def wheel_for(req: str, folder: Path) -> Path:
    name, version = req.split("==")
    stem = name.lower().replace("-", "_")
    matches = [w for w in folder.glob("*.whl") if w.name.lower().startswith(f"{stem}-{version}-")]
    if len(matches) != 1:
        raise SystemExit(f"Expected one wheel for {req} in {folder}, found {len(matches)}.")
    return matches[0]


def unpack_wheel(wheel: Path, into: Path) -> None:
    with zipfile.ZipFile(wheel) as z:
        for info in z.infolist():
            parts = Path(info.filename).parts
            # tests aren't imported at run time and are a large part of numpy/scipy
            if "tests" in parts[:-1] and parts[0] in ("numpy", "scipy"):
                continue
            z.extract(info, into)


def fetch_rds_bundle() -> Path | None:
    target = CACHE / "rds-global-bundle.pem"
    if target.exists():
        return target
    try:
        with urllib.request.urlopen(RDS_BUNDLE_URL, timeout=20) as r:
            data = r.read()
        if b"BEGIN CERTIFICATE" not in data:
            raise ValueError("not a certificate bundle")
        target.write_bytes(data)
        return target
    except Exception as err:  # noqa: BLE001 — only needed once the database is on RDS (Task 11)
        say(f"  ! Couldn't download the RDS certificate bundle ({err}).")
        say("    The package still works for the self-test; build again when online before Task 11.")
        return None


def build_zip(stage: Path) -> tuple[bytes, int, int]:
    """A deterministic zip of `stage`: sorted, fixed timestamps, readable permissions."""
    files = sorted(p for p in stage.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    unzipped = 0
    tmp = OUT / "package.zip.part"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            rel = f.relative_to(stage).as_posix()
            info = zipfile.ZipInfo(rel, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16  # regular file, rw-r--r-- (Lambda needs readable)
            data = f.read_bytes()
            unzipped += len(data)
            z.writestr(info, data, compresslevel=9)
    blob = tmp.read_bytes()
    tmp.unlink()
    return blob, unzipped, len(files)


def local_check(zip_path: Path) -> None:
    """On Linux with Python 3.13, run the self-test from the unzipped package with nothing
    else on the path — as close to Lambda as this computer gets."""
    python = shutil.which("python3.13")
    if sys.platform != "linux" or not python:
        say("  Local check skipped (needs Linux with Python 3.13) — run the self-test in Lambda instead.")
        return
    check = OUT / "check"
    shutil.rmtree(check, ignore_errors=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(check)
    code = (
        "import json, cafestock_forecast.aws_lambda as h;"
        "r = h.handler({'selfTest': True}, None);"
        "maps = open('/proc/self/maps').read();"
        "print('RESULT', json.dumps({'message': r['message'], 'python': r['python'],"
        " 'libgomp': [l.split()[-1] for l in maps.splitlines() if 'libgomp' in l][:1]}))"
    )
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(check),
        "LD_LIBRARY_PATH": str(check / "lib"),
        "MODEL_PATH": str(PROJECT / "analytics" / "models" / "lgbm-v1" / "model.txt"),
    }
    # -S: no site-packages from this computer, only the package (like Lambda's /var/task)
    result = subprocess.run([python, "-S", "-c", code], env=env, capture_output=True, text=True, cwd=check)
    shutil.rmtree(check, ignore_errors=True)
    line = next((l for l in result.stdout.splitlines() if l.startswith("RESULT ")), None)
    if result.returncode != 0 or not line:
        sys.stderr.write(result.stderr[-3000:])
        raise SystemExit("The unzipped package failed its self-test (see above).")
    info = json.loads(line[7:])
    say(f"  Local check (Python {info['python']}, package only): {info['message']}")
    say(f"  OpenMP loaded from: {info['libgomp'][0] if info['libgomp'] else 'the system'}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="npm run lambda:build --")
    p.add_argument("--no-check", action="store_true", help="skip the local self-test of the package")
    args = p.parse_args(argv)

    say(f"Building the forecast Lambda package (Linux x86_64, Python {PYTHON})…")
    reqs = requirements()
    wheels = CACHE / "wheels"
    missing = [r for r in reqs if not any(wheels.glob(f"{r.split('==')[0].lower().replace('-', '_')}-{r.split('==')[1]}-*.whl"))]
    if missing:
        say(f"  Downloading {len(missing)} package(s) (once; about 55 MB)…")
        pip_download(missing, wheels)
    gomp_dir = CACHE / "openmp"
    if not any(gomp_dir.glob("*.whl")):
        say("  Downloading OpenMP for LightGBM (from scikit-learn's Linux wheel)…")
        pip_download([GOMP_WHEEL], gomp_dir)

    shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir(parents=True)
    for req in reqs:
        unpack_wheel(wheel_for(req, wheels), STAGE)

    with zipfile.ZipFile(wheel_for(GOMP_WHEEL, gomp_dir)) as z:
        [gomp] = [n for n in z.namelist() if "/libgomp" in n]
        (STAGE / "lib").mkdir()
        (STAGE / "lib" / "libgomp.so.1").write_bytes(z.read(gomp))

    shutil.copytree(
        ROOT / "forecasting" / "cafestock_forecast", STAGE / "cafestock_forecast",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    (STAGE / "selftest").mkdir()
    shutil.copy2(PROJECT / "analytics" / "snapshots" / SNAPSHOT, STAGE / "selftest" / SNAPSHOT)
    shutil.copy2(PROJECT / "data" / "ingredients.csv", STAGE / "selftest" / "ingredients.csv")
    bundle = fetch_rds_bundle()
    if bundle:
        shutil.copy2(bundle, STAGE / "rds-global-bundle.pem")

    blob, unzipped, count = build_zip(STAGE)
    if unzipped > LAMBDA_UNZIPPED_LIMIT:
        raise SystemExit(f"Unzipped size {unzipped / 1e6:.0f} MB is over Lambda's 250 MB limit.")
    digest = hashlib.sha256(blob).hexdigest()
    for old in OUT.glob("forecast-lambda-*.zip"):
        old.unlink()
    zip_path = OUT / f"forecast-lambda-{digest[:12]}.zip"
    zip_path.write_bytes(blob)
    shutil.rmtree(STAGE, ignore_errors=True)
    (OUT / "latest.json").write_text(
        json.dumps(
            {
                "file": zip_path.name,
                "sha256": digest,
                "bytes": len(blob),
                "unzippedBytes": unzipped,
                "files": count,
                "python": PYTHON,
                "packages": reqs,
                "rdsBundle": bool(bundle),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    say(f"  Package   {zip_path.relative_to(ROOT).as_posix()}")
    say(f"  Size      {len(blob) / 1e6:.1f} MB zipped, {unzipped / 1e6:.0f} MB unzipped (limit 250 MB), {count:,} files")
    say(f"  SHA-256   {digest}")
    if not args.no_check:
        local_check(zip_path)
    say("\nNext: upload it to your S3 bucket's lambda/ folder — see docs/aws-forecast-setup.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
