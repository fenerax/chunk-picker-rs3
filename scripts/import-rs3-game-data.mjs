#!/usr/bin/env node
// Advisory bundle only; no application consumer, server or publication action.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cliOptions, writeDataset } from './cache/game-data-common.mjs';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';

const scripts = { objects: 'game-data-objects.mjs', items: 'game-data-items.mjs',
  quests: 'game-data-quests.mjs', recipes: 'game-data-recipes.mjs', places: 'game-data-places.mjs' };
export async function importGameData(options) {
  const output = resolve(options.output ?? ''), workspace = resolve(options.workspace ?? 'C:/Users/User/Projects/rs3-cache-work');
  if (!options.output || existsSync(output)) throw new Error('Supply a NEW --output directory');
  const categories = options.category ? options.category.split(',') : Object.keys(scripts);
  if (!categories.length || categories.some(key => !scripts[key])) throw new Error('Categories: objects,items,quests,recipes,places');
  mkdirSync(output, { recursive: true });
  const results = [];
  for (const category of categories) {
    const script = join(import.meta.dirname, 'cache', scripts[category]);
    const args = ['--max-old-space-size=8192', script, '--workspace', workspace, '--output', join(output, category)];
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? accept() : reject(new Error(`${category} extraction exited ${code}`)));
    });
    results.push({ category, path: join(output, category).replaceAll('\\', '/'), script: scripts[category], scriptSha256: sha256RepositoryText(readFileSync(script)) });
  }
  writeDataset(output, 'bundle.v1.json', { schemaVersion: 1, generatedAt: new Date().toISOString(),
    advisoryOnly: true, categories: results, helperSha256: sha256RepositoryText(readFileSync(join(import.meta.dirname, 'cache/game-data-common.mjs'))),
    limits: ['Category manifests record source and output hashes. No output is selected by the application.',
      'Wiki validation snapshots are separate recorded inputs; this command performs cache extraction only.'] });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = cliOptions();
  for (const key of Object.keys(options)) if (!['workspace', 'output', 'category'].includes(key)) throw new Error(`Unknown --${key}`);
  importGameData(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
