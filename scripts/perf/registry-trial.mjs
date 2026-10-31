import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openRegistry, registryRecoveryDocument } from '../../app/storage/registry.mjs';
import { openRegistryBackend } from '../../app/storage/registry-backend.mjs';
import { writeRegistryJson } from '../../app/storage/registry-lock.mjs';

const { values } = parseArgs({ options: { internal: { type: 'string' }, out: { type: 'string' }, baseline: { type: 'string' } } });
const elapsed = start => performance.now() - start;
const quantile = (rows, p) => [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * p) - 1];
function synthetic(count) {
  const accounts = [], pickers = [], at = new Date(0).toISOString();
  for (let n = 0; n < count; n++) {
    const id = randomUUID(), pickerId = 'p_' + randomBytes(16).toString('hex');
    accounts.push({ id, identities: [{ provider: 'discord', subject: 'synthetic-' + n }], memberships: [{ pickerId, role: 'owner', memberId: 'owner' }], defaultPickerId: pickerId, createdAt: at });
    pickers.push({ id: pickerId, kind: 'default', ownerAccountId: id, lifecycle: 'active', provisioning: 'ready', memberIds: ['owner'], createdAt: at });
  }
  return { schemaVersion: 1, accounts, pickers, capabilities: [] };
}
async function seed(root, registryBackend, document) {
  const options = { registryBackend, registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'),
    caps: { accounts: document.accounts.length + 10, pickers: document.pickers.length + 10 } };
  for (const dir of [options.registryDir, options.pickerRoot, options.tombstoneDir]) await mkdir(dir);
  const storage = await openRegistryBackend({ ...options, validate: registryRecoveryDocument });
  await storage.commit(document); storage.close();
  await writeRegistryJson(path.join(options.tombstoneDir, 'ledger.json'), { schemaVersion: 1, issuedPickerIds: document.pickers.map(p => p.id), pickers: [], accounts: [] });
  return options;
}
async function measure(config) {
  const document = JSON.parse(await readFile(config.input, 'utf8'));
  const options = await seed(config.root, config.backend, document);
  let start = performance.now(); const registry = await openRegistry(options); const openMs = elapsed(start);
  try {
    const id = document.accounts[0].id;
    for (let n = 0; n < 4; n++) {
      await registry.linkIdentity(id, 'google', 'synthetic-linked'); await registry.unlinkIdentity(id, 'google');
    }
    const commits = [];
    for (let n = 0; n < 40; n++) {
      start = performance.now();
      if (n % 2 === 0) await registry.linkIdentity(id, 'google', 'synthetic-linked'); else await registry.unlinkIdentity(id, 'google');
      commits.push(elapsed(start));
    }
    const reads = [];
    for (let n = 0; n < 20; n++) {
      start = performance.now();
      for (let j = 0; j < 1000; j++) {
        if (!registry.findIdentity('discord', 'synthetic-' + (j % document.accounts.length))) throw Error('Synthetic lookup failed.');
      }
      reads.push(elapsed(start) * 1000);
    }
    const files = await readdir(options.registryDir);
    const registryBytes = (await Promise.all(files.filter(n => n !== 'registry.lock').map(n => stat(path.join(options.registryDir, n))))).reduce((n, s) => n + s.size, 0);
    return { backend: config.backend, accounts: document.accounts.length, openMs,
      commitMedianMs: quantile(commits, .5), commitP95Ms: quantile(commits, .95),
      readMedianNs: quantile(reads, .5), readP95Ns: quantile(reads, .95),
      peakRSSBytes: process.resourceUsage().maxRSS * 1024, registryBytes,
      ledgerBytes: (await stat(path.join(options.tombstoneDir, 'ledger.json'))).size };
  } finally { await registry.close(); }
}
async function bytes(checkout, root, input) {
  const options = await seed(root, 'json', JSON.parse(await readFile(input, 'utf8')));
  const { openRegistry: open } = await import(pathToFileURL(path.join(checkout, 'app/storage/registry.mjs')));
  const registry = await open({ ...options, now: () => 0 });
  const cuts = [];
  const capture = async () => cuts.push({ registry: (await readFile(path.join(options.registryDir, 'registry.json'))).toString('base64'), ledger: (await readFile(path.join(options.tombstoneDir, 'ledger.json'))).toString('base64') });
  try {
    await capture();
    const id = registry.listAccounts()[0].id;
    await registry.linkIdentity(id, 'google', 'synthetic-linked'); await capture();
    await registry.unlinkIdentity(id, 'google'); await capture();
    await registry.beginPickerDeletion(registry.listAccounts()[0].defaultPickerId); await capture();
    await registry.deleteAccount(id); await capture();
  } finally { await registry.close(); }
  return cuts;
}
async function main() {
  if (values.internal) {
    const config = JSON.parse(await readFile(values.internal, 'utf8'));
    await writeFile(config.result, JSON.stringify(await measure(config))); return;
  }
  if (!values.out) throw Error('Use --out <report.json> [--baseline <START worktree>].');
  const root = await mkdtemp(path.join(tmpdir(), 'registry-trial-')), runs = [];
  try {
    let byteDifferences;
    for (const count of [10, 1000, 10000]) {
      const input = path.join(root, `synthetic-${count}.json`); await writeFile(input, JSON.stringify(synthetic(count)));
      if (count === 10 && values.baseline) {
        const beforeRoot = await mkdtemp(path.join(root, 'before-')), afterRoot = await mkdtemp(path.join(root, 'after-'));
        const before = await bytes(path.resolve(values.baseline), beforeRoot, input);
        const after = await bytes(fileURLToPath(new URL('../../', import.meta.url)), afterRoot, input);
        byteDifferences = before.filter((row, n) => JSON.stringify(row) !== JSON.stringify(after[n])).length;
      }
      for (let run = 0; run < 3; run++) for (const backend of ['json', 'sqlite']) {
        const runRoot = await mkdtemp(path.join(root, 'run-'));
        const config = { root: runRoot, input, backend, result: path.join(runRoot, 'result.json') };
        const configFile = path.join(runRoot, 'config.json'); await writeFile(configFile, JSON.stringify(config));
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--internal', configFile], { stdio: ['ignore', 'ignore', 'inherit'] });
        const [code] = await once(child, 'close'); if (code !== 0) throw Error('Measurement child failed.');
        const result = JSON.parse(await readFile(config.result, 'utf8')); runs.push({ run: run + 1, ...result });
        console.log(JSON.stringify({ run: run + 1, ...result }));
        await rm(runRoot, { recursive: true, force: true });
      }
    }
    const report = { node: process.version, byteDifferences, commitSamplesPerRun: 40, readBatchesPerRun: 20, readsPerBatch: 1000, runs };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (byteDifferences) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}
await main();
