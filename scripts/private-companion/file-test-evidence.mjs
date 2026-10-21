// File evidence is deliberately conservative. A pass is reused only when its run's
// trace shows it observed nothing outside its contract.
import path from 'node:path';
import os from 'node:os';
import { readFile, readdir, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digestValue, hashTree } from './release-identity.mjs';
import { gateContract, gatePolicy, atomicJSON } from './release-evidence.mjs';
import { scanModule } from './module-scan.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const relative = value => {
  if (typeof value !== 'string' || value.includes('\\') || /[:\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('File input path refused.');
  return value;
};
export async function regularInput(file) {
  let current = path.resolve(file);
  for (;;) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || current === path.resolve(file) && (!stat.isFile() || stat.nlink !== 1)) throw Error('Linked or nonregular file input refused.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return readFile(file);
}
const absent = async file => { try { await lstat(file); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };

// A virtual, verified overlay permits receipt lookup before copying a large assembly.
// Its path mapping matches companion-check (existing core payload wins over a pack).
export async function fileProject({ coreRoot, privateRoot, packsDir, textOverrides = [] }) {
  const entries = new Map();
  const addTree = async (root, overlay = false) => {
    if (!root) return;
    const tree = await hashTree(root);
    for (const file of tree.files) {
      if (file.path.split('/').some(p => ['.git', '.local', 'node_modules', 'var'].includes(p))) continue;
      if (overlay && entries.has(file.path) && !file.path.startsWith('tests/') && !['scripts/test.mjs', 'scripts/test-selection.mjs','scripts/adaptive-test-runner.mjs'].includes(file.path)) throw Error('Private overlay would replace shared code.');
      entries.set(file.path, { path: file.path, sha256: file.sha256, source: path.join(root, file.path) });
    }
  };
  await addTree(coreRoot); await addTree(privateRoot, true);
  if (packsDir) {
    const selection = JSON.parse(await regularInput(path.join(packsDir, 'selection.json')));
    for (const kind of ['data', 'rulesText', 'art']) {
      const pin = selection[kind]; relative(pin.id); relative(pin.version);
      const root = path.join(packsDir, pin.id, pin.version);
      const bytes = await regularInput(path.join(root, 'pack.json'));
      if (sha(bytes) !== pin.sha256) throw Error('File evidence pack pin changed.');
      for (const record of JSON.parse(bytes).files) {
        let name = relative(record.path);
        const source = path.join(root, name), payload = await regularInput(source);
        if (payload.length !== record.bytes || sha(payload) !== record.sha256) throw Error('File evidence pack bytes changed.');
        if (kind === 'art') {
          if (name.startsWith('resources/')) { /* unchanged */ }
          else if (name.startsWith('world-images/')) name = 'reference/original-picker/' + name.slice(13);
          else if (name.startsWith('map-assets/')) name = '.local/' + name;
          else if (name.startsWith('task-item-artwork.')) name = 'app/web/' + name;
          else continue;
        } else if (name.startsWith('local-map/')) name = '.local/map-assets/' + name.slice(10);
        else if (name.startsWith('local-game/')) name = '.local/game-data/' + name.slice(11);
        else if (/^(?:indexes\/|provenance\.json$)/.test(name)) continue;
        if (!entries.has(name)) entries.set(name, { path: name, sha256: record.sha256, source });
      }
    }
  }
  for (const input of textOverrides) {
    if (!['app/data/changelog.json', 'app/data/roadmap.json'].includes(input.path)) throw Error('Text input refused.');
    const bytes = await regularInput(input.source);
    if (sha(bytes) !== input.sha256) throw Error('Text input changed.');
    entries.set(input.path, { path: input.path, sha256: input.sha256, source: input.source });
  }
  return { entries, files: [...entries.keys()].filter(p => /^tests\/[^/]+\.test\.mjs$/.test(p)).sort() };
}

export const VOLATILE_INPUTS = Object.freeze(['app/data/changelog.json', 'app/data/roadmap.json']);
const codeName = name => /\.(?:mjs|cjs|js)$/.test(name);
const resolveFrom = (from, specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier.replace(/[?#].*$/, '')));
const parents = name => { const result = []; for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) result.push(name.slice(0, i)); result.push(''); return result; };
// Static reasons that leave no usable hypothesis. Everything else the run's trace checks.
const blocking = /^(?:unsupported JavaScript syntax|test module mock|nested test runner|escaped import specifier|unrecognized|unbalanced)/;

/**
 * Plans are trace-verified static hypotheses. The contract binds the static
 * closure (imports, literal dynamic imports, new URL(literal, import.meta.url)
 * files, reviewed computed-import targets and reads), every package.json, and,
 * when any closure module can reach other inputs (fs, children, workers,
 * loaders, network, evaluation, computed imports), two digests: <data-floor>
 * (every non-code entry except volatile text) and <tree> (every entry name).
 * Reuse also needs the run's trace to show it observed only what this binds
 * (traceVerdict). Unparseable modules, mocks, nested runners and imports from
 * outside the project always run.
 * declarations: scripts/test-inputs.json, { schema: 'rs3-test-inputs-v2',
 * volatile: [names], modules: { name: { computedImports: { expression: [targets] },
 * reads: [names, or 'dir/' prefixes] } } }. A computed-import model applies only
 * to the exact expression text, and the trace still checks what was loaded.
 */
export async function filePlan({ project, lane, execution, runnerPins, declarations = {}, runtimeOS = {release:os.release(),version:os.version()} }) {
  const model = declarations?.schema === 'rs3-test-inputs-v2' ? declarations : { modules: {} };
  const volatile = new Set([...VOLATILE_INPUTS, ...(model.volatile ?? [])]);
  const names = [...project.entries.keys()].sort();
  const floorName = name => project.entries.has(name) && !codeName(name) && !volatile.has(name);
  const dirs = new Set(), floorDirs = new Set();
  for (const name of names) for (const parent of parents(name)) { dirs.add(parent); if (floorName(name)) floorDirs.add(parent); }
  const floor = { path: '<data-floor>', sha256: digestValue(names.filter(floorName).map(name => [name, project.entries.get(name).sha256])) };
  const tree = { path: '<tree>', sha256: digestValue(names) };
  const packages = names.filter(name => name === 'package.json' || name.endsWith('/package.json'));
  const world = { entries: project.entries, dirs, floorDirs, floorName };
  const nodes = new Map();
  const scan = async name => {
    if (nodes.has(name)) return nodes.get(name);
    const node = { edges: [], inputs: [], reasons: [], open: false, declaration: null };
    nodes.set(name, node);
    const entry = project.entries.get(name);
    if (!codeName(name)) return node;
    const bytes = await regularInput(entry.source);
    if (sha(bytes) !== entry.sha256) throw Error('Static input changed while planning.');
    const scanned = scanModule(bytes.toString('utf8'), { commonjs: !name.endsWith('.mjs') });
    node.reasons.push(...scanned.hazards.filter(hazard => blocking.test(hazard)));
    if (!scanned.lexed) return node;
    const edge = (specifier, kind) => {
      if (!/^\.{1,2}\//.test(specifier)) { if (kind === 'import' && /^(?:file:|\/|[A-Za-z]:)/.test(specifier)) node.reasons.push('absolute static import'); return; }
      const target = resolveFrom(name, specifier);
      if (target.startsWith('../') || target === '..') { if (kind === 'import') node.reasons.push('static import outside the project'); return; }
      if (project.entries.has(target)) node.edges.push(target);
      // Browser modules reached as files import names the web server maps. Node
      // cannot load an absent import, so whatever the run loaded instead is in the
      // trace, and the absent name is bound through <tree>.
      else if (!dirs.has(target.replace(/\/$/, ''))) node.open = true;
    };
    for (const specifier of scanned.imports) edge(specifier, 'import');
    for (const specifier of scanned.dynamicImports) edge(specifier, 'dynamic import');
    for (const specifier of scanned.urlLiterals) edge(specifier, 'file URL');
    const modeled = model.modules?.[name];
    for (const expression of scanned.computedImports) {
      const targets = modeled?.computedImports?.[expression];
      node.open = true;
      if (Array.isArray(targets)) for (const target of targets) { relative(target); if (project.entries.has(target)) node.edges.push(target); }
    }
    for (const read of modeled?.reads ?? []) {
      if (read.endsWith('/')) { relative(read.slice(0, -1)); node.inputs.push(...names.filter(other => other.startsWith(read))); }
      else { relative(read); if (project.entries.has(read)) node.inputs.push(read); else node.open = true; }
    }
    if (modeled) node.declaration = { file: name, ...modeled };
    if (scanned.capabilities.length) node.open = true;
    return node;
  };
  const plans = [];
  for (const file of project.files) {
    const covered = new Set(), visited = new Set(), reasons = new Set(), declared = [];
    let open = false;
    // Declared reads bind bytes only; a module also read as text is still scanned.
    for (const stack = [file]; stack.length;) {
      const name = stack.pop();
      if (visited.has(name)) continue;
      visited.add(name);
      covered.add(name);
      const node = await scan(name);
      for (const reason of node.reasons) reasons.add(`${name}: ${reason}`);
      if (node.open) open = true;
      if (node.declaration) declared.push(node.declaration);
      for (const input of node.inputs) covered.add(input);
      stack.push(...node.edges);
    }
    for (const name of packages) covered.add(name);
    const inputs = [...covered].sort().map(name => ({ path: name, sha256: project.entries.get(name).sha256 }));
    if (open) inputs.push(floor, tree);
    declared.sort((a, b) => a.file.localeCompare(b.file));
    const contract = gateContract('file-' + lane, { schema: 'rs3-test-file-v2', file, inputs, declarations: declared, runnerPins, os: runtimeOS }, execution);
    const plan = { file, contract, alwaysRun: reasons.size > 0, reasons: [...reasons].sort() };
    // The bound scope stays off the JSON plan; traceVerdict reads it after a run.
    Object.defineProperty(plan, 'scope', { value: { names: covered, floor: open, tree: open, world }, enumerable: false });
    plans.push(plan);
  }
  return plans;
}

/** Phase B's content-only key: test inputs and reviewed models, no tooling or host. */
export const contentKey = contract => digestValue({ schema: 'rs3-test-content-v1', file: contract.inputs.file, inputs: contract.inputs.inputs, declarations: contract.inputs.declarations });

const loopback = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])\|(\d+)$/i;
const lower = value => value.toLowerCase();
/**
 * Whether one passing run observed only what its plan's contract binds. The
 * trace must be complete (rs3-test-trace-v2 with cross-file annotations from
 * runAdaptive), free of hazards and outside paths, with connections only to
 * ports it listened on itself. Project entries must be bound; project
 * directories need <tree> to be listed or, unless they hold a bound entry, to
 * be checked; other names must have been absent at lane start and either made
 * by this file or bound as absences through <tree>.
 */
export function traceVerdict(plan, trace, { flaky = false } = {}) {
  const reasons = [];
  const fail = reason => { if (reasons.length < 12) reasons.push(reason); };
  const scope = plan?.scope;
  if (!plan || plan.alwaysRun) fail('always-run plan');
  if (!scope) fail('plan scope missing');
  if (flaky) fail('passed only on retry');
  if (trace?.schema !== 'rs3-test-trace-v2' || !Array.isArray(trace.foreign) || !Array.isArray(trace.created) || !Array.isArray(trace.scratchExisted)) fail('trace missing or not annotated');
  if (reasons.length) return { verified: false, reasons };
  if (!trace.processes) fail('no traced process');
  for (const hazard of trace.hazards) fail('hazard: ' + hazard);
  if (trace.outsideCount) fail(`${trace.outsideCount} paths outside the assembly and lane scratch`);
  for (const peer of trace.connects) {
    const port = loopback.exec(peer)?.[1];
    if (!(peer.includes('|') ? port && trace.listens.includes(port) : trace.listens.includes(peer))) fail('connection ' + peer);
  }
  if (trace.foreignCount) fail(`${trace.foreignCount} observations touched by other files`);
  for (const name of trace.scratchExisted) fail('scratch file older than the lane ' + name);
  const { names, floor, tree, world } = scope;
  const bound = name => names.has(name) || floor && world.floorName(name);
  const created = new Set(trace.created.map(lower));
  const own = [...trace.write, ...trace.make].filter(name => !name.endsWith('*') && created.has(lower(name))).map(lower);
  const ownGlobs = trace.make.filter(name => name.endsWith('*')).map(name => lower(name.slice(0, -1)));
  const owned = name => { const key = lower(name); return own.some(o => key === o || key.startsWith(o + '/')) || ownGlobs.some(g => key.startsWith(g)); };
  const holdsBound = dir => [...names].some(name => name.startsWith(dir ? dir + '/' : '')) || floor && world.floorDirs.has(dir);
  for (const kind of ['read', 'stat', 'list', 'tree']) for (const name of trace[kind]) {
    if (world.entries.has(name)) { if (!bound(name)) fail(`${kind} of unbound input ${name}`); continue; }
    if (world.dirs.has(name)) {
      if (kind === 'tree') { if (![...world.entries.keys()].every(other => !other.startsWith(name ? name + '/' : '') || bound(other))) fail('copied unbound tree ' + (name || '.')); }
      else if (kind === 'list' ? !tree : !(tree || holdsBound(name))) fail(`${kind} of project directory ${name || '.'}`);
      continue;
    }
    if (!created.has(lower(name))) fail(`${kind} of non-project path present at lane start ${name}`);
    else if (!owned(name) && !tree) fail(`${kind} of absent path ${name}`);
  }
  return { verified: reasons.length === 0, reasons };
}
/** Only a pass whose trace verified its contract can stand in for a run. */
export async function readFilePass(directory, plan, { retained = false } = {}) {
  if (plan.alwaysRun) return null;
  const pass = await verifyFilePass(path.join(directory, plan.contract.lane + '-' + plan.contract.key + '.json'), plan, { retained }).catch(() => null);
  return pass?.record.metrics?.trace?.verified === true ? pass : null;
}
export async function verifyFilePass(filename, plan, { retained = false, allowAlways = false } = {}) {
  if (plan.alwaysRun && !allowAlways) throw Error('Opaque test must run.');
  const item = JSON.parse(await regularInput(filename));
  const { digest, ...body } = item;
  const now = Date.now(), started = Date.parse(item.startedAt), completed = Date.parse(item.completedAt);
  if (item.schema !== 'rs3-test-file-pass-v1' || digest !== digestValue(body) || item.passed !== true || item.exitCode !== 0 || item.cleanupVerified !== true
      || digestValue(item.contract) !== digestValue(plan.contract) || item.file !== plan.file || item.alwaysRun !== plan.alwaysRun
      || !Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > now || !retained && now - completed > gatePolicy.receiptMaxAgeMs
      || typeof item.origin?.kit !== 'string' || typeof item.origin?.receipt !== 'string') throw Error('File receipt missing, stale or changed.');
  return { filename, record: item, reused: true };
}
export async function publishFilePass(directory, plan, { kit, coreSHA, startedAt, metrics, cleanupVerified, runId }) {
  if (cleanupVerified !== true) throw Error('File proof requires cleaned execution.');
  await mkdir(directory, { recursive: true });
  // Unreusable proof never takes the key's slot.
  const reusable = !plan.alwaysRun && metrics?.trace?.verified === true;
  const filename = path.join(directory, plan.contract.lane + '-' + plan.contract.key + (reusable ? '' : '-' + randomUUID()) + '.json');
  const body = { schema: 'rs3-test-file-pass-v1', file: plan.file, contract: plan.contract, alwaysRun: plan.alwaysRun, passed: true, exitCode: 0, cleanupVerified: true, startedAt, completedAt: new Date().toISOString(), metrics, runId:runId??null,
    origin: { kit, coreSHA, receipt: filename } };
  const item = { ...body, digest: digestValue(body) };
  // Replace invalid same-key proof only after a genuine run; preserve old bytes.
  if (!await absent(filename)) await rename(filename, filename + '.rejected-' + randomUUID());
  await atomicJSON(filename, item);
  return { filename, record: item, reused: false };
}
export async function retainFilePass(item, directory) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, path.basename(item.filename));
  if (filename !== item.filename) await atomicJSON(filename, item.record);
  return { filename, record: item.record, reused: item.reused, sourceKit: item.record.origin.kit, sourceReceipt: item.record.origin.receipt };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('File evidence library: trace-verified static closures, reviewed computed-import models, fail-closed file receipts.');
  else { console.error('Import this library from release-v2.'); process.exitCode = 1; }
}
