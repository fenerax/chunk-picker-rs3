// Each invocation owns its immutable releases and mutable source store. Nothing
// from a previous invocation is patched to create a negative case.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { bindingBytes, joinChild } from '../../scripts/private-companion/release-pack-check.mjs';
import { hashTree } from '../../scripts/private-companion/release-identity.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const put = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};
export const pin = async file => ({ path: file, sha256: hash(await readFile(file)) });
const retainedFixtures = new Set();
export const retainFixture = root => retainedFixtures.add(root);
export async function cleanupFixture(t, root) {
  if (retainedFixtures.has(root)) t.diagnostic('Retained fixture with unjoined child: ' + root);
  else await rm(root, { recursive: true, force: true });
}
export async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-upgrade-owned-'));
  t.after(() => cleanupFixture(t, root));
  return root;
}

// Exit plus a bounded stderr drain; inherited pipe EOF cannot hold a stage open.
export async function runStage(root, body, expectedCode = 0, { spawnImpl = spawn, setTimer, clearTimer,
  signal: abortSignal, stageName = 'controlled transition', diagnose } = {}) {
  const file = path.join(root, 'stage-' + randomUUID() + '.ps1');
  await put(file, "[Console]::Error.WriteLine(('Fixture script entered: '+[DateTime]::UtcNow.ToString('o')))\n" + body);
  abortSignal?.throwIfAborted();
  try {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // Match the existing 30-second stage-case deadline; never wait forever in
    // its owner-join teardown after the test has already been cancelled.
    const result = await joinChild(child, { timeoutMs: 30000, setTimer, clearTimer, signal:abortSignal, diagnose, label: 'Release stage ' + stageName });
    if (!result.closed) retainFixture(root);
    const { exitCode, signal, original, stderrTail, stdout } = result;
    const acceptedCode = typeof expectedCode === 'function' ? expectedCode(exitCode) : exitCode === expectedCode;
    if (original || !acceptedCode || signal !== null) {
      throw new Error(`Release stage refused: exit=${exitCode}; signal=${signal}; original=${original?.stack ?? 'none'}; stderr tail=${stderrTail}; stdout tail=${stdout.slice(-4096)}`, { cause: original });
    }
    return result;
  } catch (error) {
    if (error.retainScratch) retainFixture(root);
    throw error;
  }
}

export async function packedFixture(t, { failNew = false, incompatible = false, changedIdentity = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-startup-owned-')), data = path.join(root, 'store'), releases = path.join(root, 'releases');
  // Register cleanup immediately, but run the integrity checks before removal.
  const verify = [];
  t.after(async () => { try { for (const check of verify) await check(); } finally { await cleanupFixture(t, root); } });
  await put(path.join(data, 'state.json'), { revision: incompatible ? 10 : 9, completedTasks: ['rs3:quest:1'] });
  const descriptors = [], configs = [];
  for (const [name, digit] of [['old', '1'], ['new', '2']]) {
    const core = path.join(releases, name), packs = path.join(core, 'packs');
    const id = changedIdentity && name === 'new' ? 'rs3:quest:2' : 'rs3:quest:1';
    await put(path.join(core, 'app/tasks/identity.mjs'), `export const authoredIdentityRegistry=()=>({entries:{${JSON.stringify(id)}:{}},aliases:{legacy:'rs3:quest:1'}});export const resolveIdentity=id=>({status:'resolved',id});`);
    await put(path.join(core, 'app/dataset-bootstrap.mjs'), 'export const loadDatasetInputs=async()=>({definitionBytes:Buffer.from(JSON.stringify({challenges:{}}))});');
    await put(path.join(core, 'app/dataset-pipeline.mjs'), 'export const prepareTaskDefinitions=x=>x;');
    await put(path.join(core, 'app/server.mjs'), `
import http from 'node:http';
import {readFile,appendFile} from 'node:fs/promises';
export async function createServer({dataDir,port}) {
  // A fixed preflight port is an ownership bug: readiness must bind port 0.
  if(port!==0) throw Object.assign(Error('unowned preflight port'),{code:'UNOWNED_PORT'});
  const saved=JSON.parse(await readFile(dataDir+'/state.json'));
  if(saved.revision!==9) throw Object.assign(Error('incompatible latest save revision '+saved.revision),{code:'INCOMPATIBLE_SAVE'});
  if(${failNew && name === 'new'}) throw Object.assign(Error('failed new startup'),{code:'FAILED_NEW_START'});
  if(!process.env.RS3_PACK_SELECTION.includes(${JSON.stringify(name)})) throw Error('wrong pack selection');
  const trace=${JSON.stringify(path.join(root, 'startups.jsonl'))};
  await appendFile(trace,JSON.stringify({phase:'spawned',pid:process.pid,pack:${JSON.stringify(name)},revision:saved.revision})+'\\n');
  const state={...saved,members:[{id:'one',completedTasks:saved.completedTasks,taskStatus:{}}],tasks:[{id:'rs3:quest:1'}]};
  const server=http.createServer(async(q,r)=>{
    await appendFile(trace,JSON.stringify({phase:'probe',pid:process.pid})+'\\n');
    r.setHeader('Content-Type','application/json');r.end(JSON.stringify({tasks:state.tasks}));
  });
  return {dataset:{},store:{getState:()=>state,backup:async()=>({state})},
    listen:async()=>{await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok)});await appendFile(trace,JSON.stringify({phase:'ready',pid:process.pid})+'\\n');},
    get inviteUrl(){return 'http://127.0.0.1:'+server.address().port+'/join/synthetic';},
    close:async()=>{await new Promise((ok,no)=>server.close(e=>e?no(e):ok()));await appendFile(trace,JSON.stringify({phase:'closed',pid:process.pid})+'\\n');}}
}`);
    const descriptor = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: digit.repeat(64) };
    const bytes = bindingBytes(descriptor);
    descriptors.push({ ...descriptor, bindingSha256: hash(bytes) });
    await put(path.join(packs, 'pack.json'), { requires: descriptor, datasetDigest: descriptor.digest, ruleContractHash: 'a'.repeat(64) });
    await put(path.join(core, 'profile.json'), { datasetId: descriptor.datasetId, datasetDigest: descriptor.digest, ruleContractHash: 'a'.repeat(64) });
    await put(path.join(packs, 'selection.json'), {});
    await put(path.join(core, 'addon.json'), {});
    const config = path.join(core, 'config.json'); configs.push(config);
    await put(config, { coreRoot: core, dataDir: data, nodePath: process.execPath, packsDir: packs,
      selection: await pin(path.join(packs, 'selection.json')), profile: await pin(path.join(core, 'profile.json')),
      addons: await pin(path.join(core, 'addon.json')), packs: { data: await pin(path.join(packs, 'pack.json')) } });
  }
  const plan = { schemaVersion: 1, old: descriptors[0], new: descriptors[1], oldConfig: await pin(configs[0]), newConfig: await pin(configs[1]),
    oldBindingBase64: bindingBytes(descriptors[0]).toString('base64'), newBindingBase64: bindingBytes(descriptors[1]).toString('base64') };
  await put(data + '.dataset.json', bindingBytes(descriptors[failNew ? 1 : 0]));
  const immutable = await hashTree(releases), before = await readFile(path.join(data, 'state.json'));
  verify.push(async () => {
    assert.deepEqual(await hashTree(releases), immutable, 'release/pack inputs were modified');
    assert.deepEqual(await readFile(path.join(data, 'state.json')), before, 'source latest save was modified');
  });
  return { root, data, configs, descriptors, plan };
}
