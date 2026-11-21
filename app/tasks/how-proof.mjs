// Optional, replay-local evidence. Availability is still decided by check().
export const HOW_SCHEMA = 1;
export const HOW_ENGINE_BASE = '977cc9e36b62d2f4e00d33fe6ceb17f5c2884b84';
const clean = value => String(value).replace(/~\|([^|]+)\|~/g, '$1').replace(/\*+$/g, '');
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const AREA_POLICY_KEYS = new Set(['UnlocksArea', 'Not F2P', 'Category', 'Label', 'Priority', 'Description', 'NoBoost']);
export const areaUnlockHasRequirements = record => Boolean(record?.UnlocksArea && Object.keys(record).some(key => !AREA_POLICY_KEYS.has(key)));
const matchesApproach = (subject, place) => subject === place || /^\d+$/.test(subject) && place.startsWith(`${subject}-`);
export function createHowCapture({ state, memberId, definitions, byKey, completedTask, limits = {}, deadline: requestDeadline }) {
  const facts = new Map(), nodes = new Map(), boundEntrances = new Map(), sourceReasons = new Map(), choices = new Map(), baseSections = new Map(), producedObjects = new Map(), clueLocations = new Map(), usedTraining = new Set();
  const combatSeedSkills = new Set();
  const byId = new Map([...byKey.values()].map(task => [task.id, task]));
  const sharedMap = state.members.length === 2 ? "your partner's map" : "another group member's map";
  const areaApproaches = new Map(), areaLocations = new Map(), entityEntrancePlacements = new Map();
  const definitionRef = task => ({ catalogue: 'effective', pointer: `/challenges/${pointer(task.category)}/${pointer(task.rawLabel)}` });
  const maxCapture = Math.min(100000, limits.captureNodes ?? 50000);
  const deadline = requestDeadline ?? performance.now() + Math.min(25000, limits.replayMs ?? 20000);
  let ordinal = 0, exhausted = false, finishCache = null;
  const cached = (key, build) => {
    if (!finishCache) return build();
    if (!finishCache.has(key)) finishCache.set(key, build());
    return finishCache.get(key);
  };
  const put = (key, value) => {
    if (facts.has(key)) return facts.get(key);
    if (nodes.size >= maxCapture || performance.now() >= deadline) { exhausted = true; return null; }
    const id = `n${++ordinal}`;
    const node = { ...value, admissionOrder: ordinal, allOf: (value.allOf ?? []).map(id => id ?? 'uncaptured') };
    nodes.set(id, node); facts.set(key, id); return id;
  };
  const gap = (kind, detail) => put(`gap:${kind}:${detail}`, { kind: 'gap', gap: kind, label: detail, evidenceClass: 'gap' });
  const get = (key, detail = "The picker can't show this step yet.") => facts.get(key) ?? gap(exhausted ? 'budget' : 'missing-evidence', detail);
  const taskRef = key => get(`task:${key}`, `The picker can't show the prerequisite ${clean(key.split('\0').at(-1))} yet.`);
  const gateRefs = gate => {
    if (!gate || gate === true) return [];
    if (Array.isArray(gate)) return gate.flatMap(gateRefs);
    if (gate.__all) return gate.__all.flatMap(gateRefs);
    if (gate.Tasks) return gateRefs(gate.Tasks);
    return Object.entries(gate).map(([name, category]) => taskRef(`${category}\0${name}`));
  };
  const placeLabel = value => {
    const record = definitions.areas?.[value] ?? definitions.chunks?.[value] ?? definitions.chunks?.[String(value).replace(/-\d+$/, '')];
    const name = record?.Nickname ?? record?.Name ?? value;
    return /^\d+(?:-\d+)?$/.test(name) ? 'your unlocked chunk' : clean(name);
  };
  const placeRef = id => {
    const direct = facts.get(`place:${id}`);
    if (direct) return direct;
    const sections = /^\d+$/.test(id) ? baseSections.get(id) : null;
    if (sections?.length) {
      const choice = put(`place-base:${id}`, { kind: 'location', subjectId: id, placeName: placeLabel(id), label: `Reach ${placeLabel(id)}.`,
        rule: 'owned-chunk', evidenceClass: 'derived', allOf: [sections[0].id] });
      if (choice && !choices.has(choice)) choices.set(choice, { count: 1, candidates: () => [...(baseSections.get(id) ?? [])] });
      return choice;
    }
    return get(`place:${id}`);
  };
  const location = (id, reason = {}) => {
    if (facts.has(`place:${id}`)) return;
    const binding = reason.areaTask ? boundEntrances.get(id) : null;
    if (reason.areaTask) reason = { ...reason, from: binding?.from, viaEntity: binding?.viaEntity, viaKind: binding?.viaKind, viaPlacementId: binding?.viaPlacementId, unbound: !binding };
    const name = placeLabel(id);
    const deps = reason.from && !reason.areaTask ? [placeRef(reason.from)] : [];
    deps.push(...gateRefs(reason.gate));
    if (reason.areaTask) deps.push(taskRef(`Nonskill\0${id}`));
    const unsupported = reason.resourceOnly ? 'resource-only-access' : reason.transport ? 'transport-legs' : reason.partner ? 'partner-duo' : reason.unbound ? 'unbound-entrance' : null;
    if (unsupported) deps.push(gap(unsupported, {
      'resource-only-access': "The picker can use resources here, but hasn't proved a walking route into this place.",
      'transport-legs': "This route uses transport; the picker hasn't shown which journey to take yet.",
      'partner-duo': `Uses ${sharedMap} (route not shown yet).`,
      'unbound-entrance': "The picker hasn't linked this area permission to a reachable entrance.",
    }[unsupported]));
    if (reason.manual) deps.push(gap('manual-assumption', 'This access comes from a manual grant.'));
    const entityEntry = Boolean(reason.from && reason.viaEntity);
    const node = put(`place:${id}`, { kind: 'location', subjectId: id, placeName: name, from: reason.from, fromName: reason.from && placeLabel(reason.from),
      ...(entityEntry ? { viaEntity: reason.viaEntity, viaKind: reason.viaKind } : {}),
      areaAccess: !!reason.areaTask,
      label: entityEntry ? `Enter ${name} via ${reason.viaEntity} at ${placeLabel(reason.from)}.`
        : reason.from ? `Get into ${name} from ${placeLabel(reason.from)}.` : `Reach ${name}.`,
      rule: entityEntry ? 'entity-entrance' : reason.from ? 'walking-entrance' : 'owned-chunk',
      evidenceClass: reason.manual ? 'manual' : 'derived', allOf: deps });
    if (node && reason.areaTask) areaLocations.set(node, id);
    if (node && entityEntry && reason.viaPlacementId) entityEntrancePlacements.set(node, reason.viaPlacementId);
    if (node && /^\d+-\d+$/.test(id)) {
      const base = id.split('-')[0];
      if (!baseSections.has(base)) baseSections.set(base, []);
      baseSections.get(base).push({ subject: id, id: node });
    }
  };
  const entity = (kind, name, place, gates = []) => put(`entity:${kind}:${name}:${place}`, {
    kind: 'placement', entityKind: kind, subjectId: name, location: place, placeName: placeLabel(place), label: `Find ${clean(name)} at ${placeLabel(place)}.`,
    rule: 'entity-placement', evidenceClass: 'derived', allOf: [placeRef(place), ...gates.flatMap(gateRefs)] });
  const clue = (tier, place) => {
    const article = /^[aeiou]/i.test(tier) ? 'an' : 'a';
    const id = put(`clue:${tier}:${place}`, {
      kind: 'placement', entityKind: 'Clue', subjectId: tier, location: place, placeName: placeLabel(place),
      label: `Reach ${article} ${clean(tier)} clue location at ${placeLabel(place)}.`,
      rule: 'clue-location', evidenceClass: 'derived', allOf: [placeRef(place)],
    });
    if (id) {
      if (!clueLocations.has(tier)) clueLocations.set(tier, []);
      const list = clueLocations.get(tier);
      if (!list.some(entry => entry.id === id)) list.push({ subject: `Clue:${tier}:${place}`, id });
    }
  };
  const hasPartnerEvidence = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return false; seen.add(id);
    const node = nodes.get(id);
    return node?.gap === 'partner-duo' || (node?.allOf ?? []).some(child => hasPartnerEvidence(child, seen));
  };
  const nonOwnGap = (producer, { admittedPartnerSource = false, subject = 'item' } = {}) => {
    // A personal completion can publish output even when its current place is
    // unavailable. Non-own supply alone does not establish partner ownership.
    if (producer && completedTask(producer)) return gap('historical-source-access', 'This supply comes from a recorded completion; its current production access is not established.');
    const shared = state.rules?.['access.shared'] !== false && state.members.some(owner => owner.id !== memberId && owner.unlocked?.length);
    if (shared && (admittedPartnerSource || producer && hasPartnerEvidence(facts.get(`task:${producer.key}`)))) return gap('partner-duo', `This ${subject} comes from ${sharedMap}.`);
    return gap('source-access', 'Current access to this supply is not established.');
  };
  const producedObject = (name, producer, own) => {
    const key = `produced-object:${name}:${producer.key}:${own ? 1 : 0}`;
    if (facts.has(key)) return;
    const deps = [taskRef(producer.key)];
    if (own === false) deps.push(nonOwnGap(producer, { subject: 'object' }));
    const id = put(key, { kind: 'placement', entityKind: 'Object', subjectId: name, producerId: producer.id,
      label: `Create ${clean(name)} via ${clean(producer.label)}.`, rule: 'produced-object', evidenceClass: 'derived', allOf: deps });
    if (id) {
      if (!producedObjects.has(name)) producedObjects.set(name, []);
      producedObjects.get(name).push({ subject: `Object:${name}:produced:${producer.key}:${own ? 1 : 0}`, id });
    }
  };
  const sourceKey = (name, source) => JSON.stringify([name, source.kind, source.source, source.name, source.location, source.taskId]);
  const source = (name, record, gates) => {
    if (sourceReasons.size >= maxCapture) { exhausted = true; return; }
    const key = sourceKey(name, record);
    if (!sourceReasons.has(key)) sourceReasons.set(key, gates.flatMap(gateRefs));
  };
  const sourceRef = (name, source) => {
    const key = `source:${name}:${JSON.stringify(source)}`;
    const captured = sourceReasons.get(sourceKey(name, source));
    const deps = [...(captured ?? [])];
    if (!captured && ['drop', 'shop', 'object', 'spawn'].includes(source.kind) && !source.taskId) deps.push(gap(exhausted ? 'budget' : 'missing-evidence', 'The source admission evidence was not captured.'));
    if (source.own === false) {
      const producer = source.taskId && byId.get(source.taskId);
      const admittedPartnerSource = Boolean(source.location && ['drop', 'shop', 'object', 'spawn'].includes(source.kind));
      deps.push(nonOwnGap(producer, { admittedPartnerSource, subject: 'item' }));
    }
    if (source.taskId) {
      const task = byId.get(source.taskId);
      deps.push(task ? taskRef(task.key) : gap('unsupported-kind', 'This item has a generated producer.'));
    } else if (source.location) {
      const kind = { spawn: 'Spawn', drop: 'Monster', object: 'Object', shop: 'Shop' }[source.kind];
      deps.push(get(`entity:${kind}:${source.kind === 'spawn' ? name : source.source}:${source.location}`, `The picker can't show the source of ${clean(name)} yet.`));
    } else if (source.kind === 'recorded') {
      // Personal obtain evidence is an explicit root, not a renewable source.
    } else if (source.kind === 'manual' || source.source?.startsWith('Manually')) deps.push(gap('manual-assumption', `You manually declared ${clean(name)}.`));
    else deps.push(gap('unsupported-kind', `The picker can't show the source of ${clean(name)} yet.`));
    if (source.processingMode) deps.push(gap('processing', 'Processing source selection is not explained yet.'));
    return put(key, { kind: 'item-source', subjectId: name, sourceKind: source.kind, sourceName: clean(source.source ?? source.name ?? 'the selected source'), location: source.location, placeName: source.location && placeLabel(source.location),
      label: source.kind === 'recorded' ? `You recorded obtaining ${clean(name)}.` : `Obtain ${clean(name)} from ${source.kind === 'spawn' ? 'a reachable item spawn' : clean(source.source ?? source.name ?? 'the selected source')}.`,
      rule: 'selected-item-source', evidenceClass: source.kind === 'recorded' ? 'personal' : 'derived', allOf: deps });
  };
  const select = (requirement, available) => [...new Set(requirement.alternatives ?? [requirement.clean])].filter(available).sort();
  function task(task, env) {
    if (facts.has(`task:${task.key}`)) return;
    if (completedTask(task)) {
      put(`task:${task.key}`, { kind: 'task', subjectId: task.id, definitionRef: definitionRef(task), label: `You recorded completing ${clean(task.label)}.`, rule: 'recorded-completion', evidenceClass: 'personal' }); return;
    }
    const deps = [];
    for (const requirement of task.requirements) {
      const chosen = select(requirement, name => env.available(requirement.field, name, task));
      const witness = name => {
        if (requirement.field === 'Chunks') return env.ownLocation(name) ? placeRef(name) : gap('partner-duo', `This location is on ${sharedMap}.`);
        if (requirement.field === 'Items') {
          const sources = env.sources(name).filter(source => env.matches([source], task.record, task.category, name))
            .sort((a, b) => Number(b.kind === 'recorded') - Number(a.kind === 'recorded') || Number(b.own) - Number(a.own) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
          if (!sources.length) return gap('source-selectors', `Different sources jointly satisfy the constraints for ${clean(name)}; a single source is not established.`);
          const candidates = sources.map(source => ({ subject: sourceKey(name, source), id: sourceRef(name, source) }));
          const choice = put(`item-choice:${task.id}:${name}`, { kind: 'requirement', field: 'Sources', label: `Obtain ${clean(name)}.`, rule: 'selected-source', allOf: [candidates[0].id] });
          if (choice) choices.set(choice, { count: 1, candidates: () => env.sources(name).filter(source => env.matches([source], task.record, task.category, name))
            .map(source => ({ subject: sourceKey(name, source), id: sourceRef(name, source) })) });
          return choice;
        }
        const kinds = requirement.field === 'Mix' ? ['NPC', 'Monster'] : [{ Objects: 'Object', NPCs: 'NPC', Monsters: 'Monster', Monster: 'Monster', Shops: 'Shop' }[requirement.field]];
        const candidates = kinds.flatMap(kind => [...(env.access.locations.get(`${kind}:${name}`) ?? [])].map(place => ({ kind, place })))
          .sort((a, b) => a.place.localeCompare(b.place));
        const found = candidates.filter(({ kind, place }) => facts.has(`entity:${kind}:${name}:${place}`));
        const produced = kinds.includes('Object') ? [...(producedObjects.get(name) ?? [])] : [];
        const allFound = [
          ...found.map(value => ({ subject: `${value.kind}:${name}:${value.place}`, id: facts.get(`entity:${value.kind}:${name}:${value.place}`) })),
          ...produced,
        ];
        const monsterGate = kinds.includes('Monster') ? env.monsterGate(name) : null;
        const placement = allFound.length ? put(`placement-choice:${task.id}:${name}`, { kind: 'requirement', field: 'Placements', label: `Reach ${clean(name)}.`, rule: 'selected-placement', allOf: [allFound[0].id] }) : candidates.length && candidates.every(candidate => !env.ownLocation(candidate.place)) ? gap('partner-duo', `Found on ${sharedMap}.`) : gap('unsupported-kind', `The picker can't show the ${requirement.field} step for ${clean(name)} yet.`);
        if (allFound.length && placement) choices.set(placement, { count: 1, candidates: () => [
          ...found.map(value => ({ subject: `${value.kind}:${name}:${value.place}`, id: facts.get(`entity:${value.kind}:${name}:${value.place}`) })),
          ...(kinds.includes('Object') ? producedObjects.get(name) ?? [] : []),
        ] });
        return monsterGate ? put(`gated-placement:${task.id}:${name}`, { kind: 'placement', label: `Reach ${clean(name)}.`, allOf: [placement, gap(monsterGate, `The picker can't show this ${monsterGate.replaceAll('-', ' ')} step yet.`)] }) : placement;
      };
      const refs = chosen.map(witness);
      const choice = put(`requirement:${task.id}:${requirement.field}:${requirement.token}`, { kind: 'requirement', field: requirement.field, label: `${requirement.field === 'Items' ? 'Obtain' : 'Reach'} ${clean(requirement.displayLabel)}.`,
        rule: requirement.alternatives ? 'selected-alternatives' : 'required', distinctCount: requirement.count, selectedSubjects: chosen.slice(0, requirement.count), alternativesAvailable: (requirement.alternatives ?? []).length, allOf: refs.slice(0, requirement.count) });
      if (choice) choices.set(choice, { count: requirement.count, candidates: () => select(requirement, name => env.available(requirement.field, name, task))
        .map(name => ({ id: witness(name), subject: name })) });
      deps.push(choice);
      if (chosen.length < requirement.count) deps.push(gap('missing-evidence', 'The required distinct witnesses were not captured.'));
    }
    for (const [skill, required] of task.needs) if (required > 1) deps.push(skillRef(skill, required, env));
    for (const dependency of task.dependencies) {
      const names = [...new Set(dependency.alternatives ?? [dependency.clean])];
      if (names.every(name => name.split('--')[0] === task.rawLabel && dependency.category === task.category)) {
        deps.push(put(`self:${task.id}`, { kind: 'policy', label: 'The picker treats this self-reference as an alternative production annotation.', rule: 'self-link-annotation' })); continue;
      }
      const relaxed = env.anyAchievements ? dependency.relaxedAny : dependency.relaxedAlways;
      const chosen = new Map();
      for (const name of names.sort((a, b) => Number(completedTask(byKey.get(`${dependency.category}\0${b.split('--')[0]}`) ?? {})) - Number(completedTask(byKey.get(`${dependency.category}\0${a.split('--')[0]}`) ?? {})) || a.localeCompare(b))) {
        const raw = name.split('--')[0], key = `${dependency.category}\0${raw}`;
        if (key === task.key || chosen.has(key)) continue;
        if (relaxed.has(raw)) chosen.set(key, put(`relaxed:${task.id}:${key}`, { kind: 'policy', label: `Rules waive ${clean(raw)}.`, rule: 'relaxed-dependency' }));
        else if (env.valid.has(key)) chosen.set(key, taskRef(key));
        if (chosen.size === dependency.count) break;
      }
      const choice = put(`dependency:${task.id}:${dependency.category}:${dependency.token}`, { kind: 'requirement', field: 'Tasks',
        label: `Complete ${clean(dependency.displayLabel)}.`, rule: 'selected-task-alternatives', distinctCount: dependency.count, allOf: [...chosen.values()] });
      if (choice) choices.set(choice, { count: dependency.count, candidates: () => [...new Set(names.map(name => name.split('--')[0]))]
        .filter(raw => `${dependency.category}\0${raw}` !== task.key)
        .map(raw => ({ subject: `${dependency.category}\0${raw}`, id: relaxed.has(raw) ? chosen.get(`${dependency.category}\0${raw}`) : facts.get(`task:${dependency.category}\0${raw}`) })).filter(value => value.id) });
      deps.push(choice);
      if (chosen.size < dependency.count) deps.push(gap('missing-evidence', 'The picker did not capture enough distinct prerequisites.'));
    }
    for (const id of task.completedDependencies) {
      const target = byId.get(id); deps.push(target ? taskRef(target.key) : gap('unsupported-kind', 'Unknown personal completion.'));
    }
    if (areaUnlockHasRequirements(task.record)) {
      // A global area permission and a nearby candidate are not a bound route.
      // Only an admitted access-task chain containing that exact approach—or a
      // directly required NPC/Object placement located in that approach—binds it.
      const approaches = env.access.entranceSources.get(task.rawLabel) ?? [];
      areaApproaches.set(task.rawLabel, approaches);
      const usesPlace = (id, place, seen = new Set()) => {
        if (!id || seen.has(id)) return false; seen.add(id);
        const node = nodes.get(id);
        if (node?.kind === 'requirement' && node.field === 'Chunks') {
          const subjects = choices.has(id) ? choices.get(id).candidates().map(value => value.subject) : node.selectedSubjects;
          return subjects.some(subject => matchesApproach(subject, place));
        }
        if (node?.kind !== 'task' && node?.field !== 'Tasks') return false;
        const children = node.field === 'Tasks' && choices.has(id) ? choices.get(id).candidates().map(value => value.id) : node.allOf;
        return children.some(child => usesPlace(child, place, seen));
      };
      const findEntityEntry = (id, place, seen = new Set()) => {
        if (!id || seen.has(id)) return null; seen.add(id);
        const node = nodes.get(id);
        if (!node) return null;
        if (node.kind === 'placement' && ['NPC', 'Object'].includes(node.entityKind) && node.location
          && (matchesApproach(node.location, place) || matchesApproach(place, node.location))) {
          return { from: node.location, kind: 'entity', viaEntity: clean(node.subjectId), viaKind: node.entityKind, viaPlacementId: id };
        }
        if (node.kind === 'requirement' && ['NPCs', 'Objects', 'Mix', 'Placements', 'Tasks'].includes(node.field)) {
          const children = choices.has(id) ? choices.get(id).candidates().map(value => value.id) : node.allOf;
          for (const child of children) { const hit = findEntityEntry(child, place, seen); if (hit) return hit; }
          return null;
        }
        if (node.kind === 'task') {
          for (const child of node.allOf) { const hit = findEntityEntry(child, place, seen); if (hit) return hit; }
        }
        return null;
      };
      const sortedApproaches = [...approaches].sort();
      const walkingFrom = sortedApproaches.find(place => deps.some(id => usesPlace(id, place)));
      let binding = walkingFrom ? { from: walkingFrom, kind: 'walking' } : null;
      if (!binding) {
        for (const place of sortedApproaches) {
          for (const id of deps) { binding = findEntityEntry(id, place); if (binding) break; }
          if (binding) break;
        }
      }
      if (binding) boundEntrances.set(task.rawLabel, binding);
      if (!binding) deps.push(gap('unbound-entrance', `The picker hasn't linked ${clean(task.label)} to a reachable entrance.`));
    }
    if (task.record.ClueTier) {
      const tier = task.record.ClueTier;
      const article = /^[aeiou]/i.test(tier) ? 'an' : 'a';
      let fallback;
      const getFallback = () => fallback ??= (!env.ownClue?.(tier) && (env.access.clues?.get(tier) ?? 0) > 0)
        ? gap('partner-duo', `Found on ${sharedMap}.`)
        : gap('missing-evidence', `The picker couldn't capture a reachable ${clean(tier)} clue location.`);
      const available = () => {
        const own = [...(clueLocations.get(tier) ?? [])];
        if (own.length) return own;
        const fb = getFallback();
        return fb ? [{ subject: 'fallback', id: fb }] : [];
      };
      const initial = clueLocations.get(tier) ?? [];
      const first = initial.length ? initial[0].id : getFallback();
      const choice = put(`clue-tier:${task.id}:${tier}`, { kind: 'requirement', field: 'Clues',
        label: `Reach ${article} ${clean(tier)} clue location.`, rule: 'clue-location-access', allOf: first ? [first] : [] });
      if (choice) { choices.set(choice, { count: 1, candidates: available }); deps.push(choice); }
    }
    if (task.record.ConnectsSections) {
      const sections = [...new Set(Array.isArray(task.record.Sections) ? task.record.Sections : task.record.Sections ? [task.record.Sections] : [])];
      const seenBases = new Set();
      for (const name of sections) {
        if (/^\d+(?:-\d+)?$/.test(name)) {
          const base = name.split('-')[0];
          if (seenBases.has(base)) continue;
          seenBases.add(base);
          if (env.ownBase?.(base)) {
            const baseNode = facts.get(`place:${base}`) ?? put(`unlocked-base:${base}`, { kind: 'location', subjectId: base, placeName: placeLabel(base),
              label: `Unlock ${placeLabel(base)}.`, rule: 'owned-chunk', evidenceClass: 'derived' });
            if (baseNode) deps.push(baseNode);
          } else if (env.access.bases?.has(base)) {
            deps.push(gap('partner-duo', `This location is on ${sharedMap}.`));
          } else {
            deps.push(gap('missing-evidence', `The picker couldn't prove ${placeLabel(base)} is unlocked.`));
          }
        } else if (env.ownLocation(name)) {
          deps.push(placeRef(name));
        } else if (env.access.areas?.has(name) || env.access.bases?.has(name)) {
          let fallback;
          const getFallback = () => fallback ??= gap('partner-duo', `This location is on ${sharedMap}.`);
          const first = facts.get(`place:${name}`) ?? getFallback();
          const areaChoice = put(`connects-endpoint:${task.id}:${name}`, { kind: 'requirement', field: 'Sections',
            label: `Reach ${placeLabel(name)}.`, rule: 'connects-sections', allOf: first ? [first] : [] });
          if (areaChoice) {
            choices.set(areaChoice, { count: 1, candidates: () => {
              const own = facts.get(`place:${name}`);
              if (own) return [{ subject: name, id: own }];
              const fb = getFallback();
              return fb ? [{ subject: 'fallback', id: fb }] : [];
            } });
            deps.push(areaChoice);
          }
        } else {
          deps.push(gap('missing-evidence', `The picker couldn't prove ${placeLabel(name)} is reachable.`));
        }
      }
      const sectionWitness = name => facts.get(`place:${name}`) ?? (/^\d+$/.test(name) && baseSections.get(name)?.length ? placeRef(name) : null);
      let sectionFallback;
      const getSectionFallback = () => sectionFallback ??= sections.some(name => !env.ownLocation(name))
        ? gap('partner-duo', `Found on ${sharedMap}.`)
        : gap('missing-evidence', "The picker couldn't capture a reachable connected section.");
      const reachableSections = () => {
        const own = sections.map(name => ({ subject: name, id: sectionWitness(name) })).filter(entry => entry.id);
        if (own.length) return own;
        const fb = getSectionFallback();
        return fb ? [{ subject: 'fallback', id: fb }] : [];
      };
      const initial = sections.map(name => ({ subject: name, id: sectionWitness(name) })).filter(entry => entry.id);
      const first = initial.length ? initial[0].id : getSectionFallback();
      const choice = put(`connects-sections:${task.id}`, { kind: 'requirement', field: 'Sections',
        label: `Reach ${sections.map(placeLabel).join(' or ')}.`, rule: 'connects-sections', allOf: first ? [first] : [] });
      if (choice) { choices.set(choice, { count: 1, candidates: reachableSections }); deps.push(choice); }
    }
    const unsupported = [];
    if (task.category === 'Slayer') unsupported.push('slayer-assignments');
    if (env.slayerGate?.(task)) unsupported.push('slayer-unlock');
    if (env.usefulGate?.(task)) unsupported.push('useful-unlock');
    if (['QuestPointsNeeded', 'KudosNeeded', 'CombatScoreNeeded', 'TotalLevelNeeded', 'TotalVirtualLevelNeeded'].some(key => task.record[key] !== undefined)) unsupported.push('points');
    if (task.record.RequirementAlternatives || task.record.PersonalQuestProgress || task.personalAlternatives.length || task.dialogueSupply || task.sourceLocations.length) unsupported.push('special-requirements');
    for (const kind of unsupported) deps.push(gap(kind, `The picker can't show this ${kind.replaceAll('-', ' ')} step yet.`));
    deps.push(put(`policy:${task.id}`, { kind: 'policy', label: 'The task passes the current membership, rule and source policies.', rule: 'effective-policy', f2p: state.rules?.['content.f2p'] ?? true, tags: task.tags, settings: Object.fromEntries(task.tags.map(tag => [tag, env.rules[tag] ?? null])), evidenceClass: 'policy' }));
    put(`task:${task.key}`, { kind: 'task', subjectId: task.id, category: task.category, taskLabel: clean(task.label), instruction: task.category === 'Quest' && task.record.Description ? clean(task.record.Description) : undefined, areaUnlock: !!task.record.UnlocksArea,
      preparationOnly: task.category === 'Nonskill' && /^Obtain /i.test(task.label) && task.requirements.length > 0 && task.requirements.every(requirement => requirement.field === 'Items') && !task.record.Output && !task.record.Reward,
      definitionRef: definitionRef(task), label: `${clean(task.label).replace(/[.!]$/, '')}.`, rule: 'task-requirements', evidenceClass: 'derived', allOf: deps });
  }
  function skillRef(skill, required, env) {
    if (required > env.levels[skill]) return gap('boosts', `The picker uses a boost for ${skill} ${required}.`);
    if (required <= env.passive[skill]) {
      const observation = env.observed[skill];
      if (observation?.level >= required) return put(`observed:${skill}:${required}`, { kind: 'skill', skill, required, label: `Your recorded ${skill} level is ${observation.level}.`, rule: 'observed-level', evidenceClass: 'personal', source: observation.source, fetchedAt: observation.fetchedAt });
      if (Number(env.controls.passiveLevels[skill] ?? 1) >= required) return put(`manual-level:${skill}:${required}`, { kind: 'skill', skill, required, label: `You set your ${skill} level to ${env.controls.passiveLevels[skill]}.`, rule: 'manual-level', evidenceClass: 'manual', allOf: [gap('manual-assumption', 'This level comes from a manual setting.')] });
      const completion = [...byKey.values()].find(value => value.category === skill && value.level >= required && completedTask(value));
      if (completion) return taskRef(completion.key);
      return gap('xp-contributors', `The picker uses potential XP rewards for ${skill} ${required}.`);
    }
    usedTraining.add(skill);
    if (skill === 'Combat') for (const combatSkill of combatSeedSkills) usedTraining.add(combatSkill);
    const seedId = get(`training:${skill}`, `The picker can't show the training seed for ${skill} yet.`);
    const method = nodes.get(seedId)?.methodLabel;
    return put(`skill:${skill}:${required}:${seedId}`, { kind: 'skill', skill, required,
      label: `The picker assumes you can train ${skill} to ${required} because ${method ? method + ' is reachable' : 'a training capability is enabled'}.`,
      rule: 'primary-training-capability', evidenceClass: 'planning-assumption', allOf: [seedId] });
  }
  const sourceRank = (source, env) => {
    if (source.kind === 'recorded') return 0;
    if (source.own === true) {
      if (['spawn', 'shop', 'object'].includes(source.kind)) return 1;
      if (source.kind === 'drop' && env.monsterGate?.(source.source)) return 3;
      return 2;
    }
    return 4;
  };
  const selectOrdinarySources = (name, env) => env.sources(name)
    .filter(source => source.processingMode !== 'multi')
    .sort((a, b) => sourceRank(a, env) - sourceRank(b, env) || JSON.stringify(a).localeCompare(JSON.stringify(b)))
    .slice(0, 8);
  const seedSourceRef = (name, source, env) => {
    const id = sourceRef(name, source);
    if (!id) return null;
    const gate = source.kind === 'drop' ? env.monsterGate?.(source.source) ?? null : null;
    if (!gate) return id;
    return put(`gated-source-seed:${name}:${JSON.stringify(source)}`, { kind: 'requirement', field: 'Items',
      label: `Obtain ${clean(name)} from ${clean(source.source)}.`, rule: 'gated-monster-drop',
      allOf: [id, gap(gate, `The picker can't show this ${gate.replaceAll('-', ' ')} step yet.`)] });
  };
  const ordinaryItemChoice = (scope, name, env) => {
    const sources = selectOrdinarySources(name, env);
    if (!sources.length) return null;
    const candidates = sources.map(source => ({ subject: sourceKey(name, source), id: seedSourceRef(name, source, env) })).filter(entry => entry.id);
    if (!candidates.length) return null;
    const key = `seed-item:${scope}:${name}`;
    const choice = put(key, { kind: 'requirement', field: 'Items', label: `Obtain ${clean(name)}.`, rule: 'selected-source', allOf: [candidates[0].id] });
    if (choice && !choices.has(choice)) choices.set(choice, { count: 1, candidates: () => cached(key, () => selectOrdinarySources(name, env)
      .map(source => ({ subject: sourceKey(name, source), id: seedSourceRef(name, source, env) })).filter(entry => entry.id)) });
    return choice;
  };
  const bestSourceRank = (name, env) => {
    const sources = selectOrdinarySources(name, env);
    return sources.length ? sourceRank(sources[0], env) : 99;
  };
  const monsterCandidates = (env, { allowWrap = true } = {}) => {
    const entries = [];
    for (const name of env.access.monsters) {
      const gate = env.monsterGate?.(name) ?? null;
      for (const place of env.access.locations.get(`Monster:${name}`) ?? []) {
        const entityId = facts.get(`entity:Monster:${name}:${place}`);
        if (!entityId) continue;
        entries.push({ name, place, gate, own: env.ownLocation(place), manual: place === 'Manually Added*', entityId });
      }
    }
    entries.sort((a, b) => Number(Boolean(a.gate)) - Number(Boolean(b.gate))
      || Number(b.own) - Number(a.own)
      || Number(a.manual) - Number(b.manual)
      || a.name.localeCompare(b.name)
      || a.place.localeCompare(b.place));
    const limited = entries.slice(0, 32);
    return limited.map(entry => {
      const subject = `Monster:${entry.name}:${entry.place}`;
      if (!entry.gate) return { subject, id: entry.entityId, gated: false };
      if (!allowWrap) return { subject, id: entry.entityId, gated: true };
      const wrapped = put(`gated-monster-seed:${entry.name}:${entry.place}`, { kind: 'placement', label: `Reach ${clean(entry.name)}.`,
        allOf: [entry.entityId, gap(entry.gate, `The picker can't show this ${entry.gate.replaceAll('-', ' ')} step yet.`)] });
      return wrapped ? { subject, id: wrapped, gated: true } : null;
    }).filter(Boolean);
  };
  const rangedGearCandidates = (startPassive, env) => {
    const code = definitions.codeItems ?? {};
    const ammoTools = code.ammoTools ?? {};
    const pairs = [];
    for (const ammo of Object.keys(ammoTools).sort()) {
      const ammoItems = ammo === 'No ammo' ? null : [...new Set(code.itemsPlus?.[ammo] ?? [ammo])]
        .filter(item => selectOrdinarySources(item, env).length > 0)
        .sort((a, b) => bestSourceRank(a, env) - bestSourceRank(b, env) || a.localeCompare(b));
      if (ammoItems && !ammoItems.length) continue;
      const weapons = Object.keys(ammoTools[ammo] ?? {}).filter(weapon => {
        const required = code.rangedItems?.[weapon] ?? definitions.equipment?.[weapon]?.requirements?.Ranged ?? 1;
        return required <= startPassive && selectOrdinarySources(weapon, env).length > 0;
      }).sort((a, b) => bestSourceRank(a, env) - bestSourceRank(b, env) || a.localeCompare(b));
      if (!weapons.length) continue;
      let ammoNode = null;
      if (ammoItems) {
        const ammoRefs = ammoItems.slice(0, 8).map(item => ({ subject: item, id: ordinaryItemChoice('ranged-ammo', item, env) })).filter(entry => entry.id);
        if (!ammoRefs.length) continue;
        const ammoKey = `ranged-ammo-choice:${ammo}`;
        ammoNode = put(ammoKey, { kind: 'requirement', field: 'Items', label: `Obtain ${clean(ammo)}.`, rule: 'selected-alternatives', allOf: [ammoRefs[0].id] });
        if (ammoNode && !choices.has(ammoNode)) choices.set(ammoNode, { count: 1, candidates: () => cached(ammoKey, () => [...new Set(code.itemsPlus?.[ammo] ?? [ammo])]
          .filter(item => selectOrdinarySources(item, env).length > 0)
          .sort((a, b) => bestSourceRank(a, env) - bestSourceRank(b, env) || a.localeCompare(b))
          .slice(0, 8)
          .map(item => ({ subject: item, id: ordinaryItemChoice('ranged-ammo', item, env) })).filter(entry => entry.id)) });
      }
      for (const weapon of weapons.slice(0, 12)) {
        const weaponNode = ordinaryItemChoice('ranged-weapon', weapon, env);
        if (!weaponNode) continue;
        const required = code.rangedItems?.[weapon] ?? definitions.equipment?.[weapon]?.requirements?.Ranged ?? 1;
        const reqRef = required > 1 ? skillRef('Ranged', required, env) : null;
        if (required > 1 && !reqRef) continue;
        const pairDeps = [weaponNode, ...(ammoNode ? [ammoNode] : []), ...(reqRef ? [reqRef] : [])];
        const pairId = put(`ranged-pair:${weapon}:${ammo}`, { kind: 'requirement', field: 'Items',
          label: ammoNode ? `Equip ${clean(weapon)} with ${clean(ammo)}.` : `Equip ${clean(weapon)}.`, rule: 'ranged-training-gear', allOf: pairDeps });
        if (pairId) pairs.push({ subject: `${weapon}\0${ammo}`, id: pairId });
      }
    }
    return pairs;
  };
  const prayerBoneCandidates = env => {
    const bones = definitions.codeItems?.boneItems;
    const list = Array.isArray(bones) ? bones : bones ? [bones] : [];
    const results = [];
    for (const item of [...new Set(list)].sort()) {
      const sources = selectOrdinarySources(item, env);
      for (const source of sources) {
        const id = seedSourceRef(item, source, env);
        if (id) results.push({ subject: sourceKey(item, source), id });
      }
    }
    return results;
  };
  function seed(skill, own, method, env, innate) {
    if (facts.has(`training:${skill}`)) return;
    const deps = [];
    if (!own && innate?.kind !== 'combat') deps.push(gap('partner-duo', `Trains ${skill} using ${sharedMap}.`));
    let methodLabel = method ? clean(method.label) : undefined;
    if (method) {
      deps.push(taskRef(method.key));
      if (method.level > env.passive[skill]) deps.push(gap('boosts', 'Starting this training method needs a boost.'));
      else if (method.level > 1) deps.push(skillRef(skill, method.level, env));
    } else if (innate?.kind === 'monster') {
      methodLabel = 'monster combat';
      const initial = monsterCandidates(env, { allowWrap: false });
      const choice = put(`innate-seed:${skill}`, { kind: 'requirement', field: 'Monsters', label: `Reach a monster to train ${skill}.`,
        rule: 'monster-training-seed', allOf: initial.length && !initial[0].gated ? [initial[0].id] : [] });
      if (choice) {
        choices.set(choice, { count: 1, candidates: () => usedTraining.has(skill) ? cached('innate:monsters', () => monsterCandidates(env)) : [] });
        deps.push(choice);
      }
      if (!initial.length) deps.push(gap('missing-evidence', `The picker couldn't capture a reachable monster for ${skill}.`));
    } else if (innate?.kind === 'ranged') {
      methodLabel = 'ranged combat';
      const startPassive = env.passive[skill];
      const initialMonsters = monsterCandidates(env, { allowWrap: false });
      const monsterChoice = put(`innate-seed:${skill}:monster`, { kind: 'requirement', field: 'Monsters', label: 'Reach a monster to train Ranged.',
        rule: 'monster-training-seed', allOf: initialMonsters.length && !initialMonsters[0].gated ? [initialMonsters[0].id] : [] });
      if (monsterChoice) {
        choices.set(monsterChoice, { count: 1, candidates: () => usedTraining.has(skill) ? cached('innate:monsters', () => monsterCandidates(env)) : [] });
        deps.push(monsterChoice);
      }
      if (!initialMonsters.length) deps.push(gap('missing-evidence', "The picker couldn't capture a reachable monster for Ranged."));
      const gearChoice = put(`innate-seed:${skill}:gear`, { kind: 'requirement', field: 'Items', label: 'Obtain a ranged weapon and ammunition.',
        rule: 'ranged-training-seed', allOf: [] });
      if (gearChoice) {
        choices.set(gearChoice, { count: 1, candidates: () => usedTraining.has(skill) ? cached(`innate:ranged:${startPassive}`, () => rangedGearCandidates(startPassive, env)) : [] });
        deps.push(gearChoice);
      }
    } else if (innate?.kind === 'prayer') {
      methodLabel = 'a bone or ash source';
      const boneChoice = put(`innate-seed:${skill}`, { kind: 'requirement', field: 'Items', label: 'Obtain bones or ashes to train Prayer.',
        rule: 'prayer-training-seed', allOf: [] });
      if (boneChoice) {
        choices.set(boneChoice, { count: 1, candidates: () => usedTraining.has(skill) ? cached('innate:prayer', () => prayerBoneCandidates(env)) : [] });
        deps.push(boneChoice);
      }
    } else if (innate?.kind === 'combat') {
      methodLabel = 'combat training';
      for (const combatSkill of innate.skills ?? []) combatSeedSkills.add(combatSkill);
      const combatSkills = [...(innate.skills ?? [])];
      const available = () => combatSkills.filter(name => facts.has(`training:${name}`)).map(name => ({ subject: name, id: facts.get(`training:${name}`) }));
      const initial = available();
      const choice = put(`innate-seed:${skill}`, { kind: 'requirement', field: 'Tasks', label: 'Train a combat skill.',
        rule: 'combat-training-seed', allOf: initial.length ? [initial[0].id] : [] });
      if (choice) {
        choices.set(choice, { count: 1, candidates: () => usedTraining.has(skill) ? available() : [] });
        deps.push(choice);
      }
      if (!initial.length) deps.push(gap('missing-evidence', "The picker couldn't capture a combat training seed."));
    } else deps.push(gap(env.controls.primaryOverrides[skill] ? 'manual-assumption' : 'unsupported-training-seed', `The picker can't show the ${skill} training seed yet.`));
    put(`training:${skill}`, { kind: 'training-method', skill, methodLabel, label: `Start ${skill} training${methodLabel ? ' with ' + methodLabel : ''} from level ${env.passive[skill]}.`,
      rule: 'primary-training-seed', evidenceClass: 'derived', startLevel: env.passive[skill], cap: env.caps[skill], allOf: deps });
  }
  function finish(taskId, result, context = {}) {
    const subject = result.tasks.find(task => task.id === taskId);
    const target = byId.get(taskId);
    const proof = { schemaVersion: HOW_SCHEMA, context: { memberId, stateRevision: state.revision, engineBase: HOW_ENGINE_BASE, mode: 'planning', ...context },
      subject: { kind: 'task', id: taskId }, availability: subject?.status ?? 'unsupported', proofStatus: 'complete', root: null, nodes: {}, assumptions: [], gaps: [], limits: { truncated: false, nodeCount: 0 } };
    const nodeLimit = Math.max(1, Math.min(512, limits.nodes ?? 512)), depthLimit = Math.max(1, Math.min(32, limits.depth ?? 32));
    const byteLimit = Math.max(1024, Math.min(65536, limits.bytes ?? 65536));
    // Positive costs propagate from independent roots. An OR cycle cannot lower
    // its own cost, so final-set alternatives never become circular evidence.
    const costs = new Map(), selected = new Map(); let rankingComplete = false;
    finishCache = new Map();
    try {
    for (let pass = 0; pass < 32 && performance.now() < deadline; pass++) {
      let changed = false;
      for (const [id, node] of nodes) {
        const choice = choices.get(id);
        const candidates = choice?.candidates().filter(value => Number.isFinite(costs.get(value.id)))
          .sort((a, b) => costs.get(a.id) - costs.get(b.id) || a.subject.localeCompare(b.subject));
        const hasEnough = candidates?.length >= choice?.count;
        const children = hasEnough ? candidates.slice(0, choice.count).map(value => value.id) : node.allOf;
        const childCosts = (!choice || hasEnough || children.length >= choice.count)
          ? children.map(child => costs.get(child) ?? Infinity) : [Infinity];
        const cost = childCosts.every(Number.isFinite)
          ? (node.kind === 'gap' || childCosts.some(cost => cost >= 1000000000) ? 1000000000 : 0) + Math.min(1000000, 1 + childCosts.reduce((sum, cost) => sum + cost % 1000000000, 0)) : Infinity;
        if (cost < (costs.get(id) ?? Infinity)) { costs.set(id, cost); selected.set(id, children); changed = true; }
      }
      if (!changed) { rankingComplete = true; break; }
    }
    } finally { finishCache = null; }
    const rebound = new Map(), rebuilding = new Set();
    const findApproach = (id, approaches, seen = new Set()) => {
      if (seen.has(id)) return; seen.add(id);
      const node = nodes.get(id);
      if (node?.field === 'Chunks') return approaches.find(place => node.selectedSubjects.some(subject => matchesApproach(subject, place)));
      if (node?.kind !== 'task' && node?.field !== 'Tasks') return;
      for (const child of node.allOf) { const place = findApproach(child, approaches, seen); if (place) return place; }
    };
    const findEntityApproach = (id, approaches, seen = new Set()) => {
      if (!id || seen.has(id)) return null; seen.add(id);
      const node = nodes.get(id);
      if (!node) return null;
      if (node.kind === 'placement' && ['NPC', 'Object'].includes(node.entityKind) && node.location
        && approaches.some(place => matchesApproach(node.location, place) || matchesApproach(place, node.location))) {
        return { from: node.location, viaEntity: clean(node.subjectId), viaKind: node.entityKind };
      }
      if (node.kind !== 'task' && !(node.kind === 'requirement' && ['NPCs', 'Objects', 'Mix', 'Placements', 'Tasks'].includes(node.field))) return null;
      for (const child of node.allOf) { const hit = findEntityApproach(child, approaches, seen); if (hit) return hit; }
      return null;
    };
    const rederive = (id, depth = 0) => {
      if (depth > 64) return id; // Export's stricter depth cap reports the gap.
      if (rebound.has(id)) return rebound.get(id);
      if (rebuilding.has(id)) return gap('cycle', 'A circular route has no independent starting evidence.');
      const node = nodes.get(id); if (!node) return id;
      rebuilding.add(id);
      let selectedChildren = selected.get(id) ?? node.allOf;
      if (choices.has(id) && selectedChildren.length < choices.get(id).count) {
        selectedChildren = [gap(exhausted ? 'budget' : 'missing-evidence', "The picker couldn't capture a witness for this step.")];
      }
      const children = selectedChildren.map(child => rederive(child, depth + 1));
      let label = node.label, from = node.from, viaEntity = node.viaEntity, viaKind = node.viaKind, rule = node.rule;
      const area = areaLocations.get(id);
      if (area) {
        const approaches = areaApproaches.get(area) ?? [];
        const permission = children.find(child => nodes.get(child)?.kind === 'task');
        const walkingFrom = findApproach(permission, approaches);
        if (walkingFrom) {
          from = walkingFrom; viaEntity = undefined; viaKind = undefined; rule = 'walking-entrance';
          label = `Get into ${placeLabel(area)} from ${placeLabel(from)}.`;
        } else {
          const entityFrom = findEntityApproach(permission, approaches);
          if (entityFrom) {
            ({ from, viaEntity, viaKind } = entityFrom);
            rule = 'entity-entrance';
            label = `Enter ${placeLabel(area)} via ${viaEntity} at ${placeLabel(from)}.`;
          } else if (node.viaEntity && node.from && approaches.some(place => matchesApproach(node.from, place) || matchesApproach(place, node.from))) {
            from = node.from; viaEntity = node.viaEntity; viaKind = node.viaKind; rule = 'entity-entrance';
            const placementId = entityEntrancePlacements.get(id);
            const placementRef = placementId && rederive(placementId, depth + 1);
            if (placementRef && !children.includes(placementRef)) children.unshift(placementRef);
            label = `Enter ${placeLabel(area)} via ${viaEntity} at ${placeLabel(from)}.`;
          } else if (node.from && approaches.includes(node.from)) {
            from = node.from; viaEntity = undefined; viaKind = undefined; rule = 'walking-entrance';
            const approachRef = rederive(placeRef(from), depth + 1);
            if (approachRef && !children.includes(approachRef)) children.unshift(approachRef);
            label = `Get into ${placeLabel(area)} from ${placeLabel(from)}.`;
          }
        }
      }
      const changed = label !== node.label || from !== node.from || rule !== node.rule || viaEntity !== node.viaEntity || children.some((child, index) => child !== node.allOf[index]) || children.length !== node.allOf.length;
      const selectedSubjects = choices.has(id) ? selectedChildren.map(child => choices.get(id).candidates().find(value => value.id === child)?.subject).filter(Boolean) : node.selectedSubjects;
      const next = { ...node, label, from, fromName: from && placeLabel(from), rule, ...(selectedSubjects ? { selectedSubjects } : {}), firstAdmissionOrder: node.firstAdmissionOrder ?? node.admissionOrder, allOf: children };
      if (viaEntity) { next.viaEntity = viaEntity; next.viaKind = viaKind; }
      else { delete next.viaEntity; delete next.viaKind; }
      const value = changed ? put(`rederived:${id}:${children.join(',')}`, next) : id;
      rebuilding.delete(id); rebound.set(id, value); return value;
    };
    let root = target && facts.get(`task:${target.key}`);
    // An area permission is not an itinerary. Explain the actual admitted entry
    // when present, including its approach, rather than the permission alone.
    if (subject?.status === 'available' && target?.record.UnlocksArea) {
      const entry = facts.get(`place:${target.rawLabel}`);
      root = entry ?? put(`area-goal:${target.id}`, { ...nodes.get(root), allOf: [root, gap('unbound-entrance', 'The area permission has no captured reachable entrance.')] });
    }
    const optimizedRoot = subject?.status === 'available' && target ? rederive(root) : null;
    const exported = new Map(), visiting = new Set();
    const encodedSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
    let wireBytes = encodedSize(proof) + 512; // Reserve the typed truncation gap and envelope updates.
    let budgetStopped = false;
    const exportGap = (kind, detail) => {
      if (kind === 'budget' && proof.gaps.some(gap => gap.kind === 'budget')) return proof.gaps.find(gap => gap.kind === 'budget').node;
      if (kind === 'budget') budgetStopped = true;
      const id = `g${proof.gaps.length}`; proof.nodes[id] = { kind: 'gap', gap: kind, label: detail, allOf: [] };
      proof.gaps.push({ node: id, kind, detail }); proof.proofStatus = 'partial'; return id;
    };
    const visit = (id, depth) => {
      if (visiting.has(id)) return exportGap('cycle', 'A circular route has no independent starting evidence.');
      if (exported.has(id)) return exported.get(id);
      const node = nodes.get(id);
      if (!node) return exportGap(exhausted ? 'budget' : 'missing-evidence', 'The picker can\'t show this step yet.');
      if (depth >= depthLimit || Object.keys(proof.nodes).length >= nodeLimit - 1) return exportGap('budget', 'The explanation reached its depth or node limit.');
      const output = { ...node, allOf: [] };
      const size = encodedSize(output) + id.length + 16 + node.allOf.length * 16;
      if (wireBytes + size > byteLimit) return exportGap('budget', 'Further steps exceeded the byte limit.');
      wireBytes += size; visiting.add(id); proof.nodes[id] = output;
      for (const child of node.allOf) {
        if (budgetStopped) { output.allOf.push(exportGap('budget', 'Further sibling steps were omitted after the budget gap.')); break; }
        if (Object.keys(proof.nodes).length >= nodeLimit - 1) { output.allOf.push(exportGap('budget', 'Further steps exceeded the node limit.')); break; }
        output.allOf.push(visit(child, depth + 1));
      }
      visiting.delete(id); exported.set(id, id);
      if (node.kind === 'gap') { proof.gaps.push({ node: id, kind: node.gap, detail: node.label }); proof.proofStatus = 'partial'; }
      if (node.evidenceClass === 'planning-assumption') proof.assumptions.push(id);
      return id;
    };
    proof.root = subject?.status === 'available' && target ? visit(optimizedRoot, 0)
      : exportGap(exhausted || performance.now() >= deadline ? 'budget' : target ? 'task-unavailable' : 'unsupported-subject', target ? 'This task is not available in the captured planning result.' : 'Generated or unknown tasks are not supported by How yet.');
    if (!rankingComplete && subject?.status === 'available') {
      const omitted = exportGap('budget', 'The alternative search reached its replay budget.');
      if (omitted !== proof.root && !proof.nodes[proof.root].allOf.includes(omitted)) proof.nodes[proof.root].allOf.push(omitted);
    }
    proof.limits.nodeCount = Object.keys(proof.nodes).length;
    proof.limits.truncated = proof.gaps.some(gap => gap.kind === 'budget');
    if (Object.keys(proof.nodes).length > nodeLimit || JSON.stringify(proof).length * 3 > byteLimit && new TextEncoder().encode(JSON.stringify(proof)).length > byteLimit) {
      // Preserve a bounded root rather than leaking dangling references after slicing JSON.
      proof.nodes = {}; proof.gaps = []; proof.assumptions = [];
      proof.root = exportGap('budget', 'The explanation exceeded its output limits.'); proof.limits = { truncated: true, nodeCount: 1 };
    }
    return proof;
  }
  return { task, seed, location, entity, clue, source, producedObject, finish, get, gap, expired: () => performance.now() >= deadline };
}
