import { requireSelectedDataset } from '../dataset-runtime.mjs';
import { decodeLegacyText, hasGameplayMigration, stableTaskId, projectMemberTaskFacts, resolveSavedTaskId } from './migration.mjs';
import { parseDropRate, composeDropRates, passesRateCutoff, rateEvidence } from './rates.mjs';
import { resolveTaskAlternatives } from '../core/task-alternatives.mjs';
import { entityId, generatedGoalId, legacyTaskId, permanentTaskId } from './identity.mjs';
import { applyCacheShops } from '../data/cache-shops.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
const enabled = (rules, key, fallback = false) => taskRuleEnabled(rules, key, fallback);
const clean = value => String(value).replaceAll('*', '');
const displaySource = value => String(value).replaceAll('[+]', '');
const keyOf = (category, label) => `${category}\u0000${label}`;
const rareTables = new Set(['RareDropTable+', 'GemDropTable+', 'GemDropTableLegends+', 'WildernessDropTable+']);
const text = label => label.replace(/~\|([^|]+)\|~/g, (_, name) => name.split('#')[0]);
const decoded = value => Object.fromEntries(entries(value).map(([key, item]) => [decodeLegacyText(key), item]));

/** Match the retained worker's reciprocal display, including comma grouping and
 * its two-decimal rounding. This string is display metadata, never identity.
 */
export function collectionRateLabel(probability, original = 'Unknown', roundedSeed = false) {
  if (!Number.isFinite(probability) || probability <= 0) return String(original);
  if (original === 'Always' && probability === 1) return 'Always';
  const rounded = Number((1 / probability).toFixed(2));
  const denominator = roundedSeed ? Math.floor(rounded) : rounded;
  return `1/${String(denominator).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1,')}`;
}
function multipliedQuantity(parent, child) {
  const number = /^(\d+)(.*)$/.exec(String(child));
  if (/^\d+$/.test(String(parent)) && number && !number[2].startsWith('-')) return `${Number(parent) * Number(number[1])}${number[2]}`;
  // Ranges and opaque quantities stay as authored, as in the reference worker.
  return String(child);
}
function identity(rawLabel, objectiveKind, sourceId, itemId) {
  return { id: generatedGoalId(objectiveKind, sourceId, ...(itemId ? [itemId] : [])), label: text(rawLabel), category: 'Extra',
    rawLabel, aliases: [legacyTaskId('Extra', rawLabel)], kind: 'collection', objectiveKind, sourceId, ...(itemId ? { itemId } : {}) };
}

/** Resolve personal task-rule precedence without reviving migrated legacy rules. */
export function collectionRules(state, memberId) {
  const member = state.members?.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const legacyMap = state.legacy?.maps?.[member.sourceMapId] ?? {};
  const rules = { ...(!hasGameplayMigration(state, member) ? decoded(legacyMap.rules) : {}), ...state.taskRules, ...member.taskRules };
  rules.F2P = state.rules?.['content.f2p'] ?? true;
  return rules;
}

/** Apply the retained Every Drop display grouping after ordinary presentation
 * filters. One active source is retained per exact item. The reference sorts raw
 * labels lexically; probability never ranks these alternatives. A saved exact
 * label/ID wins when present. An unavailable saved choice falls back with a
 * diagnostic, consistently with the ordinary skill-goal selector. This changes
 * presentation only, leaving the full eligibility catalogue and checks intact.
 */
export function selectCollectionGoals(presentation, state, memberId) {
  const savedMember = state.members?.find(value => value.id === memberId);
  if (!savedMember) throw new TypeError(`Unknown member: ${memberId}`);
  if (!Array.isArray(presentation?.tasks)) throw new TypeError('Collection selection needs presentation tasks');
  const member = projectMemberTaskFacts(state, savedMember, presentation.tasks);
  const choices = resolveTaskAlternatives(state, member);
  const groups = new Map(), retained = new Set(), alternatives = { ...presentation.alternatives }, suppressed = { ...presentation.suppressed };
  const diagnostics = [...(presentation.diagnostics ?? [])];
  for (const row of presentation.tasks) {
    if (row.record?.Label !== 'Every Drop' || typeof row.item !== 'string') { retained.add(row.id); continue; }
    const group = groups.get(row.item) ?? []; group.push(row); groups.set(row.item, group);
  }
  for (const [item, group] of groups) {
    const peers = group.slice().sort((a, b) => a.rawLabel < b.rawLabel ? -1 : a.rawLabel > b.rawLabel ? 1 : 0);
    const key = `Every Drop ${item}`;
    const savedGroups = choices.Extra ?? {};
    let savedChoice = savedGroups[key], conflicts;
    // A current authored choice, including explicit Automatic, is authoritative.
    // Older group labels follow the same canonical item through display edits.
    if (!Object.hasOwn(savedGroups, key)) {
      const itemId = peers[0].itemId ?? entityId('item', item);
      const candidates = Object.entries(savedGroups).filter(([name]) => name.startsWith('Every Drop ')
        && entityId('item', name.slice('Every Drop '.length)) === itemId);
      const targets = new Set(candidates.map(([, choice]) => typeof choice === 'string' ? resolveSavedTaskId(state.identityRegistry, choice, 'Extra') : choice));
      if (targets.size === 1) savedChoice = candidates[0][1];
      else if (targets.size > 1) conflicts = candidates.map(([name, choice]) => ({ group: name, choice }));
    }
    const preferred = typeof savedChoice === 'string' ? resolveSavedTaskId(state.identityRegistry, savedChoice, 'Extra') : savedChoice;
    const exact = peers.find(row => row.id === preferred || row.rawLabel === preferred || row.aliases?.includes(preferred)), chosen = exact ?? peers[0];
    if (conflicts) diagnostics.push({ kind: 'conflicting-collection-alternatives', item, preferences: conflicts, chosen: chosen.id,
      detail: 'Older saved choices disagree about the source for this item. The first reachable source in alphabetical order is shown; all saved choices are kept.' });
    if (preferred && !exact) diagnostics.push({ kind: 'unavailable-collection-alternative', item, preferred, chosen: chosen.id, detail: 'Saved Every Drop source is unavailable; the first alphabetical reachable alternative is shown.' });
    retained.add(chosen.id); alternatives[chosen.id] = peers.filter(row => row !== chosen).map(row => row.id);
    for (const row of peers) if (row !== chosen) suppressed[row.id] = [...(suppressed[row.id] ?? []), 'An alternative source for the same Every Drop item.'];
  }
  const tasks = presentation.tasks.filter(row => retained.has(row.id));
  return { ...presentation, tasks, alternatives, suppressed, diagnostics,
    metrics: { ...presentation.metrics, presentedCount: tasks.length, suppressedCount: Object.keys(suppressed).length } };
}

/** Compile potential collection IDs once. This catalogue is a derived lookup,
 * not a list to copy wholesale into persisted state.tasks. evaluate() consumes
 * the final task engine's reachable access/items/tasks/training result and does
 * not infer possession, grant game completion, unlock sources, or mutate input.
 * Return shape: {tasks, alternatives, completionGroups, diagnostics, coverage}; generated task rows
 * use ordinary Extra IDs and may be passed directly to presentation selection.
 * completionGroup indexes shared potential completion IDs. Family arrays are
 * sent once per result, never repeated across every alternative source row.
 */
export function createCollectionEngine(definitions, { dataset, cacheShops = dataset?.capabilities.cacheShops ?? false, shopCatalogue } = {}) {
  if (dataset) requireSelectedDataset(dataset);
  definitions = applyCacheShops(definitions, { enabled: cacheShops, shops: shopCatalogue });
  if (!definitions || typeof definitions !== 'object') throw new TypeError('Collection definitions are required');
  const tables = definitions.codeItems?.dropTables ?? {}, channels = [], catalogue = new Map(), families = new Map();
  // The authored entity registry is immutable. Each exact subject is resolved
  // once, rather than normalizing the same source/item for every objective.
  const entityIds = new Map();
  const collectionEntityId = (kind, name) => {
    let names = entityIds.get(kind);
    if (!names) { names = new Map(); entityIds.set(kind, names); }
    let id = names.get(name);
    if (id === undefined) { id = entityId(kind, name); names.set(name, id); }
    return id;
  };
  const monsters = new Set(Object.keys(definitions.drops ?? {})), duplicateAliases = new Map();
  const addCatalogue = (rawLabel, objectiveKind, sourceId, itemId) => {
    const row = identity(rawLabel, objectiveKind, sourceId, itemId), existing = catalogue.get(row.id);
    // Most potential IDs occur once. Duplicate variants retain their aliases
    // in insertion order and their last-authored display metadata.
    if (existing) {
      const alias = row.aliases[0];
      let seen = duplicateAliases.get(row.id);
      if (!seen) { seen = new Set(existing.aliases); duplicateAliases.set(row.id, seen); }
      if (!seen.has(alias)) { seen.add(alias); existing.aliases.push(alias); }
      row.aliases = existing.aliases;
    }
    catalogue.set(row.id, row);
    return row;
  };
  const sourceId = channel => collectionEntityId(channel.kind === 'drop' ? 'monster' : channel.kind === 'shop' || channel.kind === 'task-shop' ? 'shop' : 'output', channel.name);
  const goal = (rawLabel, objectiveKind, channel, item) => addCatalogue(rawLabel, objectiveKind, sourceId(channel), collectionEntityId('item', item));
  const kill = monster => addCatalogue(`Kill X ~|${monster}|~`, 'kill-x', collectionEntityId('monster', monster));
  const killId = monster => generatedGoalId('kill-x', collectionEntityId('monster', monster));
  const family = (name, id) => { if (!families.has(name)) families.set(name, new Set()); families.get(name).add(id); };

  function expand(table, source, diagnostics, category) {
    const drops = [];
    function visit(item, quantity, rate, chance, path = [], labelRate = rate, rawRate = rate) {
      const nested = definitions.skillItems?.[category]?.[item] ?? tables[item];
      if (nested) {
        if (path.includes(item)) { diagnostics.push({ kind: 'collection-drop-table-cycle', source, table: item, path }); return; }
        for (const [child, value] of entries(nested)) {
          const rows = typeof value === 'string' ? [[value.split('@')[1] ?? '1', value.split('@')[0]]] : entries(value);
          if (!rows.length) diagnostics.push({ kind: 'unsupported-collection-drop-record', source, table: item, item: child });
          for (const [childQuantity, childRate] of rows) {
            const combined = composeDropRates(chance, parseDropRate(childRate)), raw = `${rawRate} × ${childRate}`;
            visit(child, multipliedQuantity(quantity, childQuantity), childRate, combined, [...path, item], collectionRateLabel(combined, raw, item.includes('GeneralSeedDropTable')), raw);
          }
        }
        return;
      }
      if (/DropTable/.test(item)) { diagnostics.push({ kind: 'missing-collection-drop-table', source, table: item }); return; }
      const name = clean(item);
      if (!name || name.includes('^')) return;
      drops.push({ item: name, quantity: String(quantity || 'N/A'), rate: path.length ? String(labelRate) : collectionRateLabel(chance, rate), probability: chance, tables: path, ...rateEvidence(rawRate, chance) });
    }
    for (const [item, values] of entries(table)) {
      const rows = typeof values === 'string' ? [[values.split('@')[1] ?? '1', values.split('@')[0]]] : entries(values);
      for (const [quantity, rate] of rows) visit(item, quantity, rate, parseDropRate(rate));
    }
    return drops;
  }
  function addChannel(channel, table) {
    channel.diagnostics = [];
    channel.drops = expand(table, channel.name, channel.diagnostics, channel.category);
    for (const drop of channel.drops) {
      if (channel.every) {
        drop.everyRaw = `${channel.display}: ~|${drop.item}|~ (${drop.rate})`;
        drop.everyId = goal(drop.everyRaw, 'every-drop', channel, drop.item).id; family(`Every Drop\u0000${collectionEntityId('item', drop.item)}`, drop.everyId);
      }
      if (channel.all) {
        drop.allRaw = `${channel.display}: ~|${drop.item}|~ (${drop.quantity}) (${drop.rate})`;
        drop.allId = goal(drop.allRaw, 'all-droptables', channel, drop.item).id; family(drop.allId, drop.allId);
      }
    }
    channels.push(channel);
  }
  for (const [name, table] of entries(definitions.drops)) addChannel({ kind: 'drop', name, display: displaySource(name), every: true, all: true }, table);
  for (const node of Object.values(definitions.chunks ?? {})) {
    for (const record of [node, ...Object.values(node.Sections ?? {})]) for (const name of Object.keys(record.Monster ?? {})) monsters.add(name);
  }
  for (const values of Object.values(definitions.codeItems?.monstersPlus ?? {})) for (const name of list(values)) if (typeof name === 'string') monsters.add(name);
  for (const name of monsters) kill(name);
  for (const [category, tasks] of entries(definitions.challenges)) for (const [rawLabel, record] of entries(tasks)) {
    if (category === 'Nonskill' && /^Bird nest \(.+\) loot$/.test(rawLabel) && definitions.skillItems?.Nonskill?.[rawLabel]) {
      const name = rawLabel.slice(0, -5);
      addChannel({ kind: 'nest', name, display: displaySource(name), taskId: permanentTaskId(category, rawLabel, record), rawLabel, category, record, every: false, all: true, nest: true }, definitions.skillItems.Nonskill[rawLabel]);
    }
    for (const output of list(record.Output)) {
      const table = definitions.skillItems?.[category]?.[output] ?? tables[output];
      const taskId = permanentTaskId(category, rawLabel, record);
      if (record.Source === 'shop') {
        const shop = /~\|([^|]+)\|~/.exec(rawLabel)?.[1];
        if (shop) {
          const items = table ? Object.keys(table) : [output];
          for (const item of items) if (typeof item === 'string' && !item.includes('^^')) {
            const name = clean(item), raw = `${shop}: ~|${name}|~`;
            const row = goal(raw, 'all-shops', { kind: 'task-shop', name: shop }, name);
            channels.push({ kind: 'task-shop', taskId, rawLabel, category, record, name: shop, item: name, raw, id: row.id });
          }
        }
      }
      if (!table) continue;
      let every = false, all = false, subrule, name = output, display = displaySource(output), nest = false;
      if (category === 'Slayer' && rawLabel.includes('Slay ')) { every = true; all = true; }
      if (category === 'Thieving') { every = !record['Hide drops']; all = true; subrule = 'Every Drop Thieving'; display = `[Thieving] ${display}`; }
      if (category === 'Hunter') {
        name = output.replaceAll(' jar', ''); display = displaySource(name);
        if (rawLabel.includes('impling')) { every = true; all = true; subrule = 'Every Drop Implings'; }
        else if (rawLabel.includes('Big Game Hunter')) { every = true; subrule = 'Every Drop BGH'; }
        else if (/bakami|orokami/.test(rawLabel)) all = true;
      }
      if (category === 'Nonskill' && /^Bird nest \(.+\) loot$/.test(rawLabel) && !definitions.skillItems?.Nonskill?.[rawLabel]) { all = true; nest = true; name = rawLabel.slice(0, -5); display = displaySource(name); }
      if (every || all) addChannel({ kind: 'task', name, display, taskId, rawLabel, category, record, every, all, subrule, nest }, table);
    }
  }
  for (const [shop, stock] of entries(definitions.shopItems)) for (const [item, value] of entries(stock)) if (value !== false && !item.includes('^^')) {
    const name = clean(item), raw = `${shop}: ~|${name}|~`, row = goal(raw, 'all-shops', { kind: 'shop', name: shop }, name);
    channels.push({ kind: 'shop', name: shop, item: name, raw, id: row.id });
  }
  for (const selector of Object.keys(definitions.taskUnlocks?.Shops ?? {})) {
    const split = selector.indexOf('^'); if (split < 1) continue;
    const shop = selector.slice(0, split), item = selector.slice(split + 1); if (!item || item.includes('^^')) continue;
    const name = clean(item), raw = `${shop}: ~|${name}|~`, row = goal(raw, 'all-shops', { kind: 'shop', name: shop }, name);
    channels.push({ kind: 'shop', name: shop, item: name, raw, id: row.id });
  }
  duplicateAliases.clear();
  const completionGroups = new Map([...families].map(([name, ids]) => [name, Object.freeze([...ids])]));
  const completionById = new Map();
  for (const ids of completionGroups.values()) for (const id of ids) completionById.set(id, ids);
  // Keep potential family membership available before any evaluated view has
  // been cached. Saved completion commands use this authoritative catalogue.
  const catalogueRows = Object.freeze([...catalogue.values()].map(row => {
    if (completionById.has(row.id)) row.completionIds = completionById.get(row.id);
    return Object.freeze(row);
  }));

  function evaluate(state, memberId, result, { obligationQueries = [] } = {}) {
    const facts = new Map(state.members.map(owner => [owner.id, projectMemberTaskFacts(state, owner, catalogueRows)]));
    const member = facts.get(memberId);
    if (!member) throw new TypeError(`Unknown member: ${memberId}`);
    if (!result?.access || !Array.isArray(result.items) || !Array.isArray(result.tasks)) throw new TypeError('Collection evaluation needs a final task engine result');
    const rules = collectionRules(state, memberId), diagnostics = [], generated = new Map(), alternatives = {}, usedCompletionGroups = {};
    const items = new Map(result.items.map(item => [item.name, item]));
    const access = result.obligationAccess ?? result.access, reachableMonsters = new Set(access.monsters ?? []);
    const ownTasks = new Set(result.tasks.filter(task => task.obligation !== false).map(task => task.id)), queryIds = new Set(obligationQueries), obligationIds = new Set();
    const retainOwn = id => { if (queryIds.has(id)) obligationIds.add(id); };
    if (queryIds.size) {
      for (const name of reachableMonsters) retainOwn(killId(name));
      for (const channel of channels) {
        const own = channel.kind === 'drop' ? reachableMonsters.has(channel.name) : channel.kind === 'shop' ? access.shops?.includes(channel.name) : ownTasks.has(channel.taskId);
        if (own) { retainOwn(channel.id); for (const drop of channel.drops ?? []) { retainOwn(drop.everyId); retainOwn(drop.allId); } }
      }
    }
    const availableTasks = new Set(result.tasks.filter(task => task.status === 'available' && task.obligation !== false).map(task => task.id));
    const backlogged = access.backloggedSources ?? {};
    const f2p = rules.F2P;
    const sourceBlocked = channel => !!backlogged[channel.kind === 'drop' ? 'monsters' : channel.kind === 'shop' || channel.kind === 'task-shop' ? 'shops' : channel.category === 'Hunter' ? 'npcs' : 'items']?.[channel.name];
    const proof = (channel, item) => (channel.kind === 'nest' ? list(items.get(channel.name)?.sources) : list(items.get(item)?.sources).filter(source => channel.kind === 'drop'
      ? source.kind === 'drop' && source.source === channel.name
      : channel.kind === 'shop' ? source.kind === 'shop' && source.source === channel.name
        : source.kind === 'task' && source.taskId === channel.taskId)).filter(source => source.own !== false);
    const legacyFlags = new Map(state.members.map(owner => {
      const flags = { challengeCompleted: new Set(), backlogged: new Set() };
      if (!hasGameplayMigration(state, owner)) {
        const legacy = state.legacy?.maps?.[owner.sourceMapId]?.chunkinfo ?? {};
        for (const field of ['completedChallenges', 'checkedAllTasks', 'checkedChallenges', 'backlog']) {
          for (const label of Object.keys(decoded(decoded(legacy[field]).Extra))) flags[field === 'backlog' ? 'backlogged' : 'challengeCompleted'].add(label.normalize('NFC'));
        }
      }
      return [owner.id, flags];
    }));
    const legacyFlag = (owner, id, field) => catalogue.get(id)?.aliases.some(alias => legacyFlags.get(owner.id)[field].has(decodeURIComponent(alias.slice('rs3:Extra:'.length)))) ?? false;
    const completed = new Map([...facts].map(([id, owner]) => [id, new Set(owner.completedTasks ?? [])]));
    const evidence = (owner, ids) => ids.some(id => completed.get(owner.id).has(id) || (Object.hasOwn(facts.get(owner.id).taskStatus?.[id] ?? {}, 'challengeCompleted')
      ? facts.get(owner.id).taskStatus[id].challengeCompleted === true : legacyFlag(owner, id, 'challengeCompleted')));
    const scope = state.rules?.['tasks.completion'] ?? 'any';
    const owners = scope === 'personal' ? [member] : state.members;
    const satisfaction = new Map();
    function emit(raw, id, rule, sources, extra = {}, familyName) {
      const { completionIds, ...catalogueRow } = catalogue.get(id);
      const row = { ...catalogueRow, rawLabel: raw, label: text(raw) }, ids = familyName ? completionGroups.get(familyName) ?? [row.id] : [row.id];
      const isBacklogged = Object.hasOwn(member.taskStatus?.[row.id] ?? {}, 'backlogged') ? member.taskStatus[row.id].backlogged : legacyFlag(member, row.id, 'backlogged');
      const blockers = isBacklogged ? [{ kind: 'backlog', detail: 'This task is backlogged by the current member.' }] : [];
      const completionKey = familyName ?? row.id;
      usedCompletionGroups[completionKey] = ids;
      if (!satisfaction.has(completionKey)) satisfaction.set(completionKey, state.members.filter(owner => evidence(owner, ids)).map(owner => owner.id));
      const satisfiedBy = satisfaction.get(completionKey);
      const satisfied = scope === 'all' ? owners.every(owner => satisfiedBy.includes(owner.id)) : owners.some(owner => satisfiedBy.includes(owner.id));
      const previous = generated.get(row.id);
      const uniqueSources = [...new Map([...(previous?.sources ?? []), ...sources].map(source => [JSON.stringify(source), source])).values()];
      const variants = extra.quantity === undefined ? undefined : [...(previous?.variants ?? []), { quantity: extra.quantity, rate: extra.rate, rawLabel: raw }];
      generated.set(row.id, { ...row, rawLabel: raw, ...extra, ...(variants ? { variants } : {}), generated: true, level: 1, primary: false, status: blockers.length ? 'blocked' : 'available', blockers,
        sources: uniqueSources, personalCompleted: completed.get(member.id).has(row.id), challengeSatisfied: satisfied, completionGroup: completionKey, satisfiedBy,
        hidden: false, hiddenReasons: [], wiki: `https://runescape.wiki/w/${encodeURIComponent((extra.item ?? extra.monster ?? '').replaceAll('#', '/'))}`, explanation: blockers.length ? blockers[0].detail : 'The listed collection source is reachable. Tick the task when you finish collecting it.',
        record: { Category: [rule], Label: rule, Permanent: false, ...(extra.item ? { Items: [extra.item], ItemsDetails: [extra.item] } : {}) } });
    }
    if (enabled(rules, 'Kill X')) {
      const amount = Number(rules['Kill X Amount'] ?? 1);
      if (!Number.isSafeInteger(amount) || amount < 1) diagnostics.push({ kind: 'invalid-collection-rule', rule: 'Kill X Amount', detail: 'Kill amount must be a positive safe integer.' });
      else for (const monster of [...reachableMonsters].sort()) {
        if (backlogged.monsters?.[monster] || enabled(rules, 'Skiller')) continue;
        if (!enabled(rules, 'Kill X Boss') && Object.hasOwn(definitions.codeItems?.bossMonsters ?? {}, monster)) continue;
        const requirement = definitions.slayerMonsters?.[monster], slayer = result.training?.Slayer ?? {};
        let boost = 0;
        if (enabled(rules, 'Boosting')) for (const [token, value] of entries(definitions.codeItems?.boostItems?.Slayer)) {
          if (definitions.codeItems?.boostTaskBans?.Slayer?.[`Kill X ~|${monster}|~`]?.includes(token)) continue;
          const [name, field = 'items'] = token.split('~');
          if (!(field === 'items' ? items.has(name) : list(access[field]).includes(name))) continue;
          if (typeof value === 'number') boost = Math.max(boost, value);
          else if (/^\d+(?:\.\d+)?%\+\d+$/.test(String(value))) { const [percent, flat] = String(value).split('%+').map(Number); boost = Math.max(boost, Math.floor(Number(slayer.level ?? slayer.passiveLevel ?? 1) * percent / 100 + flat)); }
          else diagnostics.push({ kind: 'unsupported-collection-boost', source: name });
        }
        if (requirement !== undefined && !((slayer.primary && Number(slayer.level) + boost >= requirement) || Number(slayer.passiveLevel ?? 1) + boost >= requirement)) continue;
        const raw = `Kill X ~|${monster}|~`;
        emit(raw, killId(monster), 'Kill X', [{ kind: 'monster', name: monster }], { label: `Kill ${amount} ${text(`~|${monster}|~`)}`, monster, amount });
      }
    }
    for (const channel of channels) {
      if (sourceBlocked(channel)) continue;
      if (channel.taskId && (!availableTasks.has(channel.taskId) || f2p && channel.record['Not F2P'])) continue;
      if (channel.kind === 'shop' || channel.kind === 'task-shop') {
        if (!enabled(rules, 'All Shops') || backlogged.items?.[channel.item]) continue;
        const sources = proof(channel, channel.item); if (sources.length) emit(channel.raw, channel.id, 'All Shops', sources, { item: channel.item, collectionSource: channel.name });
        continue;
      }
      if (channel.kind === 'drop' && (!reachableMonsters.has(channel.name) || enabled(rules, 'Skiller'))) continue;
      if (channel.kind === 'drop' && !enabled(rules, 'Boss', true) && Object.hasOwn(definitions.codeItems?.bossMonsters ?? {}, channel.name)) continue;
      const every = enabled(rules, 'Every Drop') && channel.every && (!channel.subrule || enabled(rules, channel.subrule));
      const all = channel.all && (channel.nest ? enabled(rules, 'All Droptables Nest') : enabled(rules, 'All Droptables'));
      if (!every && !all) continue;
      diagnostics.push(...channel.diagnostics);
      const everyRows = new Map();
      for (const drop of channel.drops) {
        if (backlogged.items?.[drop.item] || drop.tables.some(table => rareTables.has(table) && !enabled(rules, 'RDT'))) continue;
        if (drop.tables.includes('GemDropTableLegends+') && !availableTasks.has(stableTaskId('Quest', "~|Legends' Quest|~ Complete the quest"))) continue;
        if (!channel.nest && !enabled(rules, 'Rare Drop', true) && !passesRateCutoff(drop.probability, rules)) continue;
        const sources = proof(channel, drop.item); if (!sources.length) continue;
        if (every) everyRows.set(drop.item, { drop, sources }); // Reference rate map keeps the last eligible quantity.
        if (all) emit(drop.allRaw, drop.allId, 'All Droptables', sources, { item: drop.item, quantity: drop.quantity, rate: drop.rate, collectionSource: channel.display }, drop.allId);
      }
      for (const [item, { drop, sources }] of everyRows) emit(drop.everyRaw, drop.everyId, 'Every Drop', sources, { item, rate: drop.rate, collectionSource: channel.display }, `Every Drop\u0000${collectionEntityId('item', item)}`);
    }
    const tasks = [...generated.values()].sort((a, b) => a.rawLabel.localeCompare(b.rawLabel));
    const everyGroups = new Map();
    for (const row of tasks) if (row.record.Label === 'Every Drop') { const peers = everyGroups.get(row.item) ?? []; peers.push(row.id); everyGroups.set(row.item, peers); }
    // Presentation adds the chosen source's alternatives. Keep just the default
    // representative here instead of repeating every pair (quadratic payload).
    for (const ids of everyGroups.values()) {
      alternatives[ids[0]] = ids.slice(1);
    }
    return { tasks, obligationIds: [...obligationIds], alternatives, completionGroups: usedCompletionGroups, diagnostics, coverage: { generators: ['Kill X', 'Every Drop', 'All Droptables', 'All Shops'], limitations: ['A collection tick does not record that you still own the item or completed an in-game achievement.', 'Unclear drop rates are kept as recorded. Missing tables or tables that refer back to themselves are excluded.'] } };
  }
  return Object.freeze({ catalogue: catalogueRows, evaluate });
}
