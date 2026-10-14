// Reviewed selections are checked against pinned Wiki text. This module never
// discovers files, accesses a network, or evaluates the Wiki's Lua code.
export function templateFields(template) {
  const fields = {}, parts = [];
  let braces = 0, links = 0, start = 2;
  for (let at = 2; at < template.length - 2; at++) {
    const pair = template.slice(at, at + 2);
    if (pair === '{{') { braces++; at++; }
    else if (pair === '}}') { braces--; at++; }
    else if (pair === '[[') { links++; at++; }
    else if (pair === ']]') { links--; at++; }
    else if (template[at] === '|' && braces === 0 && links === 0) { parts.push(template.slice(start, at)); start = at + 1; }
  }
  parts.push(template.slice(start, -2));
  for (const part of parts.slice(1)) {
    const equals = part.indexOf('=');
    if (equals >= 0) fields[part.slice(0, equals).trim().toLowerCase()] = part.slice(equals + 1).trim();
  }
  return fields;
}

export function questPrerequisites(text, title) {
  // Only the exact, flat string-list record is accepted. Unexpected Lua fails
  // closed; the generator does not execute a module or infer sequel gates.
  const key = JSON.stringify(title);
  const line = text.split('\n').find(line => line.trimStart().startsWith(`[${key}] = `));
  // Module:Questreq treats an absent key as no quest prerequisites. Its pinned
  // implementation is part of every quest receipt, including seasonal gaps.
  if (!line) return { values: [], needle: null };
  const body = line.slice(line.indexOf('=') + 1).trim();
  const match = /^\{(.*)\},?\s*$/.exec(body);
  if (!match) throw new Error(`Unsupported Wiki prerequisite record: ${title}.`);
  let values;
  try { values = JSON.parse(`[${match[1]}]`); }
  catch { throw new Error(`Unsupported Wiki prerequisite values: ${title}.`); }
  if (!values.every(value => typeof value === 'string')) throw new Error(`Invalid Wiki prerequisites: ${title}.`);
  return { values, needle: line.trim() };
}

const unique = values => [...new Set(values)];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildStories({ spec, pages, cells, templates }) {
  if (!spec.questActivities) return { quests: [], achievements: [], achievementReview: [], tasks: [] };
  const proof = ({ page, needle }) => {
    const source = pages.get(page);
    if (!source || !needle || !source.text.includes(needle)) throw new Error(`Story evidence changed: ${page}: ${needle}.`);
    return source.provenance;
  };
  const rosterSource = pages.get('Template:F2P Quests');
  const rosterText = rosterSource.text.split('|gtitle5 = Historical')[0];
  const roster = [...rosterText.matchAll(/\{\{QuestIcon\|([^}|]+)/g)].map(match => match[1]);
  if (roster.length !== spec.questActivities.length || new Set(roster).size !== roster.length
    || roster.some(title => !spec.questActivities.some(row => row.page === title))) throw new Error('Reviewed quest selection differs from the current pinned F2P roster.');
  const questIds = new Map(spec.questActivities.map(row => [row.page, `rs3:open-f2p:activity:quest:${row.slug}`]));
  const dependencySource = pages.get('Module:Questreq/data');
  const build = (selection, kind) => {
    if (!slugPattern.test(selection.slug)) throw new Error(`Invalid story identity: ${selection.slug}.`);
    const source = pages.get(selection.page);
    if (!source) throw new Error(`Unpinned story page: ${selection.page}.`);
    const evidence = selection.evidence ?? [];
    if (!evidence.length || !selection.locations?.length) throw new Error(`Incomplete story review: ${selection.page}.`);
    const receipts = [source.provenance, ...evidence.map(proof)];
    const details = templateFields(templates(source.text, kind === 'quest' ? 'Quest details' : 'Infobox Achievement')[0] ?? '');
    if (details.members?.toLowerCase() !== 'no') throw new Error(`Story has no explicit free membership: ${selection.page}.`);
    const manualChecks = [...(selection.manualChecks ?? [])];
    let dependencies = selection.questRequirements ?? [];
    if (kind === 'quest') {
      const parsed = questPrerequisites(dependencySource.text, selection.page);
      receipts.push(dependencySource.provenance, rosterSource.provenance);
      receipts.push(...(spec.questDependencyEvidence ?? []).map(proof));
      dependencies = parsed.values.filter(value => !/^(Partial:|Misc:|Follows:)/.test(value)).map(value => value.replace(/^Full:/, ''));
      for (const value of parsed.values.filter(value => /^(Partial:|Misc:)/.test(value))) manualChecks.push(`Check this quest condition in game: ${value.replace(/^(Partial:|Misc:)/, '')}.`);
      if (JSON.stringify([...dependencies].sort()) !== JSON.stringify([...(selection.questRequirements ?? [])].sort())) throw new Error(`Quest prerequisites differ from the pinned Wiki module: ${selection.page}.`);
    }
    const prerequisiteTasks = dependencies.map(title => {
      const id = questIds.get(title);
      if (!id) throw new Error(`Unresolved quest requirement: ${selection.page}: ${title}.`);
      return id;
    });
    const locations = selection.locations.map(location => {
      const provenance = proof(location);
      receipts.push(provenance);
      const coordinateProof = location.coordinateEvidence ? proof(location.coordinateEvidence) : null;
      if (coordinateProof) receipts.push(coordinateProof);
      if (location.cell && !cells.has(location.cell)) throw new Error(`Unreviewed story location cell: ${selection.page}: ${location.cell}.`);
      if (!location.cell && !location.optional) manualChecks.push(`Check access to ${location.name}; its required location is not fully reviewed.`);
      return { ...location, cell: location.cell ?? null, provenance: [...new Map([provenance, coordinateProof].filter(Boolean).map(row => [row.page, row])).values()] };
    });
    const point = selection.start;
    const sourceCell = Number.isSafeInteger(point?.x) && Number.isSafeInteger(point?.y)
      ? String(Math.floor(point.x / 64) * 256 + Math.floor(point.y / 64)) : null;
    const startCell = sourceCell && cells.has(sourceCell) ? sourceCell : null;
    const start = point ? { ...point, sourceCell, cell: startCell } : null;
    if (kind === 'quest' && (!startCell || start.plane !== 0)) manualChecks.push('Check the quest start location and floor; its access is not fully reviewed.');
    // An unreviewed start is displayed with the starting catalogue, never
    // admitted as a new cell or a walking connection.
    const cell = startCell ?? locations.find(location => location.cell)?.cell ?? '12850';
    const requiredCells = unique([cell, ...locations.filter(location => !location.optional).map(location => location.cell).filter(Boolean)]).sort();
    for (const check of selection.itemChecks ?? []) manualChecks.push(`Check supplies: ${check}`);
    if (selection.itemRequirements?.length && !selection.itemChecks?.length) manualChecks.push('Check the required items and quantities in game; inventory is not tracked.');
    for (const check of selection.ironmanRequirements ?? []) manualChecks.push(`Check self-supply: ${check}.`);
    const provenance = [...new Map(receipts.map(row => [row.page, row])).values()];
    const id = `rs3:open-f2p:${kind}:${selection.slug}`;
    const requirementText = details.requirements ?? '';
    const row = { id, kind, page: selection.page, cell, start, requiredCells, locations, membership: 'free',
      skillRequirements: selection.skillRequirements ?? {}, questRequirements: dependencies, prerequisiteTasks,
      itemRequirements: selection.itemRequirements ?? [], itemChecks: selection.itemChecks ?? [],
      ...(selection.questPointsNeeded !== undefined ? { questPointsNeeded: selection.questPointsNeeded } : {}),
      ...(kind === 'quest' ? { questPoints: selection.questPoints, seasonal: rosterText.slice(rosterText.indexOf('|gtitle4 = Seasonal')).includes(`{{QuestIcon|${selection.page}}}`) } : {}),
      // Keep full source fields as attributed evidence, away from authored code.
      wikiRequirements: requirementText, wikiItems: details.items ?? '',
      manualChecks: unique(manualChecks), provenance };
    if (kind === 'quest' && (!Number.isSafeInteger(row.questPoints) || row.questPoints < 0)) throw new Error(`Invalid quest points: ${selection.page}.`);
    const reason = `${selection.summary ?? `Complete ${selection.page} in game.`} ${row.manualChecks.join(' ')}`.trim();
    const task = { id: `rs3:open-f2p:activity:${kind}:${selection.slug}`, sourceId: id, cell, skill: kind === 'quest' ? 'Quest' : 'Diary', level: 1,
      label: selection.label, reason, requiredCells, skillRequirements: row.skillRequirements, prerequisiteTasks,
      supplyItems: row.itemRequirements, manualChecks: row.manualChecks,
      ...(row.questPointsNeeded !== undefined ? { questPointsNeeded: row.questPointsNeeded } : {}),
      ...(kind === 'quest' ? { questPoints: row.questPoints, baseQuest: selection.page } : {}), provenance };
    return { row, task };
  };
  const quests = spec.questActivities.map(row => build(row, 'quest'));
  const achievements = (spec.achievementActivities ?? []).map(row => build(row, 'achievement'));
  const achievementReview = (spec.achievementSkips ?? []).map(row => ({ ...row, provenance: (row.evidence ?? []).map(proof) }));
  return { quests: quests.map(value => value.row), achievements: achievements.map(value => value.row), achievementReview,
    tasks: [...quests, ...achievements].map(value => value.task) };
}
