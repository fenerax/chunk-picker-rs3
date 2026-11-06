import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, setPriority } from 'node:os';
import { fileReferences, importGraph } from './test-affected-graph.mjs';
import { affectedRules, globalTestChange, inertChange, ruleMatches } from './test-affected-rules.mjs';

export { importGraph };
export const moduleReferences = source => {
  const { references, reasons } = fileReferences(source);
  if (reasons.length) throw Error(reasons.join('; '));
  return [...new Set(references.map(ref => ref.specifier))];
};
export function feedbackOrder(files) {
  const early = ['browser-module-graph.test.mjs', 'server.test.mjs', 'storage-static.test.mjs'];
  const rank = file => early.indexOf(file) < 0 ? early.length : early.indexOf(file);
  return [...files].sort((a, b) => rank(a) - rank(b));
}
const reach = (reverse, starts) => {
  const visited = new Set(starts), queue = [...visited];
  for (let i = 0; i < queue.length; i++) for (const importer of reverse.get(queue[i]) ?? []) {
    if (!visited.has(importer)) { visited.add(importer); queue.push(importer); }
  }
  return visited;
};
export function selectAffected({ sources, graph, changed, tests, rules = affectedRules, symlinks = [] }) {
  const full = reason => ({ files: [...new Set(tests)].sort(), uncertain: [], reason, full: true });
  if (changed.some(globalTestChange)) return full('Global test/data input');
  // With any tracked symlink, conservatively treat every change as global.
  // This also covers link chains, directory links and external/absolute targets.
  if (symlinks.length && changed.length) return full('Tracked symlinks present');
  graph ??= importGraph(sources);
  const { reverse, uncertain } = graph;
  const directories = [...reverse.keys()].filter(key => key.endsWith('/'));
  const inputs = file => [file, ...directories.filter(dir => dir === './' || file.startsWith(dir))];
  changed = changed.filter(file => !inertChange(file) || inputs(file).some(key => reverse.has(key)));
  if (!changed.length) return { files: [], uncertain };
  const opaque = reach(reverse, uncertain), selected = new Set();
  for (const file of changed) {
    if (file.endsWith('.mjs') && !reverse.has(file) && !tests.includes(file.slice(6))) return full('Module has no proven import consumers');
    const visited = reach(reverse, inputs(file));
    const matching = rules.filter(rule => ruleMatches(rule, file));
    const consumers = tests.filter(test => visited.has(`tests/${test}`) || matching.some(rule => rule.tests.test(test)));
    if (!consumers.length) return full('Changed path has no proven test coverage');
    for (const test of consumers) selected.add(test);
  }
  const direct = feedbackOrder([...selected].sort());
  const always = tests.filter(test => opaque.has(`tests/${test}`) && !selected.has(test)).sort();
  return { files: [...direct, ...always], uncertain, always: always.length };
}
export async function affectedSelection({ cwd = fileURLToPath(new URL('../', import.meta.url)), base = 'origin/main', changed: changedOverride } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const changed = changedOverride ?? [...new Set([...git(['diff', '--no-renames', '--name-only', '-z', mergeBase]).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))];
  const names = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.mjs']).split('\0').filter(Boolean);
  const sources = new Map();
  await Promise.all(names.map(async name => {
    try { sources.set(name, await readFile(path.join(cwd, name), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }));
  const existing = new Set(sources.keys());
  for (const name of changed.filter(name => name.endsWith('.mjs'))) {
    let previous;
    try { previous = git(['show', `${mergeBase}:${name}`]); } catch { continue; }
    sources.set(name, (sources.get(name) ?? '') + '\n' + previous);
  }
  const symlinks = [];
  // Read link blobs from both index and base; fs.readFile would follow the link.
  for (const [rows, ref] of [[git(['ls-files', '-s', '-z']), ''], [git(['ls-tree', '-r', '-z', mergeBase]), mergeBase]]) {
    for (const row of rows.split('\0')) {
      const match = /^120000 [^\t]*\t(.*)$/.exec(row);
      if (!match) continue;
      const file = match[1], value = git(['show', `${ref}:${file}`]).trim();
      symlinks.push({ file, target: path.posix.normalize(path.posix.join(path.posix.dirname(file), value)), directory: true });
    }
  }
  const { discoverTests } = await import('./test-selection.mjs');
  await discoverTests(path.join(cwd, 'tests'), 'full');
  const tests = names.filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name) && existing.has(name)).map(name => name.slice(6));
  return { ...selectAffected({ sources, changed, tests, symlinks }), changed, mergeBase, symlinks };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.find(arg => arg.startsWith('--base='))?.slice(7) ?? 'origin/main';
  const changed = args.filter(arg => arg.startsWith('--changed=')).map(arg => arg.slice(10));
  if (args.some(arg => arg !== '--list' && arg !== '--test-concurrency=1' && !arg.startsWith('--base=') && !arg.startsWith('--changed='))) throw Error('Usage: test-affected.mjs [--list] [--base=origin/main] [--test-concurrency=1] [--changed=path ...]');
  if (changed.length && !args.includes('--list')) throw Error('--changed is for synthetic --list inspection only');
  if (!args.includes('--list')) setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  const selection = await affectedSelection({ base, ...(changed.length ? { changed } : {}) });
  console.log(`Affected: ${selection.files.length} files (${selection.changed.length} changed paths; ${selection.uncertain.length} uncertain nodes)`);
  if (selection.full) console.log(`Conservative full selection: ${selection.reason}.`);
  if (args.includes('--list')) console.log(selection.files.map(file => `tests/${file}`).join('\n'));
  else {
    const { runSelectedTests } = await import('./test.mjs');
    await runSelectedTests(feedbackOrder(selection.files), { failFast: true, options: { minConcurrency: 1, maxConcurrency: 1, soloFirst: false } });
  }
}
