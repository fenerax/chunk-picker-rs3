import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Collect sorted unique GitHub issue numbers referenced by roadmap items. */
export function linkedIssueNumbers(roadmap) {
  const numbers = new Set();
  for (const theme of roadmap?.themes ?? []) {
    for (const item of theme?.items ?? []) {
      for (const issue of item?.issues ?? []) {
        if (Number.isInteger(issue) && issue > 0) numbers.add(issue);
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

function isoDate(value, fallback) {
  const candidate = typeof value === 'string' ? value.slice(0, 10) : '';
  return DATE_RE.test(candidate) ? candidate : fallback;
}

/**
 * Synchronize roadmap item statuses against linked GitHub issue states.
 * - All linked issues closed -> status becomes `done` with latest closed date.
 * - Any linked issue open while item is `done` -> status reopens to `working` and `done` clears.
 * - Unchanged items and items without complete issue data stay untouched.
 */
export function syncRoadmap(roadmap, { issuesByNumber = new Map(), today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!DATE_RE.test(today)) throw new TypeError(`Invalid today date: ${today}`);
  const lookup = issuesByNumber instanceof Map
    ? issuesByNumber
    : new Map(Object.entries(issuesByNumber).map(([key, value]) => [Number(key), value]));
  const next = structuredClone(roadmap);
  const changes = [];

  for (const theme of next.themes ?? []) {
    for (const item of theme.items ?? []) {
      if (!Array.isArray(item.issues) || !item.issues.length) continue;
      const linked = item.issues.map(number => lookup.get(number)).filter(Boolean);
      if (linked.length !== item.issues.length) continue;

      const states = linked.map(issue => String(issue.state ?? '').toLowerCase());
      const allClosed = states.every(state => state === 'closed');
      const anyOpen = states.some(state => state === 'open');

      if (allClosed && item.status !== 'done') {
        const closedDates = linked.map(issue => isoDate(issue.closedAt ?? issue.closed_at, today)).sort();
        const doneDate = closedDates.at(-1) ?? today;
        const previous = item.status;
        item.status = 'done';
        item.done = doneDate;
        changes.push({ id: item.id, from: previous, to: 'done', done: doneDate });
      } else if (anyOpen && item.status === 'done') {
        item.status = 'working';
        delete item.done;
        changes.push({ id: item.id, from: 'done', to: 'working' });
      }
    }
  }

  if (changes.length && (!DATE_RE.test(next.updated) || today > next.updated)) {
    next.updated = today;
  }

  return { roadmap: next, changed: changes.length > 0, changes };
}

function parseArgs(argv) {
  const options = {
    roadmapPath: resolve(fileURLToPath(new URL('../app/data/roadmap.json', import.meta.url))),
    issuesJsonPath: null,
    today: new Date().toISOString().slice(0, 10),
    write: false,
    check: false,
    listIssues: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--roadmap') options.roadmapPath = resolve(argv[++i]);
    else if (arg === '--issues-json') options.issuesJsonPath = resolve(argv[++i]);
    else if (arg === '--today') options.today = argv[++i];
    else if (arg === '--write') options.write = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--list-issues') options.listIssues = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.roadmapPath, 'utf8');
  const roadmap = JSON.parse(raw);

  if (options.listIssues) {
    console.log(JSON.stringify(linkedIssueNumbers(roadmap)));
    return;
  }

  if (!options.issuesJsonPath) throw new Error('Pass --issues-json <path> or --list-issues.');
  const loaded = JSON.parse(await readFile(options.issuesJsonPath, 'utf8'));
  const issuesByNumber = new Map();
  if (Array.isArray(loaded)) {
    for (const issue of loaded) {
      if (Number.isInteger(issue?.number)) issuesByNumber.set(issue.number, issue);
    }
  } else if (loaded && typeof loaded === 'object') {
    for (const [key, value] of Object.entries(loaded)) {
      issuesByNumber.set(Number(key), value);
    }
  }

  const result = syncRoadmap(roadmap, { issuesByNumber, today: options.today });
  const serialized = `${JSON.stringify(result.roadmap, null, 2)}\n`;
  if (options.write && result.changed) {
    await writeFile(options.roadmapPath, serialized, 'utf8');
  }
  console.log(JSON.stringify({ changed: result.changed, changes: result.changes, updated: result.roadmap.updated }));
  if (options.check && result.changed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message || error); process.exit(1); });
}
