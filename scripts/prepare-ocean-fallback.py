"""Offline ocean classification for the private terrain manifest (requires Pillow).

Only perfectly uniform legacy-water cells absent from the complete cache surface
region list qualify. Any legacy artwork pixel preserves the baked-image fallback.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(assets, legacy):
    manifest_path = assets / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    cache = manifest['cacheTerrain']
    source_manifest_path = assets / cache['directory'].split('/')[0] / 'manifest.json'
    source = json.loads(source_manifest_path.read_text(encoding='utf-8-sig'))
    assert source['selectedRegions'] == len(cache['tiles']) and not source['errors'], 'Complete successful surface enumeration required'
    assert cache['mapId'] == 28 and cache['plane'] == 0 and cache['iconFree'] is True
    cache_regions = {(t['x'], t['y']) for t in cache['tiles']}
    samples = []
    # Independent water-heavy PNGs; sample modal pixels rather than shore pixels.
    for x, y in [(49, 48), (49, 47), (50, 48)]:
        tile = next(t for t in manifest['terrain']['tiles'] if (t['x'], t['y']) == (x, y))
        tile_path = assets / tile['path']
        assert digest(tile_path) == tile['sha256']
        image = Image.open(tile_path).convert('RGBA')
        rgba, count = Counter(image.get_flattened_data()).most_common(1)[0]
        assert rgba[3] == 255 and rgba[2] > rgba[1] > rgba[0]
        samples.append({'path': tile['path'], 'sha256': digest(tile_path), 'rgba': list(rgba), 'modalPixels': count, 'pixels': image.width * image.height})
    assert all(s['rgba'] == samples[0]['rgba'] for s in samples)
    image = Image.open(legacy).convert('RGB')
    assert image.size == (6016, 6400)
    legacy_water, _ = Counter(image.get_flattened_data()).most_common(1)[0]
    ocean, land = [], []
    for x in range(29, 76):
        for y in range(22, 72):
            if (x, y) in cache_regions:
                continue
            box = ((x - 29) * 128, (71 - y) * 128, (x - 28) * 128, (72 - y) * 128)
            colours = Counter(image.crop(box).get_flattened_data())
            row = {'x': x, 'y': y}
            (ocean if len(colours) == 1 and legacy_water in colours else land).append(row)
    downloaded = {(t['x'], t['y']) for t in manifest['terrain']['tiles'] if t['status'] == 'downloaded'}
    rendered = {(t['x'], t['y']) for t in cache['tiles'] if t['status'] == 'rendered'}
    verification = json.loads((source_manifest_path.parent / 'verification.json').read_text())
    blank = {divmod(int(r), 256) for r in verification['blackCommunityPlaceholderRegions']}
    usable = (downloaded - blank) | rendered
    missing = {(x, y) for x in range(29, 76) for y in range(22, 72)} - usable
    ocean_keys = {(t['x'], t['y']) for t in ocean}
    report = {'mapId': 28, 'plane': 0, 'version': 1, 'method': 'uniform-legacy-water-without-cache-surface',
              'colour': samples[0]['rgba'][:3], 'legacyWater': list(legacy_water),
              'legacySha256': digest(legacy), 'surfaceManifestSha256': digest(source_manifest_path),
              'samples': samples, 'regions': ocean, 'legacyLandRegions': land,
              'counts': {'cacheSurfaceRegions': len(cache_regions), 'usableTerrainRegions': len(usable),
                         'eligibleOceanRegions': len(ocean), 'flatOceanFallbackRegions': len(missing & ocean_keys),
                         'bakedImageFallbackRegions': len(missing - ocean_keys),
                         'bakedImageFallbackCacheRegions': len(missing & cache_regions),
                         'bakedImageFallbackLegacyLandRegions': len(missing - ocean_keys - cache_regions)}}
    manifest['oceanFallback'] = report
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (assets / 'ocean-fallback-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--legacy', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.assets, args.legacy)['counts'], indent=2))
