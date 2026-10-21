import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sha256 } from './cache-reader.mjs';

// Publish diagnostic candidates beside the existing assets. Never select them
// for the app or replace an existing file, directory, sprite or manifest.
export function publishCacheAssets({ output, publish }) {
  output = resolve(output);
  publish = resolve(publish);
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.v1.json'), 'utf8'));
  if (!manifest.validation?.pass) throw new Error('Landmark validation must pass before publication');
  const source = manifest.sources.find(row => row.major === 5);
  if (!source) throw new Error('Map-square cache provenance is missing');
  const suffix = `cache-${manifest.generatedAt.slice(0, 10)}-${source.sha256.slice(0, 12)}-v1`;
  const pinsName = `pins.${suffix}.json`, spritesName = `sprites.${suffix}`;
  const manifestName = `manifest.${suffix}.json`;
  for (const name of [pinsName, spritesName, manifestName])
    if (existsSync(join(publish, name))) throw new Error(`New version already exists: ${name}`);

  const verified = new Map();
  for (const entry of manifest.outputs) {
    const name = basename(entry.path), path = join(output, name);
    const bytes = readFileSync(path);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new Error(`Output does not match manifest: ${name}`);
    verified.set(name, bytes);
  }
  const pins = verified.get('pins.cache-v1.json');
  const spriteManifest = JSON.parse(verified.get('sprites-manifest.v1.json'));
  const sprites = [];
  for (const sprite of spriteManifest.sprites) {
    const frames = sprite.frames.map(frame => {
      if (!frame.asset) return { ...frame };
      const name = basename(frame.asset.path), bytes = readFileSync(join(output, 'sprites', name));
      if (bytes.length !== frame.asset.bytes || sha256(bytes) !== frame.asset.sha256)
        throw new Error(`Sprite does not match manifest: ${name}`);
      return { ...frame, asset: { ...frame.asset, path: `${spritesName}/${name}` }, bytes };
    });
    sprites.push({ ...sprite, frames });
  }
  mkdirSync(publish, { recursive: true });
  mkdirSync(join(publish, spritesName));
  writeFileSync(join(publish, pinsName), pins, { flag: 'wx' });
  for (const sprite of sprites) for (const frame of sprite.frames) {
    if (!frame.bytes) continue;
    writeFileSync(join(publish, frame.asset.path), frame.bytes, { flag: 'wx' });
    delete frame.bytes;
  }
  const published = { ...manifest, diagnosticOnly: true,
    published: { pins: { path: pinsName, bytes: pins.length, sha256: sha256(pins) },
      sprites: { directory: spritesName, requested: spriteManifest.requested,
        missing: spriteManifest.missing, sprites, limits: spriteManifest.limits } },
    limits: [...manifest.limits, 'This new version is not selected by the running picker.'] };
  writeFileSync(join(publish, manifestName), JSON.stringify(published, null, 2), { flag: 'wx' });
  return { pins: join(publish, pinsName), sprites: join(publish, spritesName), manifest: join(publish, manifestName) };
}
