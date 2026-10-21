#!/usr/bin/env python3
"""Independent complete PNG verification plus five requested area previews."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--catalogue', required=True)
parser.add_argument('--assets', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--samples', required=True)
args = parser.parse_args()
catalogue = json.loads(Path(args.catalogue).read_bytes())
assets = Path(args.assets).resolve()
manifest_bytes = (assets / catalogue['assets']['manifestPath']).read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest() == catalogue['assets']['manifestSha256']
manifest = json.loads(manifest_bytes)
errors, png_bytes, transparent, empty = [], 0, 0, 0
for layer in manifest['maps']:
    for tile in layer['tiles']:
        file = (assets / tile['path']).resolve()
        if not file.is_relative_to(assets):
            errors.append({'path': tile['path'], 'error': 'escaping asset root'})
            continue
        raw = file.read_bytes()
        png_bytes += len(raw)
        if len(raw) != tile['bytes'] or hashlib.sha256(raw).hexdigest() != tile['sha256']:
            errors.append({'path': tile['path'], 'error': 'hash/size mismatch'})
        im = Image.open(file)
        if im.mode != 'RGBA' or im.size != (256, 256):
            errors.append({'path': tile['path'], 'error': 'wrong RGBA dimensions'})
            continue
        alpha = im.getchannel('A')
        zero = alpha.histogram()[0]
        transparent += zero
        empty += zero == 65536
        mask = alpha.point(lambda a: 255 if a == 0 else 0)
        if any(ImageChops.multiply(im.getchannel(c), mask).getbbox() for c in 'RGB'):
            errors.append({'path': tile['path'], 'error': 'RGB in transparent pixels'})
        if zero != tile['oceanPixels'] + tile['voidPixels']:
            errors.append({'path': tile['path'], 'error': 'alpha differs from definition coverage'})
        for rectangle in tile.get('sceneryFootprints', {}).get('rectangles', []):
            # Independent game-tile -> PNG conversion catches a misplaced/scaled SVG overlay.
            px = int((rectangle['x'] - tile['x']*64 + 0.5)*4)
            py = int((tile['y']*64 + 64 - rectangle['y'] - 0.5)*4)
            if 0 <= px < 256 and 0 <= py < 256 and im.getpixel((px, py)) != (204, 180, 101, 255):
                errors.append({'path': tile['path'], 'error': 'wheat footprint misses exact source tile pixel', 'objectId': rectangle['objectId'], 'pixel': [px, py]})

samples = ['10307', '13214', '1546', '23', '5706']
sheet = Image.new('RGB', (1100, 1200), '#20242a')
draw = ImageDraw.Draw(sheet)
for index, area_id in enumerate(samples):
    area = next(a for a in catalogue['areas'] if a['areaId'] == area_id)
    layer = area['layers'][0]
    scene_map = next(m for m in catalogue['maps'] if m['mapId'] == layer['mapId'] and m['plane'] == layer['plane'])
    b = layer['bounds']
    tiles = [t for t in scene_map['tiles'] if t['x'] * 64 < b['maxX'] and (t['x'] + 1) * 64 > b['minX'] and t['y'] * 64 < b['maxY'] and (t['y'] + 1) * 64 > b['minY']]
    min_x, max_y = min(t['x'] for t in tiles), max(t['y'] for t in tiles)
    scene = Image.new('RGBA', ((max(t['x'] for t in tiles)-min_x+1)*256, (max_y-min(t['y'] for t in tiles)+1)*256))
    for tile in tiles:
        scene.alpha_composite(Image.open(assets / tile['path']), ((tile['x']-min_x)*256, (max_y-tile['y'])*256))
    # Preview zoom follows visible artwork only; this is not a semantic area boundary.
    if scene.getbbox():
        scene = scene.crop(scene.getbbox())
    scene.thumbnail((520, 340), Image.Resampling.NEAREST)
    left, top = (index % 2)*550+12, (index//2)*400+12
    draw.text((left, top), f"{area['name']} (map {layer['mapId']}, plane {layer['plane']})", fill='white')
    background = Image.new('RGBA', scene.size, '#303841')
    background.alpha_composite(scene)
    sheet.paste(background.convert('RGB'), (left, top+28))
Path(args.samples).parent.mkdir(parents=True, exist_ok=True)
sheet.save(args.samples)
report = {'schemaVersion': 1, 'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
          'tiles': sum(len(m['tiles']) for m in manifest['maps']), 'pngBytes': png_bytes,
          'fullyTransparentTiles': empty, 'transparentPixels': transparent, 'errors': errors,
          'sampleImage': str(Path(args.samples).resolve())}
Path(args.output).write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps(report))
raise SystemExit(bool(errors))
