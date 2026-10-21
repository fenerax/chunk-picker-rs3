// Capability hashes omit only these literal assertion registries. Dependency
// discovery and current-run contract/lane identities must still use raw bytes.
import { moduleTokens } from './tooling-module-graph.mjs';

const registries = new Map([
  ['checks/private-source/scripts/test-selection.mjs', { quickTests: 'set', fullOnlyTests: 'set' }],
  ['committed-core-tooling/scripts/test-selection.mjs', { quickTests: 'set', fullOnlyTests: 'set' }],
  ['tools/tooling-contract-catalog.mjs', { additionalToolingContractTests: 'freeze' }],
  ['checks/private-source/scripts/private-companion/tooling-contract-catalog.mjs', { additionalToolingContractTests: 'freeze' }],
]);
const testName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/;
const opening = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
const closing = new Set(opening.values());
const punct = (token, value) => token?.kind === 'punctuation' && token.value === value;
const word = (token, value) => token?.kind === 'identifier' && token.value === value;

function literalRegistry(tokens, start, wrapper) {
  let index = start;
  if (wrapper === 'set') {
    if (!word(tokens[index++], 'new') || !word(tokens[index++], 'Set')) return null;
  } else if (wrapper === 'freeze') {
    if (!word(tokens[index++], 'Object') || !punct(tokens[index++], '.') || !word(tokens[index++], 'freeze')) return null;
  } else return null;
  if (!punct(tokens[index++], '(') || !punct(tokens[index], '[')) return null;
  const open = tokens[index++], names = new Set();
  let expectingName = true;
  for (; index < tokens.length && !punct(tokens[index], ']'); index++) {
    const token = tokens[index];
    if (expectingName) {
      if (token.kind !== 'string' || token.escaped || !testName.test(token.value) || names.has(token.value)) return null;
      names.add(token.value); expectingName = false;
    } else {
      if (!punct(token, ',')) return null;
      expectingName = true;
    }
  }
  // Empty arrays and one trailing comma are valid. No call/member suffix,
  // comma declaration, additional argument, spread, or computed value qualifies.
  if (!punct(tokens[index], ']') || !punct(tokens[index + 1], ')')
      || tokens[index + 2] !== undefined && !punct(tokens[index + 2], ';')) return null;
  return { start: open.end, end: tokens[index].start };
}

/** Conservative token recognition, never source evaluation. A missing,
 * ambiguous, nonliteral, or unsupported registry leaves the whole module raw.
 * Every byte outside the recognized array interiors remains in the hash. */
export function executableToolingBytes(owner, bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const required = registries.get(owner);
  if (!required) return raw;
  const source = raw.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(raw)) return raw;
  let tokens;
  try { tokens = moduleTokens(source); } catch { return raw; }
  // The bounded lexer does not parse nested interpolation or every ambiguous
  // slash grammar. Uncertain surrounding syntax must never create an exemption.
  if (tokens.some(token => token.kind === 'template' && token.value.includes('${') || punct(token, '/'))) return raw;
  const stack = [], spans = new Map();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!stack.length && word(token, 'const') && tokens[index + 1]?.kind === 'identifier'
        && Object.hasOwn(required, tokens[index + 1].value)) {
      const name = tokens[index + 1].value;
      if (spans.has(name) || !punct(tokens[index + 2], '=')) return raw;
      const before = word(tokens[index - 1], 'export') ? tokens[index - 2] : tokens[index - 1];
      if (before !== undefined && !punct(before, ';') && !punct(before, '}')) return raw;
      const span = literalRegistry(tokens, index + 3, required[name]);
      if (!span) return raw;
      spans.set(name, span);
    }
    if (token.kind !== 'punctuation') continue;
    if (opening.has(token.value)) stack.push(opening.get(token.value));
    else if (closing.has(token.value) && stack.pop() !== token.value) return raw;
  }
  if (stack.length || spans.size !== Object.keys(required).length) return raw;
  const ranges = [...spans.entries()].sort((a, b) => b[1].start - a[1].start);
  let normalized = source;
  for (const [name, span] of ranges) normalized = normalized.slice(0, span.start)
    + `/* assertion registry: ${name} */` + normalized.slice(span.end);
  return Buffer.from(normalized, 'utf8');
}
