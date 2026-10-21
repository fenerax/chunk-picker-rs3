import test from 'node:test';
import assert from 'node:assert/strict';
import { fishingRateText, fishingChanceNotes } from '../app/web/fishing-display.mjs';

test('Fishing rates show whole totals and each mixed species, including level ranges', () => {
  assert.equal(fishingRateText({ xpPerHour: 25000.2, fishPerHour: 400.6, species: [{ label: 'Salmon', fishPerHour: 100.1 }, { label: 'Trout', fishPerHour: 300.5 }] }),
    '25,000 XP/hour estimated · 401 fish/hour estimated (100 salmon/hour, 301 trout/hour)');
  assert.match(fishingRateText({ xpPerHour: 25000, xpPerHourStart: 24000.2, xpPerHourEnd: 26000.7, fishPerHour: 500 }), /24,000–26,001 XP\/hour/);
  assert.equal(fishingRateText({ xpPerHour: null, fishPerHour: null }), 'XP/hour unknown · fish/hour unknown');
  assert.match(fishingRateText({ xpPerHour: 1000, fishPerHour: 100, fishing: { methodId: 'small-net' }, species: [{ label: 'Shrimps', fishPerHour: 100 }] }), /100 fish\/hour estimated \(100 shrimps\/hour\)/);
});

test('Advanced distinguishes the raw roll from the conditional catch and explains roll order', () => {
  const notes = fishingChanceNotes({ attemptTicks: 5, sourceVersion: 'pinned', species: [
    { id: 'swordfish', label: 'Swordfish', rawChance: .125, catchChance: .125 },
    { id: 'tuna', label: 'Tuna', rawChance: .25, catchChance: .21875 },
  ] });
  assert.match(notes.join(' '), /5 ticks \(3 seconds\)/);
  assert.match(notes.join(' '), /Tuna roll chance: 25%; catch chance per attempt: 21.88%/);
  assert.match(notes.join(' '), /later roll only runs after the earlier rolls fail/);
});
