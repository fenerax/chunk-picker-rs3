// Byte seals are integrity records, not release authority. Windows activation
// locks and rehashes these exact files before trusting prior validation.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { digestValue, sanitizeExecutionEnvironment } from './release-identity.mjs';

export const frozenSchema = 'rs3-frozen-release-v1';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const activationPlatformDigest = () => digestValue({node:process.version,platform:process.platform,arch:process.arch,os:os.release(),environment:sanitizeExecutionEnvironment()});
export async function frozenHash(file,{allowHardlinks=false}={}) {
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || !allowHardlinks&&st.nlink !== 1) throw Error('Frozen file is not an independent regular file.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  const after = await lstat(file);
  if (after.ino !== st.ino || after.dev !== st.dev || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs || after.nlink !== st.nlink) throw Error('Frozen file changed while hashing.');
  return hash.digest('hex');
}
async function ordinary(file, directory = false) {
  if (!path.isAbsolute(file)) throw Error('Frozen path must be absolute.');
  for (let current = path.resolve(file);;) {
    const st = await lstat(current);
    if (st.isSymbolicLink()) throw Error('Frozen path has a linked ancestor.');
    if (current === path.resolve(file) && (directory ? !st.isDirectory() : !st.isFile())) throw Error('Frozen path kind changed.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}

/** Capture actual bytes only after the caller validates candidate and gates.
 * Trees contain no writable aliases. Mutable save/journal/current-pointer and
 * acceptance/telemetry outputs must never be passed as immutable inputs. */
export async function writeFrozenSeal({filename,kit,release,identityDigest,trees=[],files=[],executables=[],expectedFiles=[],expectedDirectories=[],bindings,previousConfig,rollback,forbiddenPaths=[],expiresAt,prepared=false,now=Date.now()}) {
  if (!hex(identityDigest) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) throw Error('Frozen seal lifetime refused.');
  const inventory = new Map(), directories = new Map();
  const executablePaths=new Set(executables.map(file=>path.resolve(file)));
  const addFile = async file => { await ordinary(file); inventory.set(path.resolve(file), {path:path.resolve(file),sha256:await frozenHash(file,{allowHardlinks:executablePaths.has(path.resolve(file))})}); };
  async function walk(root) {
    await ordinary(root,true);
    const entries=(await readdir(root)).sort(order);
    directories.set(path.resolve(root),{path:path.resolve(root),entries});
    for (const entry of entries) {
      const file=path.join(root,entry), st=await lstat(file);
      if (st.isDirectory() && !st.isSymbolicLink()) await walk(file); else await addFile(file);
    }
    if (digestValue(entries)!==digestValue((await readdir(root)).sort(order))) throw Error('Frozen tree changed during capture.');
  }
  for (const root of [...new Set(trees)]) await walk(root);
  for (const file of [...new Set(files)]) await addFile(file);
  for(const expected of expectedFiles)if(inventory.get(path.resolve(expected.path))?.sha256!==expected.sha256)throw Error('Checked input changed before the frozen seal.');
  for(const expected of expectedDirectories)if(digestValue(directories.get(path.resolve(expected.path))?.entries??null)!==digestValue(expected.entries))throw Error('Checked inventory changed before the frozen seal.');
  const seal={schema:frozenSchema,prepared,kit:path.resolve(kit),release:path.resolve(release),identityDigest,createdAt:new Date(now).toISOString(),expiresAt,platformDigest:activationPlatformDigest(),bindings,previousConfig,rollback,forbiddenPaths,files:[...inventory.values()].sort((a,b)=>order(a.path,b.path)),directories:[...directories.values()].sort((a,b)=>order(a.path,b.path))};
  // Omit absent optional fields so the record has a stable JSON representation.
  await writeFile(filename,JSON.stringify(seal,null,2)+'\n',{mode:0o600});
  const sha256=await frozenHash(filename), pin={schema:'rs3-frozen-seal-pin-v1',sha256,identityDigest};
  await writeFile(filename+'.pin.json',JSON.stringify({...pin,checksum:digestValue(pin)})+'\n',{mode:0o600});
  return {filename,sha256,seal};
}

/** Cheap admission only. The managed helper hashes and holds the full inventory;
 * this function alone never authorizes Stop, swap or Start. */
export const freezeFirstMessage='No frozen bundle for this candidate: run freeze first. Go-live order: release --gates-only, then freeze --kit KIT --release RELEASE --current POINTER, then release (or promote).';
export async function readFrozenSeal({filename,kit,release,current,identityDigest,now=Date.now(),verifyBytes=false}) {
  // rel8 r25 reached activation without freeze and refused with a bare ENOENT.
  try{await ordinary(filename);await lstat(filename+'.pin.json');}
  catch(error){if(error.code!=='ENOENT')throw error;throw Object.assign(Error(freezeFirstMessage),{code:'FROZEN_BUNDLE_MISSING'});}
  const sha256=await frozenHash(filename), {checksum,...pin}=await json(filename+'.pin.json');
  if(pin.schema!=='rs3-frozen-seal-pin-v1'||pin.sha256!==sha256||pin.identityDigest!==identityDigest||checksum!==digestValue(pin))throw Error('Frozen seal pin changed.');
  const seal=await json(filename);
  if(seal.schema!==frozenSchema || seal.prepared!==false || seal.kit!==path.resolve(kit) || seal.release!==path.resolve(release) || seal.identityDigest!==identityDigest || seal.platformDigest!==activationPlatformDigest() || !Number.isFinite(Date.parse(seal.createdAt)) || !Number.isFinite(Date.parse(seal.expiresAt)) || Date.parse(seal.createdAt)>now || Date.parse(seal.expiresAt)<=now || !seal.files?.length || !seal.directories?.length || !seal.rollback?.release) throw Error('Frozen bundle missing, stale or mismatched. Freeze after checks again.');
  for(const file of seal.forbiddenPaths??[]) {try {await lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}throw Error('A newer gate round blocks the frozen bundle.');}
  if(!current || await frozenHash(current)!==seal.bindings?.currentPointerSha256) throw Error('Running release pointer advanced. Prepare again.');
  for(const row of seal.files) if(!path.isAbsolute(row.path)||!hex(row.sha256))throw Error('Frozen file inventory refused.');
  if(verifyBytes) {
    for(const row of seal.files) if(await frozenHash(row.path,{allowHardlinks:true})!==row.sha256)throw Error('Frozen bundle bytes changed.');
    for(const row of seal.directories) {await ordinary(row.path,true);if(digestValue((await readdir(row.path)).sort(order))!==digestValue(row.entries))throw Error('Frozen bundle inventory changed.');}
  }
  if(await frozenHash(filename)!==sha256)throw Error('Frozen seal changed during admission.');
  return {filename,sha256,seal};
}

export function phaseSummary(rows) {
  const measured=rows.filter(row=>Number.isFinite(row.seconds));
  const slowest=measured.reduce((a,b)=>!a||b.seconds>a.seconds?b:a,null);
  return {totalSeconds:measured.reduce((n,row)=>n+row.seconds,0),slowestPhase:slowest?.stage??null,slowestSeconds:slowest?.seconds??0};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]!=='platform'||process.argv.length!==4||process.argv[3]!==activationPlatformDigest())process.exitCode=1;
}
