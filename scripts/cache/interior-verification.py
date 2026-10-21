#!/usr/bin/env python3
"""Independent PNG verification and bounded sample contact sheet (Pillow)."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--assets', required=True)
parser.add_argument('--manifest', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--samples', required=True)
args = parser.parse_args()
assets = Path(args.assets).resolve()
manifest_file = Path(args.manifest).resolve()
manifest = json.loads(manifest_file.read_bytes())
errors, empty, byte_count, transparent = [], 0, 0, 0
for layer in manifest['maps']:
    for tile in layer['tiles']:
        file = (assets / tile['path']).resolve()
        if not file.is_relative_to(assets):
            errors.append({'path': tile['path'], 'error': 'Escaping asset root'})
            continue
        raw = file.read_bytes()
        byte_count += len(raw)
        if len(raw) != tile['bytes'] or hashlib.sha256(raw).hexdigest() != tile['sha256']:
            errors.append({'path': tile['path'], 'error': 'Hash or size mismatch'})
        image = Image.open(file)
        if image.mode != 'RGBA' or image.size != (256, 256):
            errors.append({'path': tile['path'], 'error': 'Wrong RGBA dimensions'})
            continue
        alpha = image.getchannel('A')
        zero = alpha.histogram()[0]
        empty += int(zero == 65536)
        transparent += zero
        zero_mask = alpha.point(lambda a: 255 if a == 0 else 0)
        if any(ImageChops.multiply(image.getchannel(c), zero_mask).getbbox() for c in 'RGB'):
            errors.append({'path': tile['path'], 'error': 'Colour in transparent pixels'})
        if zero != tile['oceanPixels'] + tile['voidPixels']:
            errors.append({'path': tile['path'], 'error': 'Alpha differs from definition coverage counts'})

samples = [(31, 0, 'Lumbridge Cellar / Misthalin Underground'), (164, 1, 'Lumbridge Catacombs upper source plane 1'),
           (164, 0, 'Lumbridge Catacombs quest lower plane 0'), (165, 0, 'Lumbridge Catacombs main chambers'),
           (542, 0, 'Draynor Sewers'), (592, 0, 'Edgeville Dungeon / Varrock Sewers'),
           (665, 0, 'Ashdale Caves'), (719, 0, 'Burthorpe Underground')]
sheet = Image.new('RGB', (1040, 1440), '#20242a')
draw = ImageDraw.Draw(sheet)
for idx, (map_id, plane, label) in enumerate(samples):
    layer = next((m for m in manifest['maps'] if m['mapId'] == map_id and m['plane'] == plane), None)
    if not layer:
        continue
    xs, ys = [t['x'] for t in layer['tiles']], [t['y'] for t in layer['tiles']]
    scene = Image.new('RGBA', ((max(xs)-min(xs)+1)*256, (max(ys)-min(ys)+1)*256), '#303841')
    for tile in layer['tiles']:
        im = Image.open(assets / tile['path'])
        scene.alpha_composite(im, ((tile['x']-min(xs))*256, (max(ys)-tile['y'])*256))
    scene.thumbnail((496, 320), Image.Resampling.NEAREST)
    left, top = (idx % 2)*520+12, (idx // 2)*360+12
    draw.text((left, top), f'{label} (map {map_id}, plane {plane})', fill='white')
    sheet.paste(scene.convert('RGB'), (left, top+26))
Path(args.samples).parent.mkdir(parents=True, exist_ok=True)
sheet.save(args.samples)
report = {'schemaVersion': 1, 'manifestSha256': hashlib.sha256(manifest_file.read_bytes()).hexdigest(),
          'maps': len({m['mapId'] for m in manifest['maps']}), 'mapPlanes': len(manifest['maps']),
          'tiles': sum(len(m['tiles']) for m in manifest['maps']), 'pngBytes': byte_count,
          'fullyTransparentTiles': empty, 'transparentPixels': transparent, 'errors': errors,
          'sampleImage': str(Path(args.samples).resolve())}
Path(args.output).write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps(report))
raise SystemExit(bool(errors))
