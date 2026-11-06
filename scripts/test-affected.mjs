import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, setPriority } from 'node:os';
import { moduleTokens } from './private-companion/tooling-module-graph.mjs';
import { affectedRules } from './test-affected-rules.mjs';

// Tokenization ignores comments, strings and regex bodies, and visits template
// interpolation code. No module is evaluated while constructing the graph.
export function moduleReferences(source) {
  const tokens = moduleTokens(source), references = [];
  const add = token => {
    if (!token) return;
    if (token.escaped) throw Error('Escaped specifier requires conservative selection');
    if (token.kind === 'string' || token.kind === 'template' && !token.value.includes('${')) references.push(token.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'identifier') continue;
    if (t.value === 'import') {
      if (tokens[i + 1]?.value === '(') add(tokens[i + 2]);
      else if (tokens[i + 1]?.kind === 'string') add(tokens[i + 1]);
    }
    if (t.value === 'from' && tokens[i + 1]?.kind === 'string') add(tokens[i + 1]);
    // Tests also spawn CLI modules or read fixtures through literal file URLs.
    if (t.value === 'URL' && tokens[i - 1]?.value === 'new' && tokens[i + 1]?.value === '(') add(tokens[i + 2]);
  }
  return [...new Set(references)];
}

export function importGraph(sources) {
  const reverse = new Map(), uncertain = [];
  for (const [file, source] of sources) {
    let references;
    try { references = moduleReferences(source); }
    catch { uncertain.push(file); continue; }
    for (const ref of references) {
      if (!ref.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.replace(/[?#].*$/, '')));
      if (!reverse.has(target)) reverse.set(target, new Set());
      reverse.get(target).add(file);
    }
  }
  return { reverse, uncertain };
}

export function selectAffected({ sources, graph = importGraph(sources), changed, tests, rules = affectedRules }) {
  const { reverse, uncertain } = graph;
  // A lexical failure must never silently omit an importer. Such a checkout
  // still gets correct feedback, conservatively running the whole inventory.
  if (uncertain.length && changed.length) return { files: [...tests].sort(), uncertain };
  const reached = new Set(changed), queue = [...changed];
  for (let i = 0; i < queue.length; i++) for (const importer of reverse.get(queue[i]) ?? []) {
    if (!reached.has(importer)) { reached.add(importer); queue.push(importer); }
  }
  const files = tests.filter(file => reached.has(`tests/${file}`)
    || rules.some(rule => changed.some(name => rule.changes.test(name)) && rule.tests.test(file))).sort();
  const early = ['browser-module-graph.test.mjs', 'server.test.mjs', 'storage-static.test.mjs'];
  files.sort((a, b) => (early.indexOf(a) < 0 ? early.length : early.indexOf(a))
    - (early.indexOf(b) < 0 ? early.length : early.indexOf(b)));
  return { files, uncertain };
}

export async function affectedSelection({ cwd = fileURLToPath(new URL('../', import.meta.url)), base = 'origin/main' } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  // Missing base is an error, never an empty selection. Include index/worktree
  // changes as well as committed branch changes for the local pre-push check.
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const changed = [...new Set([...git(['diff', '--no-renames', '--name-only', '-z', mergeBase]).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))];
  const names = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.mjs']).split('\0').filter(Boolean);
  const sources = new Map();
  await Promise.all(names.map(async name => {
    try { sources.set(name, await readFile(path.join(cwd, name), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }));
  const existing = new Set(sources.keys());
  // Union old import edges for changed/deleted modules: deleting an import or
  // moving a module must not hide tests that depended on its previous version.
  for (const name of changed.filter(name => name.endsWith('.mjs'))) {
    let previous;
    try { previous = git(['show', `${mergeBase}:${name}`]); } catch { continue; }
    sources.set(name, (sources.get(name) ?? '') + '\n' + previous);
  }
  const { discoverTests } = await import('./test-selection.mjs');
  // Audit classification/ports, then include every test entrypoint in feedback,
  // including detector suites whose complete CI gate lives in another lane.
  await discoverTests(path.join(cwd, 'tests'), 'full');
  const tests = names.filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name) && existing.has(name)).map(name => name.slice(6));
  return { ...selectAffected({ sources, changed, tests }), changed, mergeBase };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.find(arg => arg.startsWith('--base='))?.slice(7) ?? 'origin/main';
  if (args.some(arg => arg !== '--list' && arg !== '--test-concurrency=1' && !arg.startsWith('--base='))) throw Error('Usage: test-affected.mjs [--list] [--base=origin/main] [--test-concurrency=1]');
  if (!args.includes('--list')) setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  const selection = await affectedSelection({ base });
  console.log(`Affected: ${selection.files.length} files (${selection.changed.length} changed paths)`);
  if (selection.uncertain.length) console.log('Conservative full selection: a module could not be scanned.');
  if (args.includes('--list')) console.log(selection.files.map(file => `tests/${file}`).join('\n'));
  else {
    const { runSelectedTests } = await import('./test.mjs');
    // The local check is deliberately sequential, including isolated native
    // node:test children (whose concurrency is always 1 in the adaptive runner).
    const cap = process.env.GITHUB_ACTIONS === 'true' && !args.includes('--test-concurrency=1') ? 6 : 1;
    await runSelectedTests(selection.files, { failFast: true, options: { minConcurrency: 1, maxConcurrency: cap, soloFirst: false } });
  }
}
