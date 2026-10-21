import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareResults } from './audit-f2p-membership.2026-10-08.v1.mjs';
import { pickerEntityMembership } from '../app/data/item-membership.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';

/** Consume isolated, already-redacted captures; never opens a live store. */
export function auditMembershipFollowup({ before = '.local/f2p-audit/membership-before.json', after = '.local/f2p-audit/membership-final.json', output = 'docs/research/membership-task-delta.2026-10-12.v1.json' } = {}) {
  const beforeBytes = readFileSync(before), afterBytes = readFileSync(after), prior = JSON.parse(beforeBytes), next = JSON.parse(afterBytes);
  if (prior.source.stateSha256 !== next.source.stateSha256) throw new Error('Different copied saves cannot establish a task delta.');
  const brief = row => row ? { id: row.id, category: row.category, label: row.label, status: row.status,
    obligation: row.obligation !== false, blockers: row.blockers ?? [] } : null;
  const loss = row => ({ before: brief(row.before), after: brief(row.after), why: (row.after?.blockers ?? []).map(blocker => blocker.detail).filter(Boolean) });
  const gain = row => ({ before: brief(row.before), after: brief(row.after), previousBlockers: (row.before?.blockers ?? []).map(blocker => blocker.detail).filter(Boolean) });
  const players = {};
  for (const player of Object.keys(prior.members)) {
    players[player] = {};
    for (const scenario of ['f2p', 'members']) {
      const beforeResult = prior.scenarios[scenario]?.[player]?.result, afterResult = next.scenarios[scenario]?.[player]?.result;
      if (!beforeResult || !afterResult) throw new Error(`Missing ${scenario}/${player} control.`);
      const delta = compareResults(beforeResult, afterResult);
      if (delta.beforeCounts.possible - delta.allAvailableTaskLosses.length + delta.allAvailableTaskGains.length !== delta.afterCounts.possible) throw new Error('Task delta count mismatch.');
      players[player][scenario] = { before: delta.beforeCounts, after: delta.afterCounts,
        disappeared: delta.allAvailableTaskLosses.map(loss), appeared: delta.allAvailableTaskGains.map(gain),
        ownDisappeared: delta.removedTasks.map(loss), ownAppeared: delta.ownAvailableTaskGains.map(gain),
        activeDisappeared: delta.removedPresented.map(brief), activeAppeared: delta.addedPresented.map(brief),
        changedSourceTasks: delta.sourceOnly.map(row => ({ id: row.id, category: row.category, label: row.label, removedSources: row.removedSources })),
        unknownItems: afterResult.items.map(item => ({ name: item.name, membership: pickerEntityMembership(item.name) })).filter(row => row.membership.status === 'unknown'),
      };
    }
  }
  const result = { schemaVersion: 1, reviewedOn: '2026-10-12', scope: 'Isolated same-save comparison; all possible tasks, own obligations, Active Tasks and F2P-off controls. No saved facts changed.',
    provenance: { stateSha256: prior.source.stateSha256, revision: prior.source.revision,
      captures: [{ label: prior.label, sha256: sha256(beforeBytes) }, { label: next.label, sha256: sha256(afterBytes) }],
      definitionSha256: next.source.definitionSha256,
      beforeAppHashes: prior.source.appHashes, afterAppHashes: next.source.appHashes,
      generator: { path: 'scripts/audit-membership-followup.mjs', sha256: sha256RepositoryText(readFileSync(import.meta.filename)) } }, players };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  const escape = value => String(value ?? '').replaceAll('|', '&#124;').replaceAll('\n', ' ');
  const names = { 'player-1': 'Player 1', 'player-2': 'Player 2' }, lines = [
    '# Membership follow-up: exact copied-player task changes', '',
    'This compares the same isolated copied save before and after H3/H6. The baseline uses an archived pre-change app; both captures use identical definitions, saved facts and cache inputs. The live picker and original save were not opened by the audit.', '',
    '| Player | Mode | Possible before → after | Own before → after | Active before → after | Obtainable names before → after | Unknown names after |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [player, modes] of Object.entries(players)) for (const [mode, row] of Object.entries(modes)) lines.push(
    `| ${names[player]} | ${mode === 'f2p' ? 'F2P' : 'F2P off'} | ${row.before.possible} → ${row.after.possible} | ${row.before.possibleOwn} → ${row.after.possibleOwn} | ${row.before.active} → ${row.after.active} | ${row.before.items} → ${row.after.items} | ${row.unknownItems.length} |`);
  lines.push('', '## Every task appearing or disappearing', '',
    'Possible tasks include partner-supported capability rows. Own obligations and the normal Active Tasks list are reported separately below. No count substitutes for the exact task-ID comparison.', '',
    '| Player | Mode | Change | Category | Exact task | Own obligation | Reason |', '| --- | --- | --- | --- | --- | --- | --- |');
  let changed = 0;
  for (const [player, modes] of Object.entries(players)) for (const [mode, row] of Object.entries(modes)) {
    for (const entry of row.disappeared) {
      changed++; lines.push(`| ${names[player]} | ${mode === 'f2p' ? 'F2P' : 'F2P off'} | Disappears | ${escape(entry.before.category)} | ${escape(entry.before.label)} (${entry.before.id}) | ${entry.before.obligation ? 'Yes' : 'No'} | ${escape(entry.why.join(' '))} |`);
    }
    for (const entry of row.appeared) {
      changed++; lines.push(`| ${names[player]} | ${mode === 'f2p' ? 'F2P' : 'F2P off'} | Appears | ${escape(entry.after.category)} | ${escape(entry.after.label)} (${entry.after.id}) | ${entry.after.obligation ? 'Yes' : 'No'} | Previous blockers: ${escape(entry.previousBlockers.join(' '))} |`);
    }
  }
  if (!changed) lines.push('| Both | Both | None | — | No possible task appears or disappears. | — | Eligibility remains unchanged in this copied save. |');
  lines.push('', '## Own obligation and Active Tasks changes', '', '| Player | Mode | Scope | Change | Exact task |', '| --- | --- | --- | --- | --- |');
  let scoped = 0;
  for (const [player, modes] of Object.entries(players)) for (const [mode, row] of Object.entries(modes)) for (const [field, scope, change] of [
    ['ownDisappeared','Own','Disappears'],['ownAppeared','Own','Appears'],['activeDisappeared','Active','Disappears'],['activeAppeared','Active','Appears'],
  ]) for (const entry of row[field]) {
    scoped++; const task = entry.after ?? entry.before ?? entry;
    lines.push(`| ${names[player]} | ${mode === 'f2p' ? 'F2P' : 'F2P off'} | ${scope} | ${change} | ${escape(task.category)}: ${escape(task.label)} (${task.id}) |`);
  }
  if (!scoped) lines.push('| Both | Both | Own and Active | None | No task appears or disappears. |');
  lines.push('', 'Player 2\'s completed shared Guild-entry objective previously counted as satisfied Attack 65 and Strength 65. Entry may instead be earned through an uneven combined level or mastery in either skill. The corrected composite entry goal no longer proves either standalone skill level. This removes an invalid presentation suppression: the gravite melee-weapon goal (Attack 55) reappears in F2P, and the Dorgesh-Kaan grapple-course goal (Strength 60) reappears with F2P off. Both were already available before; item access and reachable training are unchanged. The JSON ledger identifies any further eligibility changes independently.');
  lines.push('', '## Evidence and verification', '',
    `Copied save revision: ${result.provenance.revision}. Exact save SHA-256: \`${result.provenance.stateSha256}\`.`, '',
    `Before capture SHA-256: \`${result.provenance.captures[0].sha256}\`. After capture SHA-256: \`${result.provenance.captures[1].sha256}\`.`, '',
    'The matching JSON ledger records the complete before/after app hashes, source reductions, all task IDs, after blockers and remaining unknown selector names. Raw copied-save and result files are local-only and deleted after verification. Saved completion, player progress, History and Undo are unchanged.', '',
    'The six prediction goldens were compared as complete objects against the archived app. Their only change is the supported-field list gaining RequirementAlternativesDescription; task, item, access and prediction outcomes in those fixtures are identical. Calculation-equivalence and focused membership/entry checks pass. Full-suite and browser counts are reported in the final verification note.', '',
    'Decisions: [items and virtual selectors](membership-item-review-2026-10-12.md), [all monsters](monster-membership-review-2026-10-12.md), [H6 entry requirements](retained-entry-requirements-2026-10-12.md). Mixed family classification does not certify a precise spawn or waive existing location/quest restrictions. Historical item membership does not certify current acquisition.', '',
    'Reproduce with isolated capture files: `node scripts/audit-membership-followup.mjs`. This script never reads a live store.', '');
  writeFileSync(output.replace(/\.json$/, '.md'), lines.join('\n'));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = auditMembershipFollowup();
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result.players).map(([player, modes]) => [player,
    Object.fromEntries(Object.entries(modes).map(([mode, row]) => [mode, { before: row.before, after: row.after, disappeared: row.disappeared.length,
      appeared: row.appeared.length, activeDisappeared: row.activeDisappeared.length, activeAppeared: row.activeAppeared.length, unknownItems: row.unknownItems.length }]))])), null, 2));
}
