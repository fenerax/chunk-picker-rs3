// Bounded lexical recognition, never evaluation. Literal text/comment contents
// are inert; template interpolation expressions are code and are traversed.
// Computed/subprocess edges are declared by the closure's entrypoints.
export function moduleTokens(source) {
  function scan(start, interpolation = false) {
    const out = [];
    let braces = 0;
    for (let i = start; i < source.length;) {
    const start = i, c = source[i];
    if (interpolation && c === '}' && braces === 0) return { tokens: out, end: i + 1 };
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unclosed tooling comment.'); i = end + 2; continue; }
    if (c === '`') {
      let escaped = false, closed = false; const children = []; i++;
      while (i < source.length) {
        if (source[i] === '\\') { escaped = true; i += 2; continue; }
        if (source[i] === '`') { i++; closed = true; break; }
        if (source.startsWith('${', i)) {
          const expression = scan(i + 2, true); children.push(...expression.tokens); i = expression.end; continue;
        }
        i++;
      }
      if (!closed) throw Error('Unclosed tooling template.');
      out.push({ value: source.slice(start + 1, i - 1), kind: 'template', escaped, start, end: i }, ...children); continue;
    }
    if (c === '"' || c === "'") {
      let value = '', escaped = false; i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') { escaped = true; value += source[i++]; }
        value += source[i++];
      }
      if (i === source.length) throw Error('Unclosed tooling string.');
      i++; out.push({ value, kind: 'string', escaped, start, end: i }); continue;
    }
    if (c === '/' && (!out.length || /^(?:\(|\[|\{|=|:|,|!|\?|;|return|throw|=>|&&|\|\|)$/.test(out.at(-1).value))) {
      let inClass = false; i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        if (source[i] === ']') inClass = false;
        if (source[i++] === '/' && !inClass) break;
      }
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      out.push({ value: '<regexp>', kind: 'regexp', start, end: i }); continue;
    }
    const match = /^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?|^(?:\?\.|=>|===|!==|&&|\|\||\?\?|\.\.\.)/.exec(source.slice(i));
    const value = match?.[0] ?? c; i += value.length;
    out.push({ value, kind: /^[A-Za-z_$]/.test(value) ? 'identifier' : 'punctuation', start, end: i });
    if (interpolation && value === '{') braces++;
    else if (interpolation && value === '}') braces--;
    }
    if (interpolation) throw Error('Unclosed tooling template interpolation.');
    return { tokens: out, end: source.length };
  }
  return scan(0).tokens;
}

export function literalModuleReferences(source) {
  const tokens = moduleTokens(source), result = [], computed = [];
  const literal = token => (token?.kind === 'string' || token?.kind === 'template' && !token.value.includes('${')) && !token.escaped;
  const add = token => {
    if (token?.escaped) throw Error('Escaped tooling module specifier needs an explicit dependency declaration.');
    if (token?.kind === 'template' && !literal(token)) throw Error('Computed template tooling import needs an explicit dependency declaration.');
    if (literal(token)) result.push(token.value);
  };
  const unsupportedLoaders = new Set(['require', 'createRequire', 'getBuiltinModule']);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // CommonJS factories and builtin-module namespace aliases can load arbitrary
    // paths without import edges. They need an explicit supported graph model.
    const computedMember = token.kind === 'string' && tokens[i - 1]?.value === '[' && tokens[i + 1]?.value === ']'
      && (tokens[i - 2]?.kind === 'identifier' || [')', ']'].includes(tokens[i - 2]?.value));
    if (token.kind === 'punctuation' && token.value === '\\' || computedMember && token.escaped) throw Error('Unsupported escaped tooling identifier or property.');
    if (token.kind === 'identifier' && ['process', 'globalThis', 'module'].includes(token.value) && tokens[i + 1]?.value === '[') throw Error('Unsupported computed tooling loader namespace.');
    if ((token.kind === 'identifier' || computedMember) && unsupportedLoaders.has(token.value)) throw Error('Unsupported tooling loader: ' + token.value);
    if (token.kind !== 'identifier') continue;
    if (token.value === 'import') {
      if (tokens[i + 1]?.value === '(' && ['module', 'node:module'].includes(tokens[i + 2]?.value)) throw Error('Unsupported dynamic builtin-module loader.');
      if (tokens[i + 1]?.kind === 'string') add(tokens[i + 1]);
      else if (tokens[i + 1]?.value === '(' && ['string', 'template'].includes(tokens[i + 2]?.kind) && tokens[i + 3]?.value === ')') add(tokens[i + 2]);
      else if (tokens[i + 1]?.value === '(') {
        let depth = 1, end = i + 2;
        for (; end < tokens.length; end++) {
          if (tokens[end].kind !== 'punctuation') continue;
          if (tokens[end].value === '(') depth++;
          if (tokens[end].value === ')' && --depth === 0) break;
        }
        if (end === tokens.length) throw Error('Unbalanced tooling import.');
        computed.push(source.slice(tokens[i + 2].start, tokens[end].start).replace(/\s+/g, ''));
      }
    }
    if (token.value === 'from' && tokens[i + 1]?.kind === 'string') {
      if (['module', 'node:module'].includes(tokens[i + 1].value)) {
        let start = i - 1;
        while (start >= 0 && !['import', 'export', ';'].includes(tokens[start].value)) start--;
        const clause = tokens.slice(start + 1, i);
        if (clause[0]?.value !== '{' || clause.some(part => ['createRequire', 'Module', 'default', '*'].includes(part.value))) throw Error('Unsupported builtin-module loader alias.');
      }
      add(tokens[i + 1]);
    }
  }
  return { references: [...new Set(result)], computed, strings: tokens.filter(literal).map(token => token.value) };
}
