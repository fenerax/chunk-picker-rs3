// Module scanner for per-file test evidence. It tokenizes JavaScript (strings,
// templates, regular expressions, comments) and reports static edges and the
// capabilities a module can use to reach inputs outside its static closure.
// It models honest code: anything it cannot lex, or a capability it cannot bound,
// is reported, and the caller keeps that test file always-run.
const identStart = /[A-Za-z_$\u0080-￿]/, identPart = /[A-Za-z0-9_$\u0080-￿]/;
// After these tokens a slash starts a regular expression, not a division.
const regexAfterWord = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const punctuators = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

/** Tokens: {type:'word'|'punct'|'string'|'template'|'regex'|'number', value}. Throws on unbalanced input. */
export function tokenize(source) {
  const tokens = [], braces = [];
  let i = 0;
  const push = (type, value) => tokens.push({ type, value });
  const regexAllowed = () => {
    const last = tokens.at(-1);
    if (!last) return true;
    if (last.type === 'word') return regexAfterWord.has(last.value);
    if (last.type === 'punct') return ![')', ']', '}', '++', '--'].includes(last.value);
    return false;
  };
  const readString = quote => {
    let value = '';
    for (i++; ; i++) {
      if (i >= source.length || source[i] === '\n' && quote !== '`') throw Error('Unterminated string.');
      const ch = source[i];
      if (ch === quote) { i++; return value; }
      if (ch === '\\') {
        const next = source[++i];
        if (next === undefined) throw Error('Unterminated string.');
        // Escapes stay marked so callers never trust an escaped specifier.
        value += '\\' + next; continue;
      }
      value += ch;
    }
  };
  // Template text up to the closing backtick or the next ${. Returns the delimiter.
  const readTemplatePart = () => {
    let value = '';
    for (; ; i++) {
      if (i >= source.length) throw Error('Unterminated template.');
      const ch = source[i];
      if (ch === '`') { i++; return { value, end: '`' }; }
      if (ch === '\\') { value += ch + (source[++i] ?? ''); continue; }
      if (ch === '$' && source[i + 1] === '{') { i += 2; return { value, end: '${' }; }
      value += ch;
    }
  };
  const template = () => {
    const part = readTemplatePart();
    push('template', part.value);
    if (part.end === '${') { push('punct', '${'); braces.push('template'); }
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v' || ch === '﻿' || ch === ' ' || ch === ' ' || ch === ' ') { i++; continue; }
    if (ch === '#' && i === 0 && source[1] === '!') { const n = source.indexOf('\n'); i = n < 0 ? source.length : n; continue; }
    if (ch === '/' && source[i + 1] === '/') { const n = source.indexOf('\n', i); i = n < 0 ? source.length : n; continue; }
    if (ch === '/' && source[i + 1] === '*') { const n = source.indexOf('*/', i + 2); if (n < 0) throw Error('Unterminated comment.'); i = n + 2; continue; }
    if (ch === '"' || ch === "'") { push('string', readString(ch)); continue; }
    if (ch === '`') { i++; template(); continue; }
    if (ch === '/' && regexAllowed()) {
      let value = '/', inClass = false;
      for (i++; ; i++) {
        const c = source[i];
        if (c === undefined || c === '\n') throw Error('Unterminated regular expression.');
        value += c;
        if (c === '\\') { value += source[++i] ?? ''; continue; }
        if (c === '[') inClass = true; else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
      }
      while (i < source.length && identPart.test(source[i])) value += source[i++];
      push('regex', value); continue;
    }
    if (identStart.test(ch) || ch === '#' || ch === '\\') {
      if (ch === '\\') throw Error('Escaped identifier refused.');
      let value = ch; i++;
      while (i < source.length && identPart.test(source[i])) value += source[i++];
      if (source[i] === '\\') throw Error('Escaped identifier refused.');
      push('word', value); continue;
    }
    if (/[0-9]/.test(ch) || ch === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
      let value = '';
      while (i < source.length && /[0-9A-Za-z_.]/.test(source[i])) {
        // Exponent signs belong to the number.
        if (/[eE]/.test(source[i]) && /[+-]/.test(source[i + 1] ?? '') && !/^0[xX]/.test(value)) { value += source[i] + source[i + 1]; i += 2; continue; }
        value += source[i++];
      }
      push('number', value); continue;
    }
    if (ch === '{') { braces.push('block'); push('punct', ch); i++; continue; }
    if (ch === '}') {
      const kind = braces.pop();
      if (kind === undefined) throw Error('Unbalanced braces.');
      if (kind === 'template') { push('punct', '}'); i++; template(); continue; }
      push('punct', ch); i++; continue;
    }
    const long = punctuators.find(p => source.startsWith(p, i) && !(p === '?.' && /[0-9]/.test(source[i + 2] ?? '')));
    if (long) { push('punct', long); i += long.length; continue; }
    if ('()[];,<>+-*%&|^!~?:=@./'.includes(ch)) { push('punct', ch); i++; continue; }
    throw Error('Unknown character ' + JSON.stringify(ch) + '.');
  }
  if (braces.length) throw Error('Unbalanced braces.');
  return tokens;
}

// Builtins whose results depend only on arguments, the pinned Node executable,
// the pinned OS and the lane environment (isolated home and temp).
const boundBuiltins = new Set(['assert', 'assert/strict', 'path', 'path/posix', 'path/win32', 'url', 'util', 'util/types', 'events', 'buffer',
  'string_decoder', 'querystring', 'crypto', 'zlib', 'stream', 'stream/promises', 'stream/web', 'stream/consumers', 'timers', 'timers/promises',
  'perf_hooks', 'os', 'readline', 'readline/promises', 'v8', 'diagnostics_channel', 'async_hooks', 'process', 'console', 'test/reporters']);
// Builtins that reach inputs outside the static closure. The planner bounds
// each one with a reviewed model or keeps the test file always-run.
export const capabilityOfBuiltin = Object.freeze({ 'fs': 'files', 'fs/promises': 'files', 'sqlite': 'files', 'child_process': 'children', 'cluster': 'children',
  'worker_threads': 'workers', 'vm': 'evaluation', 'repl': 'evaluation', 'module': 'loader', 'wasi': 'loader', 'inspector': 'inspector', 'inspector/promises': 'inspector',
  'net': 'network', 'http': 'network', 'https': 'network', 'http2': 'network', 'tls': 'network', 'dgram': 'network', 'dns': 'network', 'dns/promises': 'network', 'test': 'test' });
const builtinName = specifier => specifier.startsWith('node:') ? specifier.slice(5) : specifier;
export const isBuiltin = specifier => { const name = builtinName(specifier); return boundBuiltins.has(name) || Object.hasOwn(capabilityOfBuiltin, name); };
const external = /^(?:https?|wss?):\/\/(?!(?:127\.0\.0\.1|localhost|\[::1\])(?:[:/]|$))/i;
const machinePath = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const internals = new Set(['binding', '_linkedBinding', 'dlopen', 'mainModule', 'getBuiltinModule', 'moduleLoadList', 'reallyExit']);

/** Canonical text for a computed import expression, matching reviewed model keys. */
export const expressionText = tokens => tokens.map(t => t.type === 'string' ? `'${t.value}'` : t.type === 'template' ? '`' + t.value + '`' : t.value).join('');

/**
 * Scan one module. Returns static imports, literal and computed dynamic imports,
 * capabilities with the builtins that grant them, and hazards nothing can bound.
 */
export function scanModule(source, { commonjs = false } = {}) {
  let tokens;
  try { tokens = tokenize(source); }
  catch (error) { return { lexed: false, imports: [], dynamicImports: [], computedImports: [], capabilities: [], builtins: [], hazards: ['unsupported JavaScript syntax (' + error.message + ')'], externalAddresses: [], machinePaths: [], urlLiterals: [] }; }
  const imports = [], dynamicImports = [], computedImports = [], capabilities = new Set(), builtins = new Set(), hazards = new Set();
  const externalAddresses = [], machinePaths = [], urlLiterals = [], clauses = new Map();
  const isWord = (t, value) => t?.type === 'word' && t.value === value;
  const isPunct = (t, value) => t?.type === 'punct' && t.value === value;
  const member = k => isPunct(tokens[k - 1], '.') || isPunct(tokens[k - 1], '?.');
  // Template substitutions open with '${' and close with '}', so they nest like '{'.
  const closing = (k, open, close) => {
    let depth = 0;
    for (let j = k; j < tokens.length; j++) {
      if (isPunct(tokens[j], open) || open === '{' && isPunct(tokens[j], '${')) depth++;
      else if (isPunct(tokens[j], close)) { depth--; if (!depth) return j; }
    }
    return -1;
  };
  // Static specifiers. Import attributes (with { type: 'json' }) still name a file edge.
  const addImport = (token, clause) => {
    if (token.value.includes('\\')) { hazards.add('escaped import specifier'); return; }
    imports.push(token.value);
    clauses.set(token.value, [...(clauses.get(token.value) ?? []), ...clause]);
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'string' || t.type === 'template') {
      if (external.test(t.value)) externalAddresses.push(t.value);
      if (machinePath.test(t.value)) machinePaths.push(t.value);
      continue;
    }
    if (t.type !== 'word' || member(k)) continue;
    if (t.value === 'import') {
      const next = tokens[k + 1];
      if (isPunct(next, '.')) continue; // import.meta
      if (isPunct(next, '(')) {
        const end = closing(k + 1, '(', ')');
        if (end < 0) { hazards.add('unbalanced dynamic import'); continue; }
        const inner = tokens.slice(k + 2, end);
        if (inner.length === 1 && inner[0].type === 'string' && !inner[0].value.includes('\\')) dynamicImports.push(inner[0].value);
        else computedImports.push(expressionText(inner));
        continue;
      }
      if (next?.type === 'string') { addImport(next, []); continue; }
      // import <default>, { names } | * as ns from 'x': the clause holds only words and , { } *.
      let j = k + 1;
      while (j < tokens.length && (tokens[j].type === 'word' && tokens[j].value !== 'from' || tokens[j].type === 'punct' && ['{', '}', ',', '*'].includes(tokens[j].value))) j++;
      if (isWord(tokens[j], 'from') && tokens[j + 1]?.type === 'string') addImport(tokens[j + 1], tokens.slice(k + 1, j).filter(x => x.type === 'word').map(x => x.value));
      else hazards.add('unrecognized import statement');
      continue;
    }
    if (t.value === 'export') {
      const next = tokens[k + 1];
      let after = -1;
      if (isPunct(next, '*')) after = isWord(tokens[k + 2], 'as') ? k + 4 : k + 2;
      else if (isPunct(next, '{')) { const end = closing(k + 1, '{', '}'); if (end < 0) { hazards.add('unbalanced export'); continue; } after = end + 1; }
      if (after >= 0 && isWord(tokens[after], 'from')) {
        if (tokens[after + 1]?.type === 'string') addImport(tokens[after + 1], tokens.slice(k + 1, after).filter(x => x.type === 'word').map(x => x.value)); else hazards.add('unrecognized export statement');
      } else if (isPunct(next, '*')) hazards.add('unrecognized export statement');
      continue;
    }
    // new URL('literal', import.meta.url) names a file next to this module.
    if (t.value === 'URL' && isWord(tokens[k - 1], 'new') && isPunct(tokens[k + 1], '(') && tokens[k + 2]?.type === 'string' && isPunct(tokens[k + 3], ',')
      && isWord(tokens[k + 4], 'import') && isPunct(tokens[k + 5], '.') && isWord(tokens[k + 6], 'meta') && isPunct(tokens[k + 7], '.') && isWord(tokens[k + 8], 'url') && isPunct(tokens[k + 9], ')')
      && !tokens[k + 2].value.includes('\\')) urlLiterals.push(tokens[k + 2].value);
    // An ES module has no require binding unless it builds one (node:module, a loader capability).
    if (t.value === 'require' && commonjs && isPunct(tokens[k + 1], '(')) capabilities.add('loader');
    else if (t.value === 'eval' || t.value === 'Function' && (isPunct(tokens[k + 1], '(') || isWord(tokens[k - 1], 'new'))) capabilities.add('evaluation');
    else if (t.value === 'getBuiltinModule') capabilities.add('loader');
    else if (t.value === 'process' && (isPunct(tokens[k + 1], '[') || (isPunct(tokens[k + 1], '.') || isPunct(tokens[k + 1], '?.')) && internals.has(tokens[k + 2]?.value))) capabilities.add('loader');
    else if (['fetch', 'WebSocket', 'EventSource'].includes(t.value)) capabilities.add('network');
  }
  const statics = [...new Set(imports)];
  for (const specifier of [...statics, ...dynamicImports]) {
    if (specifier.startsWith('.')) continue;
    const name = builtinName(specifier);
    if (boundBuiltins.has(name)) continue;
    if (Object.hasOwn(capabilityOfBuiltin, name)) { capabilities.add(capabilityOfBuiltin[name]); builtins.add(name); continue; }
    hazards.add('unmodeled package ' + specifier);
  }
  // node:test mock.module and run() load other modules by specifier at run time.
  if (builtins.has('test')) {
    capabilities.delete('test'); builtins.delete('test');
    for (let k = 0; k < tokens.length - 2; k++) if (isWord(tokens[k], 'mock') && (isPunct(tokens[k + 1], '.') || isPunct(tokens[k + 1], '?.')) && isWord(tokens[k + 2], 'module')) hazards.add('test module mock');
    // run() is reachable through a named import, or through a default/namespace import or dynamic import as .run.
    const clause = new Set([...(clauses.get('node:test') ?? []), ...(clauses.get('test') ?? [])]);
    const viaName = tokens.some((tok, k) => isWord(tok, 'run') && member(k) && clause.has(tokens[k - 2]?.value));
    const viaDynamic = dynamicImports.some(s => builtinName(s) === 'test') && tokens.some(tok => isWord(tok, 'run'));
    if (clause.has('run') || viaName || viaDynamic) hazards.add('nested test runner');
  }
  return { lexed: true, imports: statics, dynamicImports, computedImports, capabilities: [...capabilities].sort(), builtins: [...builtins].sort(), hazards: [...hazards].sort(), externalAddresses, machinePaths, urlLiterals: [...new Set(urlLiterals)] };
}
