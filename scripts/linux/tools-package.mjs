import { isMain } from '../release/vps/entrypoint.mjs';
// Dependency-free package builder. Computed release loaders are an explicit
// boundary; an unfamiliar loader refuses the build rather than widening it.
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { literalModuleReferences, moduleTokens } from '../private-companion/tooling-module-graph.mjs';
import { encode, inventory, noLinks, outside, sha } from './files.mjs';
import { currentToolsContract, toolsContract } from './tools-contracts.mjs';

export const toolsEntrypoints = currentToolsContract.entries;
// Keys are exact expressions recognized by the existing tooling lexer. No
// arbitrary computed import may be excused just because its owner is listed.
const releaseLoaders = {
  'scripts/linux/runtime.mjs': ["pathToFileURL(path.join(config.coreRoot,'app/server.mjs')).href"],
  'scripts/linux/probe.mjs': ["pathToFileURL(path.join(config.coreRoot,'app/core/state.mjs')).href"],
  'scripts/linux/prewarm.mjs': ['pathToFileURL(path.join(root,file))'],
  'scripts/private-companion/release-pack-check.mjs': ['tasks/identity', 'dataset-bootstrap', 'dataset-pipeline', 'server', 'plugin-items']
    .map(name => `pathToFileURL(path.join(core,'app/${name}.mjs'))`),
  'scripts/release/pc/quick-build.mjs': [
    ...['release-pack-check', 'release-identity'].flatMap(name => ['core', 'config.coreRoot'].map(root =>
      `pathToFileURL(path.join(${root},'scripts/private-companion/${name}.mjs')).href`)),
    ...['build-data-pack', 'build-dataset-profile', 'build-private-addon'].map(name => `pathToFileURL(path.join(core,'scripts/${name}.mjs')).href`),
  ],
};
const toolsLoaders = {
  'scripts/release/vps/bundle.mjs': { "pathToFileURL(path.join(toolsRoot,'scripts/linux/runtime.mjs')).href": ['scripts/linux/runtime.mjs'] },
};
const safe = name => typeof name === 'string' && /^[A-Za-z0-9_./-]+$/.test(name)
  && !name.startsWith('/') && !name.split('/').some(part => !part || part === '.' || part === '..');
const sort = rows => rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
function urlDependencies(owner, source) {
  const tokens = moduleTokens(source), result = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'identifier' || tokens[index].value !== 'new'
      || tokens[index + 1]?.value !== 'URL' || tokens[index + 2]?.value !== '(') continue;
    let depth = 1, end = index + 3;
    for (; end < tokens.length; end++) {
      if (tokens[end].kind !== 'punctuation') continue;
      if (tokens[end].value === '(') depth++;
      if (tokens[end].value === ')' && --depth === 0) break;
    }
    const args = tokens.slice(index + 3, end), values = args.map(token => token.value);
    if (!values.join('').includes('import.meta.url')) continue;
    if (args.length !== 7 || values.slice(1).join('') !== ',import.meta.url') throw Error('Unmodeled tools resource URL.');
    const first = args[0];
    if (first.kind === 'string' && !first.escaped) { if (/\.(?:mjs|json)$/.test(first.value)) result.push(first.value); }
    // This provider hashes its own two source files. Both are also import edges.
    else if (['app/open-starter.mjs', 'app/open-f2p.mjs'].includes(owner) && first.value === 'name') result.push('./' + path.posix.basename(owner), './open-starter-data.mjs');
    else throw Error('Unmodeled computed tools resource URL.');
  }
  return result;
}

export async function toolsClosure(root, entries = toolsEntrypoints) {
  root = path.resolve(root);
  const pending = [...entries], files = new Map(), boundaries = [];
  while (pending.length) {
    const name = pending.pop();
    if (!safe(name)) throw Error('Tools dependency escapes package.');
    if (files.has(name)) continue;
    const file = path.join(root, name); await noLinks(file);
    const bytes = await readFile(file);
    files.set(name, { path: name, bytes: bytes.length, sha256: sha(bytes) });
    if (!/\.mjs$/.test(name)) continue;
    const { references, computed } = literalModuleReferences(bytes.toString('utf8'));
    for (const expression of computed) {
      const targets = toolsLoaders[name]?.[expression];
      if (targets) pending.push(...targets);
      else if (releaseLoaders[name]?.includes(expression)) boundaries.push({ owner: name, expression, source: 'selected-release' });
      else throw Error('Unmodeled tools import in ' + name + ': ' + expression);
    }
    for (const ref of references) {
      if (ref === 'node:vm') throw Error('Unmodeled tools evaluator.');
      if (ref.startsWith('node:')) continue;
      if (!ref.startsWith('.') || /[\\:%?#]/.test(ref)) throw Error('Nonrelative tools dependency refused.');
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), ref)));
    }
    // URL-relative child entrypoints and file resources are runtime edges too.
    // Only URL construction with import.meta.url is followed, never text paths
    // passed to the selected release's dataset loader.
    for (const ref of urlDependencies(name, bytes.toString('utf8'))) pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), ref)));
  }
  return { entries: [...entries].sort(), files: sort([...files.values()]),
    boundaries: boundaries.sort((a, b) => (a.owner + a.expression).localeCompare(b.owner + b.expression, 'en')) };
}
export async function buildTools(root, output) {
  root = path.resolve(root); output = path.resolve(output);
  outside(root, output); outside(output, root);
  const closure = await toolsClosure(root, currentToolsContract.closureRoots);
  await mkdir(output, { mode: 0o755 });
  for (const row of closure.files) {
    const target = path.join(output, row.path); await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    const bytes = await readFile(path.join(root, row.path));
    if (sha(bytes) !== row.sha256) throw Error('Tools source changed during packaging.');
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  }
  const body = { format: 'picker-tools-v1', contractVersion: currentToolsContract.version, ...closure };
  const manifest = { ...body, toolsIdentity: sha(encode(body)) };
  await writeFile(path.join(output, 'tools-manifest.json'), encode(manifest), { flag: 'wx', mode: 0o644 });
  await verifyTools(output);
  return manifest;
}
export async function verifyTools(root) {
  try {
  await noLinks(root);
  const bytes = await readFile(path.join(root, 'tools-manifest.json'), 'utf8');
  const manifest = JSON.parse(bytes);
  const { toolsIdentity, ...body } = manifest;
  if (body.format !== 'picker-tools-v1' || toolsIdentity !== sha(encode(body))) throw Error('Tools manifest identity differs.');
  const contract = toolsContract(manifest);
  const canonical = { format: body.format, ...(Object.hasOwn(body, 'contractVersion') ? { contractVersion: contract.version } : {}),
    entries: contract.entries, files: body.files, boundaries: body.boundaries, toolsIdentity };
  if (bytes !== encode(canonical)) throw Error('Tools manifest is not canonical.');
  const actual = sort((await inventory(root)).filter(row => !row.directory && row.path !== 'tools-manifest.json'));
  if (encode(actual) !== encode(body.files)) throw Error('Tools manifest hashes differ.');
  const closure = await toolsClosure(root, contract.closureRoots);
  if (encode(closure) !== encode({ entries: body.entries, files: body.files, boundaries: body.boundaries })) throw Error('Tools import closure differs.');
  return manifest;
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) throw error;
    throw Object.assign(Error('Tools manifest hashes differ or package is invalid.'), { code: 'TOOLS_HASH' });
  }
}
if (isMain(import.meta.url)) {
  try {
    const [command, root, output, ...extra] = process.argv.slice(2);
    if (extra.length || !root || (command !== 'build' && command !== 'verify') || (command === 'build' && !output)) throw Error();
    const result = await (command === 'build' ? buildTools(root, output) : verifyTools(root));
    process.stdout.write(encode({ files: result.files.length, toolsIdentity: result.toolsIdentity }));
  } catch { process.stderr.write('Tools package refused.\n'); process.exitCode = 1; }
}
