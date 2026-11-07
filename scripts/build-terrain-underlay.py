#!/usr/bin/env python3
"""Derive a compact startup underlay without modifying installed terrain."""
import argparse
import hashlib
import io
import json
import re
from pathlib import Path

from PIL import Image


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(root, manifest_path, output):
    root, output = root.resolve(), output.resolve()
    if output == root or output.is_relative_to(root):
        raise ValueError("Output must be separate from the read-only source")
    manifest_file = (root / manifest_path).resolve(strict=True)
    if not manifest_file.is_relative_to(root):
        raise ValueError("Unsafe manifest path")
    source = manifest_file.read_bytes()
    bundle = json.loads(source)
    if not re.fullmatch(r"terrain\.optimized-[a-zA-Z0-9_-]+", bundle["directory"]):
        raise ValueError("Unsafe terrain directory")
    grid = bundle["provenance"]["grid"]
    width, height = grid["columns"] * 8, grid["rows"] * 8
    image = Image.new("RGBA", (width, height), tuple(bundle["oceanColour"]) + (255,))
    for page in bundle["pages"]:
        file = (root / page["path"]).resolve(strict=True)
        if not file.is_relative_to(root) or file != root / page["path"]:
            raise ValueError("Unsafe overview path")
        data = file.read_bytes()
        if len(data) != page["bytes"] or digest(data) != page["sha256"]:
            raise ValueError("Overview integrity mismatch")
        with Image.open(io.BytesIO(data)) as decoded:
            if decoded.size != (256, 256):
                raise ValueError("Invalid overview dimensions")
            reduced = decoded.convert("RGBA").resize((32, 32), Image.Resampling.BILINEAR)
        image.alpha_composite(reduced, (page["x"] * 32, page["y"] * 32))
    encoded = io.BytesIO()
    image.save(encoded, "WEBP", lossless=True, quality=80, method=4, exact=True)
    data = encoded.getvalue()
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.convert("RGBA").tobytes() != image.tobytes():
            raise ValueError("Underlay changed decoded pixels")
    relative = f'{bundle["directory"]}/coarse-{digest(data)[:16]}.webp'
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(data)
    descriptor = {"sourceManifestSha256": digest(source), "coarseOverview": {
        "path": relative, "bytes": len(data), "sha256": digest(data),
        "width": width, "height": height, "scale": 0.0625}}
    with (output / bundle["directory"] / "coarse-descriptor.json").open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(descriptor, indent=2) + "\n")
    return descriptor


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.manifest, args.output)))
