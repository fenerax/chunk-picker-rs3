// Private operator tooling. This file and the generated bundle never enter public history.
import path from 'node:path';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safeArtFile } from '../app/packs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gallery = ['gallery.html', 'gallery.mjs', 'gallery.css', 'gallery-catalogue.mjs', 'gallery-preview.mjs',
  'gallery-capture.mjs', 'gallery-fixtures.mjs', 'gallery-fixture-data.json', 'gallery-safety.mjs', 'gallery-usage.mjs', 'gallery-usage-fixture.mjs'];
const bindings = new Map([
  ['../dataset-runtime.mjs', 'core.datasetRuntime'], ['./dataset-runtime.mjs', 'core.datasetRuntime'],
  ['../tasks/migration.mjs', 'core.migration'], ['../tasks/collection.mjs', 'core.collection'],
  ['../data/settings.mjs', 'core.settings'], ['../tasks/identity.mjs', 'core.identity'],
  ['./original-local-changes.mjs', 'localChanges'], ['./original-tasks.mjs', 'taskReview'],
]);

/** Small explicit linker for these four reviewed modules, never a general executable pack loader. */
export function linkPrivateModule(source, name) {
  const exports = [...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(match => match[1]);
  const builtins = [];
  source = source.replace(/^import (.+?) from ['"]([^'"]+)['"];\r?\n/gm, (line, names, specifier) => {
    if (specifier.startsWith('node:')) { builtins.push(line.trim()); return ''; }
    const binding = bindings.get(specifier);
    if (!binding || !/^\{[\w\s,]+\}$/.test(names)) throw new Error('Private module import needs review.');
    return `const ${names} = ${binding};\n`;
  });
  source = source.replace("import('../capture-maps.mjs')", 'Promise.resolve(captureMaps)');
  if (/\bimport\s*\(/.test(source)) throw new Error('Unreviewed dynamic private import.');
  // The generated entry has a data URL, and must not expose a command-line capture entrypoint.
  if (name === 'captureMaps') {
    const marker = '\nif (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {';
    const offset = source.indexOf(marker);
    if (offset < 0) throw new Error('Capture CLI boundary changed.');
    source = source.slice(0, offset);
  }
  if (/^import /m.test(source)) throw new Error('Unlinked private import.');
  return { builtins, body: `const ${name} = (() => {\n${source.replace(/^export /gm, '')}\nreturn { ${exports.join(', ')} };\n})();\n` };
}

export async function buildPrivateAddon({ sourceRoot = root, output } = {}) {
  if (!output || !path.isAbsolute(output)) throw new TypeError('Absolute absent add-on folder required.');
  output = path.resolve(output); sourceRoot = path.resolve(sourceRoot);
  const relative = path.relative(sourceRoot, output);
  if (relative === '' || relative.split(path.sep)[0] === 'app' || relative.split(path.sep)[0] === 'resources') throw new TypeError('Unsafe add-on output.');
  await safeArtFile(path.dirname(output));
  try { await lstat(output); throw new Error('Add-on output exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const modules = [];
  for (const [filename, name] of [['app/integrations/original-local-changes.mjs', 'localChanges'],
    ['app/integrations/original-tasks.mjs', 'taskReview'], ['app/capture-maps.mjs', 'captureMaps'],
    ['app/integrations/original-sync.mjs', 'sync']]) {
    modules.push(linkPrivateModule(await readFile(await safeArtFile(sourceRoot, filename), 'utf8'), name));
  }
  const bundle = [...new Set(modules.flatMap(module => module.builtins))].join('\n')
    + '\nexport function createIntegration(core) {\n' + modules.map(module => module.body).join('\n') + '\nreturn sync;\n}\n';
  const payloads = new Map([['server/original-sync.mjs', Buffer.from(bundle)]]);
  for (const filename of ['app/web/original-sync.mjs', ...gallery.map(name => `app/web/${name}`), 'app/data/changelog.json', 'app/data/roadmap.json']) {
    payloads.set(filename, await readFile(await safeArtFile(sourceRoot, filename)));
  }
  let bankingInteriors = false;
  try {
    payloads.set('app/data/banking-interiors.json', await readFile(await safeArtFile(sourceRoot, 'app/data/banking-interiors.json')));
    bankingInteriors = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(output);
  for (const [filename, bytes] of payloads) {
    await mkdir(path.dirname(path.join(output, filename)), { recursive: true });
    await writeFile(path.join(output, filename), bytes, { flag: 'wx', mode: 0o600 });
  }
  const manifest = { schemaVersion: 1, files: [...payloads].map(([filename, bytes]) => ({ path: filename, sha256: hash(bytes) })),
    features: { originalSync: { server: 'server/original-sync.mjs', browser: 'app/web/original-sync.mjs' }, gallery: true, projectUpdates: true, ...(bankingInteriors ? { bankingInteriors: true } : {}) } };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(output, 'addon.json'), bytes, { flag: 'wx', mode: 0o600 });
  return { path: path.join(output, 'addon.json'), sha256: hash(bytes), files: payloads.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = { '--source-root': 'sourceRoot', '--output': 'output' }[process.argv[index]];
      if (!name || !process.argv[index + 1] || Object.hasOwn(options, name)) throw new Error('Invalid arguments.');
      options[name] = process.argv[index + 1];
    }
    const result = await buildPrivateAddon(options);
    console.log(JSON.stringify({ sha256: result.sha256, files: result.files }));
  } catch { console.error('Private add-on build failed.'); process.exitCode = 1; }
}
