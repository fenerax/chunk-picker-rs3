// Scan exact committed public trees using the existing private fingerprint corpus.
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const kit = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export async function scanPublicCandidate({ repo, revision, base, output, kitRoot = kit }) {
  if (![repo, output, kitRoot].every(path.isAbsolute) || !/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(base)) throw new Error('Scan arguments refused.');
  const tooling = path.join(kitRoot, 'checks/private-source/scripts/secret-scan');
  const { scanEntries, loadReviewed } = await import(pathToFileURL(path.join(tooling, 'scan.mjs')));
  const { loadCorpus } = await import(pathToFileURL(path.join(tooling, 'fingerprints.mjs')));
  const corpus = await loadCorpus(path.join(kitRoot, 'release-gate/corpus'));
  const reviewed = loadReviewed(path.join(tooling, 'reviewed.json'));
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { windowsHide: true, maxBuffer: 64 * 1024 ** 2 });
  git('merge-base', '--is-ancestor', base, revision);
  const commits = git('rev-list', '--reverse', `${base}..${revision}`).toString().trim().split('\n').filter(Boolean);
  const rows = [];
  for (const ref of [...new Set([...commits, revision])]) {
    const modes = git('ls-tree', '-r', ref).toString().trim().split('\n');
    if (modes.some(row => !/^100(?:644|755) blob [a-f0-9]+\t/.test(row))) throw new Error('Public tree contains non-regular entries.');
    const names = git('ls-tree', '-rz', '--name-only', ref).toString().split('\0').filter(Boolean);
    const batch = execFileSync('git', ['--no-optional-locks', '-C', repo, 'cat-file', '--batch'], { input: names.map(name => `${ref}:${name}\n`).join(''), windowsHide: true, maxBuffer: 64 * 1024 ** 2 });
    let offset = 0;
    const entries = names.map(name => {
      if (/[\r\n]/.test(name)) throw new Error('Public path refused.');
      const end = batch.indexOf(10, offset), match = /^([a-f0-9]+) blob (\d+)$/.exec(batch.subarray(offset, end).toString());
      if (!match) throw new Error('Git blob refused.');
      const size = Number(match[2]); offset = end + 1;
      const bytes = batch.subarray(offset, offset + size); offset += size + 1; return { path: name, bytes };
    });
    rows.push({ revision: ref, ...scanEntries(entries, { corpus, reviewed }) });
  }
  for (const ref of commits) {
    const [author, committer] = git('show', '-s', '--format=%ae%n%ce', ref).toString().trim().split('\n');
    if (author !== 'fenerax@users.noreply.github.com' || committer !== author) throw new Error('Commit attribution refused.');
  }
  const report = { passed: rows.every(row => row.status === 'clean'), revision, base, trees: rows };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) throw new Error('Public scan failed.');
  return { passed: true, trees: rows.length, findings: 0 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) { const key = { '--core': 'repo', '--ref': 'revision', '--base': 'base', '--output': 'output' }[process.argv[i]]; if (!key || !process.argv[i + 1]) throw new Error('Arguments'); options[key] = process.argv[i + 1]; }
    console.log(JSON.stringify(await scanPublicCandidate(options)));
  } catch { console.error('Public candidate scan refused.'); process.exitCode = 1; }
}
