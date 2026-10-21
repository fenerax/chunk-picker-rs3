import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const combatSkills = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Constitution'];

/** Authored planning tiers, not game requirements or measured efficiency. */
export function combatEntryLevel(combatLevel) {
  if (!Number.isSafeInteger(combatLevel) || combatLevel < 1) throw new RangeError('Need a reviewed combat level.');
  return combatLevel < 10 ? 1 : combatLevel < 25 ? 10 : combatLevel < 40 ? 20
    : combatLevel < 60 ? 30 : combatLevel < 80 ? 40 : combatLevel < 100 ? 50 : 60;
}

const economics = { gpPerAction: null, priceDate: null, sourceIds: [],
  notes: 'Supply, consumption and yield are unmeasured; net opportunity cost is unknown.' };

export function expansionMethods(catalogue, evidence) {
  const caps = new Map(catalogue.skills.map(row => [row.skill, row.f2pCap]));
  const common = { matches: [], members: false, xpPerAction: null, xpPerHour: null,
    inputs: [], outputs: [], estimateQuality: 'unknown-throughput', economics };
  return [
    ...evidence.monsters.filter(row => !row.existing).flatMap(row => combatSkills.map(skill => ({ ...common,
      id: `${skill.toLowerCase()}.${row.id}`, skill, label: `Fight ${row.label.toLowerCase()} (${skill})`,
      level: combatEntryLevel(row.combatLevel), maxLevel: caps.get(skill), actionUnit: 'credited kill',
      requirements: [{ kind: 'monster', name: row.selector }], sourceIds: [row.sourceId],
      assumptions: [evidence.entryRule.methodNote,
        'Use the selected combat XP settings for this skill; Constitution is gained alongside combat. These entry tiers assume suitable F2P equipment and food, not owned supplies or a measured kill rate.',
        ...(row.notes ? [row.notes] : []), 'XP per kill, XP/hour, ammunition/rune consumption, drops and economics remain unknown.'],
    }))),
    ...evidence.otherMethods.map(row => ({ ...common, ...row.method, maxLevel: caps.get(row.method.skill),
      sourceIds: row.sourceIds, assumptions: row.assumptions })),
  ];
}

/** Merge reviewed data only; never reads or writes a game cache or save. */
export function buildTrainingData(catalogue, evidence) {
  const methods = catalogue.methods.map(method => {
    const row = evidence.monsters.find(row => row.existing && combatSkills.includes(method.skill)
      && method.id === `${method.skill.toLowerCase()}.${row.id}`);
    if (!row) return method;
    const level = combatEntryLevel(row.combatLevel);
    if (method.level !== row.beforeLevel && method.level !== level) throw new Error(`Changed entry level: ${method.id}`);
    return { ...method, level, sourceIds: [...new Set([...method.sourceIds, row.sourceId])],
      assumptions: [...new Set([...method.assumptions, evidence.entryRule.methodNote, ...(row.notes ? [row.notes] : [])])] };
  });
  const append = (rows, additions) => {
    const result = [...rows];
    for (const row of additions) {
      const existing = result.find(value => value.id === row.id);
      if (!existing) result.push(row);
      else if (JSON.stringify(existing) !== JSON.stringify(row)) throw new Error(`Conflicting reviewed record: ${row.id}`);
    }
    return result;
  };
  return { ...catalogue, version: evidence.version, researchedAt: evidence.reviewed,
    methods: append(methods, expansionMethods(catalogue, evidence)), sources: append(catalogue.sources, evidence.sources) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = 'app/data/training/methods.f2p.json';
  const evidenceFile = 'app/data/training/f2p-expansion.2026-10-13.v1.json';
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const catalogue = buildTrainingData(read(file), read(evidenceFile));
  writeFileSync(file, JSON.stringify(catalogue, null, 2) + '\n');
  console.log(`F2P training catalogue: ${catalogue.methods.length} methods (${catalogue.version}).`);
}
