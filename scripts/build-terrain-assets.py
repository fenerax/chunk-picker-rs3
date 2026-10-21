#!/usr/bin/env python3
"""Offline, verified terrain export. Never modifies source or existing bundles."""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re

from PIL import Image, ImageDraw, features, __version__ as pillow_version


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def grid(repo):
    text = (repo / "app/data/surface-grid.mjs").read_text()
    match = re.search(r"startId: (\d+), columns: (\d+), rows: (\d+), stride: (\d+)", text)
    if not match:
        raise ValueError("Cannot read canonical SURFACE_GRID")
    start, columns, rows, stride = map(int, match.groups())
    return start // stride, start % stride, columns, rows


def is_blank(image):
    pixels = list(image.get_flattened_data())
    black = sum(r <= 3 and g <= 3 and b <= 3 for r, g, b, a in pixels)
    opaque = sum(r <= 3 and g <= 3 and b <= 3 and a >= 250 for r, g, b, a in pixels)
    return black / len(pixels) >= .97 and opaque / len(pixels) >= .6


def colour(source):
    value = source.get("oceanColour")
    if value is None and re.fullmatch(r"#[0-9a-fA-F]{6}", source.get("oceanColor", "")):
        value = [int(source["oceanColor"][i:i + 2], 16) for i in (1, 3, 5)]
    return value


def sources(manifest, bounds):
    min_x, max_y, columns, rows = bounds
    cache = manifest.get("cacheTerrain", {})
    ocean = colour(cache)
    if not (cache.get("mapId") == 28 and cache.get("plane") == 0 and cache.get("zoom") == 2
            and cache.get("iconFree") is True and cache.get("layoutComplete") is True
            and cache.get("transparentWater") is True
            and re.fullmatch(r"terrain\.cache-[a-zA-Z0-9_-]+/28/2", cache.get("directory", ""))
            and isinstance(ocean, list) and len(ocean) == 3
            and all(type(c) is int and 0 <= c <= 255 for c in ocean)):
        raise ValueError("Optimized export requires the certified complete transparent-water layout")
    selected = {}
    for source, certified in ((manifest.get("terrain", {}), False), (cache, True)):
        if (source.get("mapId"), source.get("plane"), source.get("zoom")) != (28, 0, 2):
            continue
        directory = source.get("directory") if certified else "terrain/28/2"
        for tile in source.get("tiles", []):
            x, y = tile.get("x"), tile.get("y")
            if type(x) is not int or type(y) is not int or not (min_x <= x < min_x + columns and max_y - rows < y <= max_y):
                continue
            if tile.get("status") in ("missing", "empty") or certified and tile.get("status") != "rendered":
                continue
            if tile.get("path") != f"{directory}/0_{x}_{y}.png":
                continue
            selected.setdefault((x, y), []).append((tile, "cache" if certified else "community"))
    return selected, ocean


def select_image(root, candidates):
    rejected = []
    for tile, source in candidates:
        relative = tile["path"]
        target = (root / relative).resolve(strict=True)
        if not target.is_relative_to(root.resolve()) or target != root.resolve() / relative:
            raise ValueError(f"Unsafe source path: {relative}")
        data = target.read_bytes()
        if len(data) != tile["bytes"] or digest(data) != tile["sha256"]:
            raise ValueError(f"Source hash mismatch: {relative}")
        with Image.open(io.BytesIO(data)) as source_image:
            if source_image.size != (256, 256):
                raise ValueError(f"Invalid source dimensions: {relative}")
            image = source_image.convert("RGBA")
        record = {"path": relative, "bytes": len(data), "sha256": digest(data), "source": source}
        if source == "community" and is_blank(image):
            rejected.append({**record, "rejectedBlank": True})
            continue
        return image, record, rejected
    return Image.new("RGBA", (256, 256)), None, rejected


def encode(image, *, lossless=True, quality=80, method=4):
    stream = io.BytesIO()
    # In lossless mode, quality controls compression effort, not image fidelity.
    image.save(stream, "WEBP", lossless=lossless, quality=quality, method=method, exact=True)
    data = stream.getvalue()
    with Image.open(io.BytesIO(data)) as decoded:
        actual = decoded.convert("RGBA")
        if actual.getchannel("A").tobytes() != image.getchannel("A").tobytes():
            raise ValueError("WebP changed source transparency")
        if lossless and actual.tobytes() != image.tobytes():
            raise ValueError("Lossless WebP changed RGBA pixels")
    return data


def sample(root, manifest, bounds, output):
    candidates, _ = sources(manifest, bounds)
    samples = [("Lumbridge", 50, 50), ("Varrock", 51, 53), ("Falador", 46, 52),
               ("coast", 49, 48), ("ocean", 64, 22), ("cache-edge", 71, 54), ("north", 46, 67)]
    output.mkdir(parents=True, exist_ok=False)
    sheet = Image.new("RGB", (6 * 256, len(samples) * 280), "#cccccc")
    labels = ImageDraw.Draw(sheet)
    rows = []
    for row, (name, x, y) in enumerate(samples):
        image, source, rejected = select_image(root, candidates.get((x, y), []))
        variants = [("PNG", None, True, 6), ("lossless-m6-q100", 100, True, 6),
                    ("lossless-m4-q80", 80, True, 4),
                    ("lossy-q90", 90, False, 6), ("lossy-q95", 95, False, 6), ("lossy-q100", 100, False, 6)]
        results = {"name": name, "x": x, "y": y, "source": source, "rejected": rejected, "sizes": {}}
        for column, (label, quality, lossless, method) in enumerate(variants):
            if quality is None:
                data = (root / source["path"]).read_bytes() if source else b""
                actual = image
            else:
                data = encode(image, lossless=lossless, quality=quality, method=method)
                (output / f"{name}-{label}.webp").write_bytes(data)
                actual = Image.open(io.BytesIO(data)).convert("RGBA")
            results["sizes"][label] = len(data)
            background = Image.new("RGBA", image.size, "#cccccc")
            background.alpha_composite(actual)
            sheet.paste(background.convert("RGB"), (column * 256, row * 280 + 24))
            labels.text((column * 256 + 4, row * 280 + 4), f"{name} {label}: {len(data)} bytes", fill="black")
        rows.append(results)
    sheet.save(output / "contact-sheet.png")
    (output / "sizes.json").write_bytes(json_bytes({"pillow": pillow_version, "rows": rows}))
    print(json.dumps(rows, indent=2))


def build(root, manifest_data, manifest, bounds, output):
    candidates, ocean = sources(manifest, bounds)
    min_x, max_y, columns, rows = bounds
    selected = {}
    inputs = []
    for row in range(rows):
        for column in range(columns):
            x, y = min_x + column, max_y - row
            image, source, rejected = select_image(root, candidates.get((x, y), []))
            inputs.extend(rejected)
            if source:
                inputs.append(source)
            selected[(x, y)] = (image, source)
    provenance = {"sourceManifestSha256": digest(manifest_data), "pillow": pillow_version,
                  "libwebp": features.version("webp"), "exporterSha256": digest(Path(__file__).read_bytes()),
                  "grid": {"minRegionX": min_x, "maxRegionY": max_y, "columns": columns, "rows": rows},
                  "encoder": {"format": "WebP", "lossless": True, "quality": 80, "method": 4, "exact": True,
                              "qualityMeaning": "compression effort; decoded RGBA remains exact"},
                  "overview": {"regionsPerPage": 4, "regionPixels": 64, "resize": "Pillow BILINEAR"}, "inputs": inputs}
    content_digest = digest(json_bytes(provenance))[:16]
    directory = f"terrain.optimized-2026-10-08-{content_digest}"
    target = output / directory
    target.mkdir(parents=True, exist_ok=False)
    tiles, pages = [], []

    def publish(relative, image):
        data = encode(image)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return {"path": relative, "bytes": len(data), "sha256": digest(data)}

    for (x, y), (image, source) in selected.items():
        tiles.append({"x": x, "y": y, "width": 256, "height": 256, "status": "rendered",
                      "source": source["source"] if source else "ocean",
                      **publish(f"{directory}/native/0_{x}_{y}.webp", image)})
    for page_y in range(math.ceil(rows / 4)):
        for page_x in range(math.ceil(columns / 4)):
            page = Image.new("RGBA", (256, 256))
            regions = []
            for row in range(page_y * 4, min(rows, (page_y + 1) * 4)):
                for column in range(page_x * 4, min(columns, (page_x + 1) * 4)):
                    x, y = min_x + column, max_y - row
                    image, _ = selected[(x, y)]
                    resized = image.resize((64, 64), Image.Resampling.BILINEAR)
                    page.paste(resized, ((column % 4) * 64, (row % 4) * 64))
                    regions.append({"x": x, "y": y})
            pages.append({"x": page_x, "y": page_y, "left": page_x * 512, "top": page_y * 512,
                          "width": 512, "height": 512, "pixelWidth": 256, "pixelHeight": 256,
                          "regions": regions, **publish(f"{directory}/overview/{page_x}_{page_y}.webp", page)})
    bundle = {"schemaVersion": 1, "mapId": 28, "plane": 0, "zoom": 2, "tileSize": 256,
              "iconFree": True, "layoutComplete": True, "transparentWater": True,
              "directory": directory, "oceanColour": ocean, "tiles": tiles, "pages": pages,
              "provenance": provenance}
    data = json_bytes(bundle)
    # Publishing the manifest last makes partial output unavailable to the server.
    (target / "manifest.json").write_bytes(data)
    descriptor = {"directory": directory, "manifestPath": f"{directory}/manifest.json", "manifestSha256": digest(data)}
    (target / "descriptor.json").write_bytes(json_bytes(descriptor))
    print(json.dumps({**descriptor, "tiles": len(tiles), "pages": len(pages),
                      "nativeBytes": sum(t["bytes"] for t in tiles), "overviewBytes": sum(p["bytes"] for p in pages)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample", action="store_true")
    arguments = parser.parse_args()
    source, output = arguments.source.resolve(), arguments.output.resolve()
    if output == source or output.is_relative_to(source):
        raise ValueError("Output must be separate from the read-only source root")
    repo = Path(__file__).resolve().parents[1]
    data = (source / "manifest.json").read_bytes()
    manifest = json.loads(data)
    if arguments.sample:
        sample(source, manifest, grid(repo), output)
    else:
        build(source, data, manifest, grid(repo), output)


if __name__ == "__main__":
    main()
