import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bundle from '../app/data/retained-wording-corrections.2026-10-12.v1.json' with { type: 'json' };
import { applyRetainedTaskCorrections } from '../app/data/retained-task-corrections.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { permanentTaskId } from '../app/tasks/identity.mjs';

const bytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url));
const raw = JSON.parse(bytes);
const label = '~|Daemonheim Achievements#Easy|~ Kitchen Aid';

test('wording provenance pins the reviewed Wiki revision and exact authored inputs', () => {
  assert.equal(bundle.provenance.referenceSha256, sha256RepositoryText(bytes));
  assert.equal(bundle.provenance.generatorSha256, sha256RepositoryText(readFileSync(new URL(`../${bundle.provenance.generator}`, import.meta.url))));
  assert.equal(bundle.corrections.length, 1);
  assert.deepEqual(bundle.wiki.map(pin => pin.title), ['Kitchen Aid']);
  assert.equal(bundle.wiki[0].url, `https://runescape.wiki/w/Special:PermanentLink/${bundle.wiki[0].revisionId}`);
  assert.equal(bundle.wiki[0].facts.f2p, true);
});

test('Kitchen Aid reads as the free-to-play teammate route and keeps everything else', () => {
  const before = JSON.stringify(raw);
  const after = applyRetainedTaskCorrections(raw, { strict: true });
  const original = raw.challenges.Diary[label], row = after.challenges.Diary[label];
  assert.match(row.Description, /^Feed your teammate some food/);
  assert.match(row.Description, /members-only Summoning/);
  assert.equal(permanentTaskId('Diary', label, row), 'rs3:task:002cb9');
  for (const field of Object.keys(original).filter(field => field !== 'Description')) assert.deepEqual(row[field], original[field]);
  assert.equal(Object.hasOwn(row, 'Not F2P'), false, 'Kitchen Aid stays free-to-play.');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(applyRetainedTaskCorrections(after, { strict: true }), after);
});
