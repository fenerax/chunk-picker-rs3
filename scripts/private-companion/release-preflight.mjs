// Read-only release intake. No locks, assembly, builders, servers or gate receipts.
import path from 'node:path';
import { readFile, readdir, lstat, mkdir, writeFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inventoryMissing, practiceInventoryLivePayload } from './practice-inventory.mjs';
import { assertLivePayloadTarget, livePayloadProof } from './live-payload-rules.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const inside = (root, target) => { const r = path.relative(root, target); return !r || r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
const fail = (message, details = {}) => { const error = new Error(message); error.details = details; throw error; };
const safeName = name => typeof name === 'string' && !!name && !/[\\:\u0000-\u001f]/.test(name) && !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..');
async function regular(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if ((await lstat(p)).isSymbolicLink()) fail('Linked inputs are refused.');
    if (path.dirname(p) === p) break;
  }
  const s = await lstat(file);
  if (!s.isFile() || s.nlink !== 1) fail('A regular, single-link input is required.');
  return file;
}
async function bytes(file) {
  await regular(file);
  const a = await lstat(file), value = await readFile(file), b = await lstat(file);
  if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].some(k => a[k] !== b[k])) fail('An input changed during inspection.');
  return value;
}
async function safeOutput(output, inputRoots, inputFiles) {
  for (const root of inputRoots) if (inside(root, output)) fail('Receipt must be outside every input directory.');
  const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (inputFiles.some(file => equal(file, output))) fail('Receipt cannot replace an input file.');
  for (let p = path.dirname(output); ; p = path.dirname(p)) {
    try {
      const stat = await lstat(p);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !equal(await realpath(p), p)) fail('Receipt parent must use ordinary canonical directories.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(p) === p) break;
  }
}
async function files(root, prefix = '') {
  if ((await lstat(root)).isSymbolicLink()) fail('Linked directories are refused.');
  const names = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!safeName(name) || entry.isSymbolicLink()) fail('Unsafe inventory entry.');
    if (entry.isDirectory()) names.push(...await files(path.join(root, entry.name), name + '/'));
    else if (entry.isFile()) names.push(name);
    else fail('Non-regular inventory entry.');
  }
  return names.sort();
}

/** Scoped in-memory modules use committed Git blobs, never the checkout's code.
 * Only the two data constants and private selector are overlaid. import.meta.url
 * retains its filesystem meaning; no module is exported or written to scratch.
 */
function committedModules({ git, core, source }) {
  const host = randomUUID(), roots = new Map(), cache = new Map();
  const prefix = `rs3-preflight://${host}/`;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(prefix)) return { url: specifier, shortCircuit: true };
      if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
        const url = new URL(specifier, context.parentURL).href;
        if (!url.startsWith(prefix)) fail('Module escaped committed source.');
        return { url, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(prefix)) return next(url, context);
      const [scope, ...parts] = decodeURIComponent(new URL(url).pathname.slice(1)).split('/');
      const name = parts.join('/');
      if (!safeName(name) || !roots.has(scope)) fail('Committed module path refused.');
      const overlay = scope === 'private' && ['app/dataset-inputs.mjs', 'app/legacy-game-defaults.mjs', 'scripts/test-selection.mjs'].includes(name);
      let text = overlay ? readFileSync(path.join(source, name), 'utf8') : git('show', `${roots.get(scope)}:${name}`).toString('utf8');
      if (name === 'scripts/test-selection.mjs') text += '\nexport const __preflightRegistered = [...quickTests, ...fullOnlyTests];\n';
      text = text.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(overlay ? source : core, name)).href));
      return { format: 'module', source: text, shortCircuit: true };
    },
  });
  return {
    async get(scope, revision, name) {
      roots.set(scope, revision);
      const key = scope + '/' + name;
      if (!cache.has(key)) cache.set(key, import(prefix + key));
      return cache.get(key);
    },
    close: () => hook.deregister(),
  };
}

export async function releasePreflight(options, { progress = () => {}, practiceInventory, livePayload } = {}) {
  livePayload ??= practiceInventory === undefined ? undefined : practiceInventoryLivePayload(practiceInventory);
  const startedAt = new Date().toISOString(), started = performance.now(), checks = [];
  const core = path.resolve(options.core), source = path.resolve(options.source), packs = path.resolve(options.packs);
  const kit = options.kit ? path.resolve(options.kit) : null;
  const accepted = options.acceptedKit ? path.resolve(options.acceptedKit) : null;
  const selectionPath = path.resolve(options.selection ?? path.join(packs, 'selection.json'));
  const corpusDir = options.corpus ? path.resolve(options.corpus) : (kit ?? accepted) && path.join(kit ?? accepted, 'release-gate/corpus');
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', core, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 ** 2 });
  const check = async (id, action) => {
    const begin = performance.now(); progress(`START ${id}`);
    let row;
    try { const details = await action(); row = { id, status: 'pass', ...details }; }
    catch (error) { row = { id, status: 'fail', summary: error.details ? error.message : 'Check could not complete; input is missing, invalid or incompatible.', ...(error.details ?? {}), ...(error.code ? { errorCode: String(error.code).replace(/[^A-Z0-9_-]/g, '') } : {}) }; }
    row.seconds = Number(((performance.now() - begin) / 1000).toFixed(3)); checks.push(row);
    progress(`${row.status.toUpperCase()} ${id} (${row.seconds}s): ${row.summary}`);
    return row;
  };
  let revision, base, commits, names, modules, coreTestBytes, selection, selectionHash, manifests, catalogue, profile, profileHash, pins, hashTree, sourceIdentity, corpusIdentity;
  const payloadFingerprints = new Map();
  const fingerprint = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':');
  try {
    await check('private-snapshot', async () => {
      ({ hashTree } = await import(pathToFileURL(await regular(path.join(source, 'scripts/private-companion/release-identity.mjs')))));
      sourceIdentity = await hashTree(source);
      if (!corpusDir) fail('An explicit corpus or accepted/staged kit is required.');
      corpusIdentity = await hashTree(corpusDir);
      return { summary: 'Private source and scanner corpus captured for end-of-run stability check.', sourceDigest: sourceIdentity.digest, corpusDigest: corpusIdentity.digest, sourceFiles: sourceIdentity.files.length };
    });
    await check('core-reference', async () => {
      if (typeof options.ref !== 'string' || options.ref.startsWith('-') || typeof options.base !== 'string' || options.base.startsWith('-')) fail('Core ref and accepted base are required.');
      revision = git('rev-parse', '--verify', `${options.ref}^{commit}`).toString().trim();
      base = git('rev-parse', '--verify', `${options.base}^{commit}`).toString().trim();
      if (!/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(base)) fail('Exact SHA-1 commits are required.');
      git('merge-base', '--is-ancestor', base, revision);
      commits = git('rev-list', '--reverse', `${base}..${revision}`).toString().trim().split('\n').filter(Boolean);
      names = git('ls-tree', '-rz', '--name-only', revision).toString().split('\0').filter(Boolean);
      modules = committedModules({ git, core, source });
      if (livePayload !== undefined) await assertLivePayloadTarget(livePayload, { source, revision });
      return { summary: `${commits.length} new commits, all ancestry included.`, revision, base, commits };
    });
    await check('core-worktree', async () => {
      if (!revision) fail('Core reference unavailable.');
      if(options.objectOnly===true) {
        // All tested application modules and inventories below come from Git
        // objects, not HEAD/worktree files. This is the paired worker's mode.
        if(git('rev-parse','--is-shallow-repository').toString().trim()!=='false')fail('Complete committed history required.');
        git('cat-file','-e',revision+'^{tree}');
        return {summary:'Exact committed objects selected; working tree is not a release input.',revision,objectOnly:true};
      }
      const head = git('rev-parse', 'HEAD').toString().trim();
      const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString().split('\0').filter(Boolean);
      const issues = [];
      if (head !== revision) issues.push('HEAD differs from requested commit');
      if (status.length) issues.push('worktree has tracked or untracked changes');
      if (issues.length) fail(issues.join('; ') + '.', { head, revision, statusEntries: status.length });
      return { summary: 'Worktree is clean and HEAD equals the requested SHA.', head };
    });
    await check('history', async () => {
      if (!commits || !corpusDir) fail('History requires a valid commit range and an explicit corpus or kit.');
      const tooling = path.join(source, 'scripts/secret-scan');
      const { scanEntries, loadReviewed } = await import(pathToFileURL(await regular(path.join(tooling, 'scan.mjs'))));
      const { loadCorpus } = await import(pathToFileURL(await regular(path.join(tooling, 'fingerprints.mjs'))));
      const corpus = await loadCorpus(corpusDir);
      const reviewed = loadReviewed(await regular(path.join(tooling, 'reviewed.json')));
      const trees = [], scannedEntries = new Map();
      for (const ref of new Set([...commits, revision])) {
        try {
          const rows = git('ls-tree', '-rz', ref).toString().split('\0').filter(Boolean).map(row => {
            const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
            if (!match || !safeName(match[3])) fail('Non-regular or unsafe committed path.');
            return { oid: match[2], name: match[3] };
          });
          const batch = execFileSync('git', ['--no-optional-locks', '-C', core, 'cat-file', '--batch'], { input: rows.map(r => r.oid + '\n').join(''), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 ** 3 });
          let offset = 0;
          const entries = rows.map(row => {
            const end = batch.indexOf(10, offset), match = /^([a-f0-9]{40}) blob (\d+)$/.exec(batch.subarray(offset, end).toString());
            if (!match || match[1] !== row.oid) fail('Git blob header refused.');
            const length = Number(match[2]); offset = end + 1;
            const value = batch.subarray(offset, offset + length); offset += length + 1;
            if (value.length !== length || createHash('sha1').update(`blob ${length}\0`).update(value).digest('hex') !== row.oid) fail('Git blob bytes changed.');
            return { path: row.name, bytes: value };
          });
          const results = entries.map((entry, index) => {
            const key = entry.path + '\0' + rows[index].oid;
            if (!scannedEntries.has(key)) scannedEntries.set(key, scanEntries([entry], { corpus, reviewed }));
            return scannedEntries.get(key);
          });
          const unique = new Map(results.flatMap(r => r.findings).map(f => [JSON.stringify([f.category, f.path, f.line]), f]));
          const findings = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.category.localeCompare(b.category));
          const categories = {};
          for (const finding of findings) categories[finding.category] = (categories[finding.category] ?? 0) + 1;
          trees.push({ revision: ref, status: findings.length ? 'blocked, not clean' : 'clean', files: entries.length, categories, findings });
        } catch { trees.push({ revision: ref, status: 'error', reason: 'Tree scan could not complete.' }); }
      }
      const bad = trees.filter(t => t.status !== 'clean');
      if (bad.length) fail(`${bad.length}/${trees.length} history trees refused.`, { trees, uniqueEntriesScanned: scannedEntries.size });
      return { summary: `${trees.length} complete committed trees clean.`, trees, uniqueEntriesScanned: scannedEntries.size, reuse: 'Identical path/blob pairs reuse the same imported scanner result within this invocation only.' };
    });
    await check('noreply', async () => {
      if (!commits) fail('Attribution requires a valid commit range.');
      const refused = [];
      for (const ref of commits) {
        const [author, committer] = git('show', '-s', '--format=%ae%n%ce', ref).toString().trim().split('\n');
        const authorApproved = author === 'fenerax@users.noreply.github.com', committerApproved = committer === 'fenerax@users.noreply.github.com';
        if (!authorApproved || !committerApproved) refused.push({ revision: ref, authorApproved, committerApproved });
      }
      if (refused.length) fail(`${refused.length}/${commits.length} commits have unapproved author or committer attribution.`, { refused });
      return { summary: `Author and committer approved on all ${commits.length} new commits.` };
    });
    for (const scope of ['public', 'private']) await check(`test-inventory-${scope}`, async () => {
      if (!modules) fail('Inventory requires a valid core reference.');
      if (!coreTestBytes) {
        const testNames = names.filter(n => n.startsWith('tests/'));
        const batch = execFileSync('git', ['--no-optional-locks', '-C', core, 'cat-file', '--batch'], { input: testNames.map(n => `${revision}:${n}\n`).join(''), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 ** 2 });
        let offset = 0; coreTestBytes = new Map();
        for (const name of testNames) {
          const end = batch.indexOf(10, offset), header = /^[a-f0-9]{40} blob (\d+)$/.exec(batch.subarray(offset, end).toString());
          if (!header) fail('Test Git blob refused.');
          const size = Number(header[1]); offset = end + 1;
          const value = batch.subarray(offset, offset + size); offset += size + 1;
          if (value.length !== size) fail('Truncated test Git blob.');
          coreTestBytes.set(name.slice(6), value);
        }
      }
      const testMap = new Map([...coreTestBytes].map(([n, value]) => [n, () => value]));
      if (scope === 'private') for (const n of await files(path.join(source, 'tests'))) testMap.set(n, () => bytes(path.join(source, 'tests', n)));
      const selector = await modules.get(scope, revision, 'scripts/test-selection.mjs');
      const ports = await modules.get('public', revision, 'scripts/test-port-check.mjs');
      const discovered = [...testMap.keys()].filter(n => n.endsWith('.test.mjs')).sort();
      const unclassified = discovered.filter(n => n.includes('/') || !['quick', 'full-only'].includes(selector.classifyTest(n)));
      if (!Array.isArray(selector.__preflightRegistered)) fail('Selector explicit registration inventory is unavailable.');
      const { missing, tolerated } = inventoryMissing(selector.__preflightRegistered, [...testMap.keys()], scope === 'private' ? practiceInventory : undefined);
      const portViolations = [];
      for (const name of discovered) for (const row of ports.hardCodedTestPorts((await testMap.get(name)()).toString('utf8'))) portViolations.push({ name, ...row });
      const inventory = discovered.map(name => ({ name, lane: selector.classifyTest(name) }));
      if (!discovered.length || unclassified.length || missing.length || portViolations.length) fail(`${unclassified.length} unclassified, ${missing.length} missing registrations, ${portViolations.length} port violations.`, { discovered: discovered.length, missing, unclassified, portViolations, inventory, ...(practiceInventory ? { tolerated } : {}) });
      return { summary: tolerated.length ? `${discovered.length} tests classified; ${tolerated.length} proved practice-only missing registrations.` : `${discovered.length} tests classified; all ${selector.__preflightRegistered.length} explicit registrations exist.`, inventory, ...(practiceInventory ? { tolerated } : {}) };
    });
    await check('pack-manifests', async () => {
      if (!modules) fail('Pack checks require committed core validation modules.');
      const { PACK_VERSION, packRelative } = await modules.get('public', revision, 'app/packs.mjs');
      const { DATASET_CONTRACT, DATASET_LIMITS } = await modules.get('public', revision, 'app/datasets.mjs');
      const selectionBytes = await bytes(selectionPath); selectionHash = sha(selectionBytes);
      selection = json(selectionBytes); manifests = {};
      if (selection.schemaVersion !== 1) fail('Selection schema refused.');
      const failures = [];
      for (const [kind, id] of [['data', 'duo-data'], ['rulesText', 'duo-rules-text']]) {
        try {
        const choice = selection[kind];
        if (choice?.id !== id || !PACK_VERSION.test(choice.version ?? '') || !/^[a-f0-9]{64}$/.test(choice.sha256 ?? '')) fail(`Invalid ${kind} selection.`);
        const payload = await bytes(path.join(packs, id, choice.version, 'pack.json'));
        if (sha(payload) !== choice.sha256 || payload.length > DATASET_LIMITS.manifestBytes) fail(`${kind} manifest pin or size refused.`);
        const m = json(payload);
        if (m.schemaVersion !== 1 || m.id !== id || m.version !== choice.version || m.kind !== (kind === 'data' ? 'data' : 'rules-text') || m.distribution !== 'private-local' || !Array.isArray(m.files) || m.files.length > DATASET_LIMITS.files || Object.keys(DATASET_CONTRACT).some(k => m.requires?.[k] !== DATASET_CONTRACT[k])) fail(`${kind} manifest contract refused.`);
        const seen = new Set();
        for (const row of m.files) {
          packRelative(row.path);
          if (seen.has(row.path) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > DATASET_LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')) fail(`${kind} record refused.`);
          seen.add(row.path);
          const file = path.join(packs, id, choice.version, row.path);
          payloadFingerprints.set(file, fingerprint(await lstat(await regular(file))));
        }
        manifests[kind] = m;
        } catch { failures.push({ kind, reason: 'Selected manifest pin, identity, contract or records refused.' }); }
      }
      if (failures.length) fail(`${failures.length} selected pack manifests refused.`, { failures });
      return { summary: 'Selected data and Rules-text manifest pins and contracts match.', selectionSha256: selectionHash, choices: { data: selection.data, rulesText: selection.rulesText } };
    });
    await check('profile-inputs', async () => {
      if (!manifests?.data || !manifests?.rulesText) fail('Required-input check requires both selected manifests.');
      const c = await modules.get('private', revision, 'app/dataset-inputs.mjs');
      catalogue = { inputs: c.DATASET_INPUTS, sourceInputs: c.DATASET_SOURCE_INPUTS, valueKeys: c.DATASET_VALUE_KEYS, ruleTextValueKeys: c.RULE_TEXT_VALUE_KEYS, ruleContractValueKeys: c.DATASET_RULE_CONTRACT_VALUE_KEYS, ...(c.DATASET_DEFINITION_OVERLAYS?.length ? { definitionOverlays: c.DATASET_DEFINITION_OVERLAYS } : {}) };
      if (Object.values(catalogue).some(a => !Array.isArray(a) || a.some(n => typeof n !== 'string'))) fail('Private catalogue shape refused.');
      const { datasetSourcePath } = await modules.get('public', revision, 'app/datasets.mjs');
      const available = new Set([...manifests.data.files, ...manifests.rulesText.files].filter(r => ['input', 'evidence'].includes(r.kind)).map(r => r.path));
      const required = [...new Set([...catalogue.inputs, ...catalogue.sourceInputs])].filter(key => !datasetSourcePath(key, { root: source }).optional);
      const missing = required.filter(key => !available.has(key));
      if (missing.length) fail(`${missing.length} required profile inputs absent from selected pack pair.`, { missing });
      return { summary: `${required.length} required profile inputs present in the selected pack pair.`, required: required.length };
    });
    await check('pack-digest-contract', async () => {
      if (!catalogue || !manifests?.data || !manifests?.rulesText) fail('Digest check requires the catalogue and both manifests.');
      const api = await modules.get('private', revision, 'app/datasets.mjs');
      const digest = api.datasetDigest([...manifests.data.files, ...manifests.rulesText.files], manifests.data.capabilities, catalogue.definitionOverlays);
      if (digest !== manifests.data.datasetDigest || manifests.data.ruleContractHash !== manifests.rulesText.ruleContractHash) fail('Data digest or data/Rules-text rule contract differs.');
      if (options.profile) {
        const profileBytes = await bytes(path.resolve(options.profile)); profileHash = sha(profileBytes); profile = json(profileBytes);
        const { validateDatasetProfile } = await modules.get('public', revision, 'app/dataset-profile.mjs');
        validateDatasetProfile(profile);
        const { legacyGameDefaults } = await modules.get('private', revision, 'app/legacy-game-defaults.mjs');
        if (profile.datasetDigest !== digest || profile.ruleContractHash !== manifests.data.ruleContractHash || JSON.stringify(profile.catalogue) !== JSON.stringify(catalogue) || JSON.stringify(profile.gameDefaults) !== JSON.stringify(legacyGameDefaults)) fail('Supplied profile differs from next profile or selected pair.');
      }
      // Existing resolver hashes all data/text payloads, checks generated values
      // against raw captures, and recomputes the rule contract and dataset digest.
      const ambient = Object.fromEntries(['RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256'].map(k => [k, process.env[k]]));
      let provider;
      try {
        for (const key of Object.keys(ambient)) delete process.env[key];
        provider = await api.resolveDataset({ root: core, datasetId: 'duo-legacy', packsDir: packs, selection,
          ...catalogue, profilePath: '', profileSha256: '', legacyMetadataMapAssetsDir: null });
      } finally {
        for (const [key, value] of Object.entries(ambient)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
      if (!provider.packed || provider.digest !== digest || provider.ruleContractHash !== manifests.data.ruleContractHash) fail('Packed resolver digest or rule contract differs.');
      return { summary: `${provider.files.length} input/evidence payloads verified; digest and computed rule contract match.`, datasetDigest: digest, ruleContractHash: provider.ruleContractHash, profile: options.profile ? 'supplied profile matches next profile' : 'next profile derived from private catalogue and selected pair' };
    });
    await check('wrapper-helper-identity', async () => {
      const scripts = path.join(source, 'scripts/private-companion');
      pins = { locks: {}, operatorFiles: [], tools: [] };
      const staged = kit ? json(await bytes(path.join(kit, 'kit.json'))) : null;
      const errors = [];
      const scriptNames = (await readdir(scripts)).sort();
      for (const name of scriptNames) {
        if (!name.endsWith('.mjs') && !name.endsWith('.ps1') && name !== 'RELEASING.md') continue;
        try {
        const record = { name, sha256: sha(await bytes(path.join(scripts, name))) };
        const type = name.endsWith('.mjs') ? 'tools' : 'operator';
        if (type === 'tools') pins.tools.push(record);
        if (name.endsWith('.ps1')) pins.operatorFiles.push(record);
        if (kit && sha(await bytes(path.join(kit, type, name))) !== record.sha256) errors.push(`${type}/${name} differs from private source`);
        } catch { errors.push(`helper ${name} is missing, linked or unreadable`); }
      }
      for (const lane of ['heavy', 'light']) {
        try {
        const filename = options.memoryAdmission ? path.join(scripts, `with-${lane}.ps1`) : options[lane + 'Lock'] ?? staged?.locks?.[lane]?.path;
        if (!path.isAbsolute(filename ?? '')) { errors.push(`${lane} wrapper requires an explicit path`); continue; }
        const record = { path: path.resolve(filename), sha256: sha(await bytes(filename)) }; pins.locks[lane] = record;
        if (staged && record.sha256 !== staged.locks?.[lane]?.sha256) errors.push(`${lane} wrapper differs from kit pin`);
        } catch { errors.push(`${lane} wrapper is missing, linked or unreadable`); }
      }
      if (staged) {
        if (staged.sourceTreeDigest !== sourceIdentity?.digest) errors.push('kit private-source tree pin differs');
        if (!sourceIdentity || (await hashTree(path.join(kit, 'checks/private-source'))).digest !== sourceIdentity.digest) errors.push('staged private source differs from supplied private snapshot');
        if (staged.schemaVersion !== 2 || staged.sourceDigest !== sha(await bytes(path.join(scripts, 'release-v2.mjs')))) errors.push('release-v2 source pin differs');
        if (JSON.stringify(staged.operatorFiles) !== JSON.stringify(pins.operatorFiles)) errors.push('operator helper inventory/pins differ');
        if (JSON.stringify(staged.selection) !== JSON.stringify(selection)) errors.push('kit pack selection differs');
        const actualTools = (await readdir(path.join(kit, 'tools'))).filter(n => n.endsWith('.mjs') && n !== 'gallery-browser-check.mjs').sort();
        if (JSON.stringify(actualTools) !== JSON.stringify(pins.tools.map(r => r.name))) errors.push('staged tool inventory differs');
      }
      if (errors.length) fail(`${errors.length} wrapper/helper identity failures.`, { failures: errors, nextKitPins: pins });
      return { summary: `${pins.operatorFiles.length} operator helpers, ${pins.tools.length} tools and both wrappers verified.`, nextKitPins: pins,
        ...(kit ? {} : { skipped: [{ check: 'existing-kit-pin-comparison', reason: 'No --kit supplied; receipt records the exact pins the next kit must capture.' }] }) };
    });
    await check('input-stability', async () => {
      if (!revision) fail('Cannot recheck an unresolved core reference.');
      const drift = [];
      if (git('rev-parse', 'HEAD').toString().trim() !== revision || git('status', '--porcelain=v1', '-z', '--untracked-files=all').length) drift.push('core HEAD/worktree');
      for (const row of [...(pins?.operatorFiles ?? []), ...(pins?.tools ?? [])]) if (sha(await bytes(path.join(source, 'scripts/private-companion', row.name))) !== row.sha256) drift.push('helper ' + row.name);
      for (const [lane, row] of Object.entries(pins?.locks ?? {})) if (sha(await bytes(row.path)) !== row.sha256) drift.push(lane + ' wrapper');
      for (const kind of ['data', 'rulesText']) if (selection?.[kind]) {
        const c = selection[kind]; if (sha(await bytes(path.join(packs, c.id, c.version, 'pack.json'))) !== c.sha256) drift.push(kind + ' manifest');
      }
      if (selectionHash && sha(await bytes(selectionPath)) !== selectionHash) drift.push('pack selection');
      if (profileHash && sha(await bytes(path.resolve(options.profile))) !== profileHash) drift.push('profile');
      for (const [file, initial] of payloadFingerprints) if (fingerprint(await lstat(await regular(file))) !== initial) drift.push('selected pack payload changed');
      if (!sourceIdentity || !corpusIdentity) drift.push('initial private/corpus snapshot unavailable');
      else {
        if ((await hashTree(source)).digest !== sourceIdentity.digest) drift.push('private source');
        if ((await hashTree(corpusDir)).digest !== corpusIdentity.digest) drift.push('scanner corpus');
      }
      if (drift.length) fail('Inputs changed or worktree does not match requested commit.', { drift });
      return { summary: 'Core, private source, scanner corpus, selection, profile and captured helper pins remain stable.' };
    });
  } finally { modules?.close(); }
  const receipt = { schema: 'rs3-release-preflight-v1', advisory: true, passed: checks.every(r => r.status === 'pass'), startedAt, completedAt: new Date().toISOString(), seconds: Number(((performance.now() - started) / 1000).toFixed(3)), revision: revision ?? null, base: base ?? null, checks };
  if (practiceInventory) receipt.toleratedRegistrations = checks.flatMap(row => row.tolerated ?? []);
  if (livePayload !== undefined) receipt.livePayload = { identity: livePayloadProof(livePayload).digest, revision: livePayloadProof(livePayload).liveRevision };
  if (options.output) {
    const output = path.resolve(options.output);
    const inputRoots = [core, source, packs, kit, accepted, corpusDir].filter(Boolean);
    const inputFiles = [selectionPath, options.profile && path.resolve(options.profile), options.heavyLock && path.resolve(options.heavyLock), options.lightLock && path.resolve(options.lightLock), ...Object.values(pins?.locks ?? {}).map(p => p.path)].filter(Boolean);
    await safeOutput(output, inputRoots, inputFiles);
    await mkdir(path.dirname(output), { recursive: true });
    await safeOutput(output, inputRoots, inputFiles);
    await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return receipt;
}

const flags = { '--core': 'core', '--ref': 'ref', '--base': 'base', '--private-source': 'source', '--packs': 'packs', '--selection': 'selection', '--kit': 'kit', '--accepted-kit': 'acceptedKit', '--corpus': 'corpus', '--profile': 'profile', '--heavy-lock': 'heavyLock', '--light-lock': 'lightLock', '--output': 'output' };
export function parseArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--memory-admission') { if (result.memoryAdmission) fail('Duplicate argument.'); result.memoryAdmission = true; continue; }
    const key = flags[args[i]], value = args[++i];
    if (!key || !value || value.startsWith('--') || Object.hasOwn(result, key)) fail('Invalid preflight arguments.');
    result[key] = value;
  }
  for (const key of ['core', 'base', 'source', 'packs']) if (!result[key]) fail(`Missing required argument: ${key}.`);
  result.ref ??= 'HEAD';
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await releasePreflight(parseArguments(process.argv.slice(2)), { progress: text => console.error(text) });
    console.error(`${result.passed ? 'PASS' : 'FAIL'} preflight: ${result.checks.filter(c => c.status === 'pass').length}/${result.checks.length} checks passed in ${result.seconds}s.`);
    console.log(JSON.stringify(result)); process.exitCode = result.passed ? 0 : 1;
  } catch { console.error('Preflight invocation or receipt publication refused. Use --core --ref --base --private-source --packs and --kit or --corpus/--accepted-kit; output must be new and outside inputs.'); process.exitCode = 2; }
}
