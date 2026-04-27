"""Pre-render screenshot pipeline using gstack /browse.

Parses `# ASSET: <slug> | <url> | viewport=WxH | clip=<css>` comments out of a
scene file, fetches each via gstack browse, caches as PNG. At render time
the scene calls `asset(slug)` for the local path.

Usage:
    python -m lib.visuals prefetch path/to/scene.py
"""

from __future__ import annotations
import argparse
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass

CACHE_DIR = pathlib.Path(__file__).resolve().parent.parent / ".cache" / "visuals"
ASSET_RE = re.compile(
    r"#\s*ASSET:\s*([^|]+)\|([^|]+)(?:\|viewport=(\d+x\d+))?(?:\|clip=([^|\n]+))?"
)


@dataclass
class AssetSpec:
    slug: str
    url: str
    viewport: str = "1920x1080"
    clip: str | None = None

    @property
    def cache_key(self) -> str:
        raw = f"{self.url}|{self.viewport}|{self.clip or ''}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    @property
    def cache_path(self) -> pathlib.Path:
        return CACHE_DIR / f"{self.cache_key}.png"


def collect_manifest(scene_file: pathlib.Path) -> list[AssetSpec]:
    out: list[AssetSpec] = []
    for line in scene_file.read_text().splitlines():
        m = ASSET_RE.search(line)
        if not m:
            continue
        slug, url, vp, clip = m.groups()
        out.append(
            AssetSpec(
                slug.strip(),
                url.strip(),
                vp or "1920x1080",
                clip.strip() if clip else None,
            )
        )
    return out


def asset(slug: str, scene_file: str | None = None) -> str:
    if scene_file:
        for spec in collect_manifest(pathlib.Path(scene_file)):
            if spec.slug == slug:
                if not spec.cache_path.exists():
                    raise FileNotFoundError(
                        f"Asset '{slug}' not pre-fetched. Run: "
                        f"python -m lib.visuals prefetch {scene_file}"
                    )
                return str(spec.cache_path)
    raise KeyError(f"Asset slug '{slug}' not found in manifest.")


def _capture_via_gstack(spec: AssetSpec) -> bool:
    if not shutil.which("gstack"):
        return False
    # Confirm exact subcommand/flags via `gstack browse --help` before
    # finalizing — adjust if your gstack version differs.
    cmd = [
        "gstack",
        "browse",
        "screenshot",
        spec.url,
        "--viewport",
        spec.viewport,
        "--output",
        str(spec.cache_path),
    ]
    if spec.clip:
        cmd += ["--clip", spec.clip]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return spec.cache_path.exists()
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"[visuals] gstack failed for {spec.slug}: {e.stderr}\n")
        return False


def prefetch(scene_file: pathlib.Path) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    specs = collect_manifest(scene_file)
    if not specs:
        print(f"[visuals] no # ASSET: manifest in {scene_file}")
        return
    missing: list[AssetSpec] = []
    for spec in specs:
        if spec.cache_path.exists():
            print(f"[visuals] cached {spec.slug} -> {spec.cache_path.name}")
            continue
        if _capture_via_gstack(spec):
            print(f"[visuals] captured {spec.slug} -> {spec.cache_path.name}")
        else:
            missing.append(spec)
    if missing:
        print("\n[visuals] MANUAL CAPTURE NEEDED — gstack unavailable or failed:")
        for spec in missing:
            print(
                f"  - {spec.slug}: open {spec.url} at {spec.viewport}, "
                f"save PNG to: {spec.cache_path}"
            )
        sys.exit(1)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    pf = sub.add_parser("prefetch")
    pf.add_argument("scene_file")
    args = p.parse_args()
    if args.cmd == "prefetch":
        prefetch(pathlib.Path(args.scene_file).resolve())
