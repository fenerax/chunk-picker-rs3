// Scan exact committed public trees using the existing private fingerprint corpus.
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const kit = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export async function scanPublicCandidate({ repo, revision, base, output, kitRoot = kit }) {
  if (![repo, output, kitRoot].every(path.isAbsolute) || !/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(base)) throw new Error('Scan arguments refused.');
  const tooling = path.join(kitRoot, 'checks/private-source/scripts/secret-scan');
  const { scanEntries, loadReviewed, treeEntries } = await import(pathToFileURL(path.join(tooling, 'scan.mjs')));
  const { loadCorpus } = await import(pathToFileURL(path.join(tooling, 'fingerprints.mjs')));
  const corpus = await loadCorpus(path.join(kitRoot, 'release-gate/corpus'));
  const reviewed = loadReviewed(path.join(tooling, 'reviewed.json'));
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { windowsHide: true, maxBuffer: 64 * 1024 ** 2 });
  git('merge-base', '--is-ancestor', base, revision);
  const commits = git('rev-list', '--reverse', `${base}..${revision}`).toString().trim().split('\n').filter(Boolean);
  const rows = [];
  for (const ref of [...new Set([...commits, revision])]) {
    // The scanner's own reader: it refuses non-regular entries and holds trees
    // far larger than a single 64 MiB exec buffer.
    const entries = treeEntries(repo, ref);
    if (entries.some(entry => /[\r\n]/.test(entry.path))) throw new Error('Public path refused.');
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
