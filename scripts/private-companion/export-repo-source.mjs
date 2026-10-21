// Export one exact commit of this repository into an absent directory, for a release kit's
// checks/private-source. Reads Git objects only, so neither the checkout nor any tooling
// outside this folder takes part. The sibling export.json receipt keeps the old exporter's schema.
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hashTree } from './release-identity.mjs';
import { privateSourcePath } from './check-private-drift.mjs';

const env = () => {
  const value = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(value)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/.test(key)) delete value[key];
  return value;
};
const git = (repo, args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 ** 2 });
const exists = async target => { try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const overlaps = (a, b) => { const r = path.relative(a, b); return !r || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r)); };

// Stream every selected blob through one `git cat-file --batch`.
function readBlobs(repo, oids) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-C', repo, 'cat-file', '--batch'], { env: env(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let failed = '';
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => { failed += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error('Git object read failed.' + (failed ? ' ' + failed.trim() : '')));
      const all = Buffer.concat(out), blobs = [];
      for (let at = 0, i = 0; i < oids.length; i++) {
        const end = all.indexOf(10, at), header = all.subarray(at, end).toString('utf8').split(' ');
        if (header[0] !== oids[i] || header[1] !== 'blob') return reject(Error('Unexpected Git object in export.'));
        const size = Number(header[2]); blobs.push(all.subarray(end + 1, end + 1 + size)); at = end + 2 + size;
      }
      resolve(blobs);
    });
    child.stdin.end(oids.map(oid => oid + '\n').join(''));
  });
}

export async function exportSource({ repo, commit, out }) {
  if (!path.isAbsolute(repo ?? '') || !path.isAbsolute(out ?? '')) throw Error('Absolute repository and output required.');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('Exact 40-character commit required.');
  repo = path.resolve(repo); out = path.resolve(out);
  const parent = path.dirname(out), receipt = path.join(parent, 'export.json');
  if (overlaps(repo, out) || overlaps(out, repo)) throw Error('Output overlaps repository.');
  if (await exists(out) || await exists(receipt)) throw Error('Output or sibling export.json already exists.');
  if (!(await lstat(parent)).isDirectory()) throw Error('Existing ordinary output parent required.');
  if (git(repo, ['rev-parse', '--verify', '--end-of-options', commit + '^{commit}']).toString().trim() !== commit) throw Error('Exact commit differs.');
  const rows = git(repo, ['ls-tree', '-rz', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match) throw Error('Linked or nonregular tree entry refused.');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  // A legacy private-source commit may still list documented exclusions.
  let excluded = new Set();
  try { excluded = new Set(JSON.parse(git(repo, ['show', commit + ':.private-source/exclusions.json']).toString('utf8')).map(row => row.path)); }
  catch { /* One-repository commits have no exclusion list. */ }
  const entries = rows.filter(row => privateSourcePath(row.path) && !excluded.has(row.path));
  const scratch = path.join(parent, '.' + path.basename(out) + '.export-' + randomUUID());
  let published = false, receiptWritten = false;
  try {
    await mkdir(scratch);
    // Read in groups so a large data tree never sits in memory at once.
    for (let start = 0; start < entries.length; start += 200) {
      const group = entries.slice(start, start + 200), blobs = await readBlobs(repo, group.map(row => row.oid));
      for (const [index, row] of group.entries()) {
        const target = path.join(scratch, ...row.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, blobs[index], { flag: 'wx', mode: row.mode === '100755' ? 0o755 : 0o666 });
      }
    }
    const tree = await hashTree(scratch);
    if (await exists(out)) throw Error('Output appeared during export.');
    const metadata = { schema: 'rs3-private-export-v1', commit, treeHash: tree.digest, fileCount: tree.files.length,
      bytes: tree.files.reduce((n, f) => n + f.size, 0), hashSchema: tree.schema, output: out,
      exclusions: 'Repository management paths, transient paths and any documented exclusion list.' };
    await writeFile(receipt, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); receiptWritten = true;
    // Publish the output last: a final-looking directory always has its receipt.
    await rename(scratch, out); published = true;
    return { ...metadata, receipt };
  } catch (error) {
    await rm(published ? out : scratch, { recursive: true, force: true });
    if (receiptWritten) await rm(receipt, { force: true });
    throw error;
  }
}
