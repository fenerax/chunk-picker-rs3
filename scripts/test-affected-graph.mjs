import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { moduleTokens } from './private-companion/tooling-module-graph.mjs';
import { checkedInputContract } from './test-affected-contracts.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const fsModule = name => /^(?:node:)?fs(?:\/promises)?$/.test(name);
const directories = new Set(['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync']);
const reads = new Set(['readFile', 'readFileSync', 'readlink', 'readlinkSync', 'realpath', 'realpathSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'existsSync', 'createReadStream', 'open', 'openSync', ...directories]);
const writes = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'utimes', 'utimesSync', 'truncate', 'truncateSync', 'createWriteStream']);
const descriptors = new Set(['close', 'closeSync', 'write', 'writeSync', 'fsync', 'fsyncSync', 'fdatasync', 'fdatasyncSync', 'constants']);

// A bounded lexical scanner, not a JavaScript evaluator. Each unresolved load
// marks this file uncertain without discarding its other, proven import edges.
export function fileReferences(source) {
  const references = [], reasons = [];
  let tokens;
  try { tokens = moduleTokens(source); } catch (error) { return { references, reasons: [error.message] }; }
  const declarations = new Set(), bindings = new Map();
  const constant = start => {
    let i = start, depth = 0;
    while (tokens[i]?.value === '(') { depth++; i++; }
    const token = tokens[i++];
    if (!token || token.escaped || !(token.kind === 'string' || token.kind === 'template' && !token.value.includes('${'))) throw Error('computed path');
    while (depth-- > 0) if (tokens[i++]?.value !== ')') throw Error('constant expression');
    if (![',', ')'].includes(tokens[i]?.value)) throw Error('path expression');
    return { specifier: token.value, end: i };
  };
  const attempt = (label, fn) => { try { fn(); } catch (error) { reasons.push(`${label}: ${error.message}`); } };
  const url = start => {
    const ref = constant(start + 3);
    if (/^[a-z][a-z\d+.-]*:/i.test(ref.specifier) && !ref.specifier.startsWith('file:')) return null;
    if (tokens[ref.end]?.value !== ',' || tokens.slice(ref.end + 1, ref.end + 6).map(t => t.value).join('') !== 'import.meta.url') throw Error('file URL base');
    return { ...ref, kind: 'url' };
  };
  // Remember fs bindings so alternate syntax cannot silently lose a read.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== 'import' || tokens[i + 1]?.value === '(' || tokens[i + 1]?.value === '.') continue;
    let end = i + 1;
    while (end < tokens.length && !['from', ';'].includes(tokens[end].value) && tokens[end].kind !== 'string') end++;
    const specifier = tokens[end].value === 'from' ? tokens[end + 1]?.value : tokens[end]?.value;
    if (!fsModule(specifier ?? '')) continue;
    const clause = tokens.slice(i + 1, end);
    if (clause[0]?.value === '{') {
      for (let j = i + 2; j < end - 1; j++) {
        if (tokens[j].kind !== 'identifier') continue;
        const name = tokens[j].value;
        let local = j;
        if (tokens[j + 1]?.value === 'as') { local = j + 2; j += 2; }
        declarations.add(local); bindings.set(tokens[local].value, name);
      }
    } else {
      const binding = clause[0]?.value === '*' ? i + 3 : i + 1;
      declarations.add(binding); bindings.set(tokens[binding]?.value, '*');
    }
  }
  const read = (name, start) => {
    if (tokens[start]?.value === 'new' && tokens[start + 1]?.value === 'URL') {
      const ref = url(start);
      if (!ref) throw Error('non-file URL read');
      references.push({ ...ref, directory: directories.has(name) || ref.directory });
    } else {
      const ref = constant(start);
      if (name.startsWith('glob')) {
        if (tokens[ref.end]?.value === ',') reasons.push('unmodeled glob options');
        const wildcard = ref.specifier.search(/[?*\[\]{}]/);
        if (wildcard >= 0) ref.specifier = path.posix.dirname(ref.specifier.slice(0, wildcard) + '_');
        references.push({ ...ref, kind: 'path', root: true });
      }
      references.push({ ...ref, kind: 'path', directory: directories.has(name), root: true });
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'identifier') continue;
    if (t.value === 'import' && tokens[i + 1]?.value === '(') attempt('import', () => {
      const ref = tokens[i + 2]?.value === 'new' && tokens[i + 3]?.value === 'URL' ? url(i + 2) : { ...constant(i + 2), kind: 'import' };
      if (!ref) throw Error('non-file import');
      references.push({ ...ref, module: true });
      if (fsModule(ref.specifier)) reasons.push('dynamic fs binding');
    });
    if (t.value === 'import' && tokens[i + 1]?.kind === 'string' || t.value === 'from' && tokens[i + 1]?.kind === 'string') {
      const token = tokens[i + 1];
      if (token.escaped) reasons.push('escaped import');
      else references.push({ specifier: token.value, kind: 'import', module: true });
      if (t.value === 'from' && fsModule(token.value)) {
        let start = i - 1;
        while (start >= 0 && !['import', 'export', ';'].includes(tokens[start].value)) start--;
        if (tokens[start]?.value === 'export') reasons.push('unmodeled fs reexport');
      }
    }
    if (['require', 'createRequire', 'getBuiltinModule'].includes(t.value) && tokens[i + 1]?.value === '(') reasons.push('unmodeled loader');
    if (t.value === 'datasetJSON' && tokens[i + 1]?.value === '(' && tokens[i - 1]?.value !== 'function') attempt('datasetJSON', () => references.push({ ...constant(i + 2), kind: 'path', root: true }));
    if (t.value === 'new' && tokens[i + 1]?.value === 'URL' && tokens[i + 2]?.value === '(') {
      // URL construction alone is not a file load. Retain resolvable literal
      // file URLs (also used for workers/CLI fixtures); actual fs/import calls
      // independently reject an unresolved URL argument. HTTP routing code's
      // new URL(request.url, origin) does not introduce a filesystem reference.
      const literal = tokens[i + 3];
      if (literal?.kind === 'string' || literal?.kind === 'template' && !literal.value.includes('${')) {
        attempt('URL', () => { const ref = url(i); if (ref) references.push(ref); });
      } else if (tokens.some(token => /^(?:node:)?(?:worker_threads|child_process)$/.test(token.value) || token.value === 'Worker')) reasons.push('unresolved worker/subprocess URL');
    }

    if (declarations.has(i) || ['.', '?.'].includes(tokens[i - 1]?.value)) continue;
    let name = bindings.get(t.value), call = i + 1;
    if (name === '*') {
      if (tokens[call]?.value === '.' && tokens[call + 1]?.value === 'promises') call += 2;
      if (tokens[call]?.value !== '.' || tokens[call + 1]?.kind !== 'identifier') { reasons.push('unmodeled fs namespace use'); continue; }
      name = tokens[call + 1].value; call += 2;
    } else if (!name && ['readFile', 'readFileSync', ...directories].includes(t.value) && tokens[i - 1]?.value !== '.') {
      // Keep standalone read-call recognition for synthetic graphs and wrappers.
      if (tokens[call]?.value !== '(' || tokens[i - 1]?.value === 'function') continue;
      name = t.value;
    }
    if (!name) continue;
    if (descriptors.has(name)) continue;
    if (tokens[call]?.value !== '(') { reasons.push(`unmodeled fs callee ${name}`); continue; }
    if (writes.has(name)) continue;
    if (!reads.has(name)) { reasons.push(`unmodeled fs operation ${name}`); continue; }
    attempt(name, () => read(name, call + 1));
  }
  return { references, reasons: [...new Set(reasons)] };
}

export function importGraph(sources) {
  const reverse = new Map(), uncertain = [], diagnostics = {};
  for (const [file, source] of sources) {
    const { references, reasons } = fileReferences(source);
    const contract = checkedInputContract(file, source);
    if (contract) {
      // Resolve only the audited computed read, never missing imports or any
      // other scanner failure. Explicit edges preserve the bounded scope.
      for (let i = reasons.length - 1; i >= 0; i--) if (reasons[i] === 'readFileSync: computed path') reasons.splice(i, 1);
      for (const specifier of contract) references.push({ specifier, kind: 'path', root: true });
    }
    for (const ref of references) {
      try {
        if (ref.module && isBuiltin(ref.specifier)) continue;
        if (ref.kind === 'import' && !/^(?:\.{1,2}\/|file:)/.test(ref.specifier)) throw Error('unresolved package');
        const filename = ref.kind === 'path' ? path.resolve(repository, ref.specifier)
          : fileURLToPath(new URL(ref.specifier, pathToFileURL(path.join(repository, file))));
        const target = path.relative(repository, filename).replaceAll('\\', '/');
        if (!target || target === '..' || target.startsWith('../') || path.isAbsolute(target)) {
          if (ref.module) throw Error('outside repository');
          // A resolved external file/URL is not an unresolved load. Directory
          // reads of an ancestor still cover the complete repository tree.
          if (ref.directory && (!target || repository.startsWith(filename + path.sep))) {
            if (!reverse.has('./')) reverse.set('./', new Set());
            reverse.get('./').add(file);
          }
          continue;
        }
        if (ref.module && !sources.has(target)) throw Error('missing module');
        const key = target.replace(/\/$/, '') + (ref.directory ? '/' : '');
        if (!reverse.has(key)) reverse.set(key, new Set());
        reverse.get(key).add(file);
      } catch (error) { reasons.push(`${ref.specifier}: ${error.message}`); }
    }
    if (reasons.length) { uncertain.push(file); diagnostics[file] = reasons; }
  }
  return { reverse, uncertain, diagnostics };
}
