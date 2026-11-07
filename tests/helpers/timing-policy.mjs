import { tokenize } from '../../scripts/private-companion/module-scan.mjs';

// Exemptions are owned, explicit and restricted to the rule they need. These
// files are being rebuilt in separate PRs; this sweep must not rewrite them.
export const timingAllowlist = Object.freeze({
  'tests/duo-focus-browser.test.mjs': { all: 'Browser focus timing is being rebuilt in its own PR.' },
  'tests/acknowledged-chrome.test.mjs': { all: 'Duo-focus browser helper contract belongs to the separate browser rebuild (#166); its outer guard is preserved with that excluded test.' },
  'tests/release-pack-upgrade-v2.test.mjs': { all: 'Release upgrade checks are being rebuilt in their own PR.' },
  'tests/release-pipeline-v2.test.mjs': { all: 'Release pipeline checks are being rebuilt in their own PR.' },
  'tests/warm-candidate.test.mjs': { timer: 'Every timer call is advanced by node:test mock timers; it proves production candidate cancellation.' },
  'tests/linux-offhost.test.mjs': { timer: 'Upload cancellation is driven by createManualClock, never wall time.' },
  'tests/map-terrain.test.mjs': { elapsed: 'Production callback budgets use an injected deterministic work clock, including explicit publication costs.' },
});

// Controlled-clock exemptions bind individual authored checks. Adding another
// real timer or elapsed assertion to one of these files still fails the policy.
const controlledChecks = {
  'tests/warm-candidate.test.mjs': [
    'return new Promise(resolve => setTimeout(() => resolve(query(...args)), 100000));',
  ],
  'tests/linux-offhost.test.mjs': [
    "deadlineSignal(ms) { clock.setTimeout(() => controller.abort(new Error('controlled upload deadline')), ms); return controller.signal; },",
  ],
  'tests/map-terrain.test.mjs': [
    'assert.ok(fast.callbacks.every(callback => callback.duration <= 4));',
    'assert.ok(run.callbacks.every(callback => callback.duration <= 4));',
    "assert.ok(run.callbacks.every(callback => callback.duration <= 4), 'Include publication in the whole-callback budget');",
    'assert.ok(callback.duration <= Math.max(4, slowest + callback.publish) + 4,',
  ],
};

const replacement = {
  elapsed: 'Prove behavior with a controlled clock or event acknowledgement, count work for a complexity guard, or move the speed budget to a non-blocking benchmark.',
  timeout: 'Remove the per-test or subprocess deadline and import tests/helpers/file-safety-stop.mjs for the file-level outer safety stop.',
  timer: 'Use a controlled clock or an event/exit acknowledgement; only tests/helpers/file-safety-stop.mjs may impose a real-time safety bound.',
};
const comparisons = new Set(['<', '>', '<=', '>=', '==', '===', '!=', '!==']);
const code = token => !['string', 'template', 'regex'].includes(token.type);
const text = tokens => tokens.filter(code).map(token => token.value).join(' ');

export function timingViolations(source, file, { allowlist = timingAllowlist } = {}) {
  if (file === 'tests/helpers/file-safety-stop.mjs') return [];
  const exemption = allowlist[file];
  if (exemption?.all) return [];
  if (file.endsWith('.ps1')) {
    const failures = [];
    for (const [index, line] of source.split('\n').entries()) {
      if (line.trimStart().startsWith('#')) continue;
      if (/\bStart-Sleep\b|::Sleep\(\s*\d|\.WaitForExit\(\s*\d|Elapsed(?:Milliseconds|Seconds|Ticks)?\s*-(?:lt|le|gt|ge)\s*\d/i.test(line))
        failures.push({ file, line: index + 1, kind: 'timer', message: `${file}:${index + 1}: timer timing check. ${replacement.timer}` });
    }
    return failures;
  }
  const tokens = tokenize(source, { locations: true }), failures = [];
  const pairs = new Map(), stack = [];
  for (let i = 0; i < tokens.length; i++) {
    if (['(', '[', '{', '${'].includes(tokens[i].value) && code(tokens[i])) stack.push(i);
    else if ([')', ']', '}'].includes(tokens[i].value) && code(tokens[i])) {
      const start = stack.pop(); if (start !== undefined) pairs.set(start, i);
    }
  }
  const report = (token, kind) => {
    const line = source.slice(0, token.start).split('\n').length;
    if (exemption?.[kind] && controlledChecks[file]?.includes(source.split('\n')[line - 1].trim())) return;
    if (!failures.some(row => row.line === line && row.kind === kind))
      failures.push({ file, line, kind, message: `${file}:${line}: ${kind} timing check. ${replacement[kind]}` });
  };
  const testNames = new Set(['test', 'it', 'describe']), assertionNames = new Set(['assert']);
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'string' && /^(?:node:)?assert(?:\/strict)?$/.test(tokens[i].value)) {
    const start = tokens.slice(0, i).findLastIndex(token => token.value === 'import');
    for (let j = start + 1; j < i; j++) if (tokens[j].type === 'word' && !['from', 'as'].includes(tokens[j].value)) assertionNames.add(tokens[j].value);
  }
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'string' && tokens[i].value === 'node:test') {
    const start = tokens.slice(0, i).findLastIndex(token => token.value === 'import');
    for (let j = start + 1; j < i; j++) if (tokens[j].type === 'word' && !['from', 'as'].includes(tokens[j].value)) testNames.add(tokens[j].value);
  }
  const optionObjects = new Set(), namedObjects = new Map();
  for (let i = 2; i < tokens.length; i++) if (tokens[i].value === '{' && tokens[i - 1].value === '=' && tokens[i - 2].type === 'word') namedObjects.set(tokens[i - 2].value, i);
  for (let i = 1; i < tokens.length; i++) if (tokens[i].value === '(' && pairs.has(i)
    && (testNames.has(tokens[i - 1].value) || ['only', 'skip', 'todo'].includes(tokens[i - 1].value) && testNames.has(tokens[i - 3]?.value))) {
    for (let at = i + 1, argument = 0, first = true; at < pairs.get(i); at++) {
      if (tokens[at].value === ',') { argument++; first = true; continue; }
      if (argument === 1 && first) {
        if (tokens[at].value === '{') optionObjects.add(at);
        else if (namedObjects.has(tokens[at].value)) optionObjects.add(namedObjects.get(tokens[at].value));
      }
      first = false;
      if (pairs.has(at)) at = pairs.get(at);
    }
  }
  const aliases = new Set(['setTimeout']);
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'string' && /^(?:node:)?timers(?:\/promises)?$/.test(tokens[i].value)) {
    const start = tokens.slice(0, i).findLastIndex(token => token.value === 'import');
    for (let j = start; j < i; j++) if (tokens[j]?.value === 'setTimeout') aliases.add(tokens[j + 1]?.value === 'as' ? tokens[j + 2].value : 'setTimeout');
  }
  for (let i = 2; i < tokens.length; i++) if (tokens[i - 1].value === '=' && aliases.has(tokens[i].value)
    && tokens[i - 2].type === 'word') aliases.add(tokens[i - 2].value);
  // Track measurements through intermediate variables, not just inline now().
  const measured = new Set(), derived = new Set(), clockFunctions = new Set();
  for (let i = 2; i < tokens.length; i++) if (tokens[i - 1].value === '=' && ['Date', 'performance'].includes(tokens[i].value)
    && tokens[i + 1]?.value === '.' && tokens[i + 2]?.value === 'now' && tokens[i + 3]?.value !== '(') clockFunctions.add(tokens[i - 2].value);
  const hasClock = list => /(?:performance|Date) \. now \(/.test(text(list)) || list.some((token, index) => code(token)
    && (measured.has(token.value) || clockFunctions.has(token.value) && list[index + 1]?.value === '(') && !['.', '?.'].includes(list[index - 1]?.value));
  const assignments = [];
  for (let i = 1; i < tokens.length; i++) if (tokens[i].value === '=' && tokens[i - 1].type === 'word') {
    let end = i + 1;
    for (; end < tokens.length && ![';', ','].includes(tokens[end].value); end++) {
      if (pairs.has(end)) end = pairs.get(end);
    }
    const rhs = tokens.slice(i + 1, end);
    // A function body or object containing a timestamp does not make its
    // return value a measured duration. Follow scalar arithmetic assignments.
    if (!rhs.some(token => code(token) && ['{', '=>'].includes(token.value))
      && !rhs.some((token, index) => token.value === '(' && rhs[index - 1]?.type === 'word' && rhs[index - 1].value !== 'now' && !clockFunctions.has(rhs[index - 1].value) && rhs[index - 3]?.value !== 'Math'))
      assignments.push({ name: tokens[i - 1].value, rhs });
  }
  let changed;
  do {
    changed = false;
    for (const { name, rhs } of assignments) if (!measured.has(name) && hasClock(rhs)) { measured.add(name); changed = true; }
  } while (changed);
  do {
    changed = false;
    for (const { name, rhs } of assignments) if (!derived.has(name) && hasClock(rhs)
      && rhs.some(token => code(token) && (['+', '-'].includes(token.value) || derived.has(token.value)))) { derived.add(name); changed = true; }
  } while (changed);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const inTestOptions = [...optionObjects].some(start => start < i && pairs.get(start) > i);
    if (token.value === 'timeout' && inTestOptions && [',', '}'].includes(tokens[i + 1]?.value)) report(token, 'timeout');
    if (token.value === 'timeout' && tokens[i + 1]?.value === ':') {
      const value = tokens[i + 2];
      // Product boolean fixtures are not runner options. Zero disables native
      // subprocess deadlines, and is not a real-time bound.
      if (inTestOptions
        || value?.type === 'number' && Number(value.value.replaceAll('_', '')) !== 0
        || value?.type === 'word' && !['true', 'false'].includes(value.value)) report(token, 'timeout');
    }
    if (!code(token)) continue;
    if (token.value === '(' && pairs.has(i)) {
      const before = tokens[i - 1], end = pairs.get(i);
      if (aliases.has(before?.value) && tokens[end + 1]?.value !== '{') report(before, 'timer');
      if (before?.value === 'timeout' && text(tokens.slice(i - 4, i)).includes('AbortSignal . timeout')) report(before, 'timer');
      if (assertionNames.has(before?.value) || tokens[i - 2]?.value === '.' && assertionNames.has(tokens[i - 3]?.value)) {
        const args = [];
        for (let at = i + 1; at < end; at++) {
          // Timestamps in product option objects are inputs. Arithmetic inside
          // Math.abs/every and other assertion expressions remains visible.
          if (tokens[at].value === '{') { at = pairs.get(at) ?? at; continue; }
          if (tokens[at].value === '(' && tokens[at - 1]?.type === 'word'
            && !['now', 'some', 'every'].includes(tokens[at - 1].value) && tokens[at - 3]?.value !== 'Math') {
            at = pairs.get(at) ?? at; continue;
          }
          if (code(tokens[at])) args.push(tokens[at]);
        }
        const operator = args.some(item => comparisons.has(item.value));
        const comparisonCall = ['equal', 'strictEqual', 'notEqual', 'notStrictEqual'].includes(before?.value)
          || assertionNames.has(before?.value) && before?.value !== 'assert';
        const returnedDurationBudget = args.some(item => ['<', '<='].includes(item.value))
          && args.some(item => item.type === 'word' && /^(?:elapsed(?:Ms)?|duration(?:Ms)?|wallMs|took|ms)$/.test(item.value));
        const measuredBound = hasClock(args) && args.some(item => item.type === 'number' || ['+', '-'].includes(item.value) || derived.has(item.value));
        if (measuredBound && (operator || comparisonCall) || returnedDurationBudget) report(before, 'elapsed');
      }
    }
  }
  return failures;
}
