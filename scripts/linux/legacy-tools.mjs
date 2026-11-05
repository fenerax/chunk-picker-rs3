// Code-only reconstruction for disposable rehearsal. Never reads a save or
// connects to a host. Every recorded installed hash must be reproduced exactly.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { moduleTokens } from '../private-companion/tooling-module-graph.mjs';
import { encode, exists, inventory, json, noLinks, outside, sha } from './files.mjs';

const safe = name => /^(?:app|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|json)$/.test(name)
  && !name.split('/').some(part => part === '.' || part === '..' || !part);
function legacyReferences(source) {
  const tokens = moduleTokens(source), refs = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1], value = tokens[i].value;
    if ((value === 'import' || value === 'from') && next?.kind === 'string') refs.push(next.value);
    if (value === 'import' && next?.value === '(' && tokens[i + 2]?.kind === 'string' && tokens[i + 3]?.value === ')') refs.push(tokens[i + 2].value);
    if (value === 'new' && next?.value === 'URL' && tokens[i + 2]?.value === '(' && tokens[i + 3]?.kind === 'string'
      && tokens.slice(i + 4, i + 10).map(token => token.value).join('') === ',import.meta.url)' && /\.(?:mjs|json)$/.test(tokens[i + 3].value)) refs.push(tokens[i + 3].value);
  }
  return refs;
}
export async function buildLegacyTools({ repo, comparison, installedCopies, output, baseline }) {
  repo = path.resolve(repo); output = path.resolve(output);
  outside(output, repo); outside(output, comparison);
  if (installedCopies) outside(installedCopies, output);
  const expected = await json(comparison), rows = expected.rows;
  if (!Array.isArray(rows) || !rows.length || !/^[a-f0-9]{40}$/.test(baseline ?? '')) throw Error('Legacy inventory and exact baseline required.');
  const recorded = new Map();
  for (const row of rows) {
    if (!safe(row.path) || recorded.has(row.path) || row.installedSha256 !== null && !/^[a-f0-9]{64}$/.test(row.installedSha256)) throw Error('Legacy inventory refused.');
    recorded.set(row.path, row.installedSha256);
  }
  const git = args => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args],
    { windowsHide: true, maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'ignore'] });
  const blob = (ref, name) => { try { return git(['show', `${ref}:${name}`]); } catch { return null; } };
  const load = async name => {
    const digest = recorded.get(name);
    if (digest === null) throw Error('Legacy dependency was not installed: ' + name);
    if (installedCopies && digest) {
      for (const candidate of [path.join(installedCopies, name), path.join(installedCopies, path.basename(name))]) {
        if (await exists(candidate)) { await noLinks(candidate); const bytes = await readFile(candidate); if (sha(bytes) === digest) return bytes; }
      }
    }
    const first = blob(baseline, name);
    if (first && (!digest || sha(first) === digest)) return first;
    if (digest) {
      const revisions = git(['log', '--all', '--format=%H', '--', name]).toString().trim().split('\n');
      for (const ref of revisions) {
        const bytes = blob(ref, name); if (bytes && sha(bytes) === digest) return bytes;
      }
    }
    throw Error('Cannot reproduce installed legacy hash: ' + name);
  };
  // These unlisted unit/child entrypoints come from the explicit pre-refresh
  // baseline. The comparison's installed files always take precedence.
  const pending = [...rows.filter(row => row.installedSha256).map(row => row.path),
    ...['start-check', 'serve', 'operator', 'probe', 'rehearse'].map(name => `scripts/linux/${name}.mjs`)];
  const files = new Map();
  while (pending.length) {
    const name = pending.pop();
    if (!safe(name)) throw Error('Legacy dependency escaped.');
    if (files.has(name)) continue;
    const bytes = await load(name); files.set(name, bytes);
    if (!name.endsWith('.mjs')) continue;
    // Computed imports address the selected application release, not tools.
    for (const ref of legacyReferences(bytes.toString())) {
      if (ref.startsWith('node:')) continue;
      if (!ref.startsWith('.') || /[\\:%?#]/.test(ref)) throw Error('Legacy module specifier refused.');
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), ref)));
    }
  }
  if (await exists(output)) throw Error('Legacy output must be absent.');
  await noLinks(path.dirname(output)); await mkdir(output, { mode: 0o755 });
  for (const [name, bytes] of files) {
    const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx', mode: 0o644 });
  }
  const actual = await inventory(output);
  const receipt = { format: 'picker-legacy-fixture-v1', baseline, files: actual,
    recorded: rows.filter(row => row.installedSha256).map(row => ({ path: row.path, sha256: row.installedSha256 })) };
  await verifyLegacyTools(output, receipt);
  return receipt;
}
export async function verifyLegacyTools(root, receipt) {
  await noLinks(root);
  if (!(await lstat(root)).isDirectory() || receipt?.format !== 'picker-legacy-fixture-v1'
    || !Array.isArray(receipt.files) || !receipt.files.length || !Array.isArray(receipt.recorded) || !receipt.recorded.length
    || encode(await inventory(root)) !== encode(receipt.files)) throw Error('Legacy fixture differs.');
  for (const row of receipt.recorded) if (!safe(row.path) || receipt.files.find(file => file.path === row.path)?.sha256 !== row.sha256) throw Error('Legacy installed hash differs.');
  return receipt;
}
