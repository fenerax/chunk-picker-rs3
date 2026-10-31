import { progressBelongsToMember } from '../core/game-progress.mjs';
import { createMiningSettings, miningPickaxeLabel } from './mining-settings.mjs';
import { createWoodcuttingSettings } from './woodcutting-settings.mjs';
import { createBankingSettings } from './banking-settings.mjs';
import { renderBankingComparison } from './banking-display.mjs';
import { fishingRateText, fishingSpotAssumption, fishingExclusions, fishingSupplyLabel, fishingChanceNotes } from './fishing-display.mjs';

// The shell mounts this only while the planner is open.
// getResult reads an existing task result; it must not start a task calculation.
const positive = value => Number.isFinite(value) && value > 0;
const number = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'unknown';
const whole = value => Number.isFinite(value) ? Math.round(value).toLocaleString() : 'unknown';
const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, '$1')
  .replace(/\b(engines?|eligible|eligibility|obligations?|derived|unresolved|components?)\b/gi, word => {
    const term = word.toLowerCase();
    return term.startsWith('engine') ? 'planner' : term.startsWith('eligib') ? 'usable' : term.startsWith('obligation') ? 'task' : term.startsWith('component') ? 'area' : term === 'derived' ? 'estimated' : 'unknown';
  });
const nonEconomic = value => !/grand exchange|\bGE\b|\bGP\b|price|profit|opportunity.cost/i.test(value);
const duration = hours => Number.isFinite(hours) ? hours === 0 ? '0 minutes' : hours < 1 ? `${number(hours * 60)} minutes` : `${number(hours)} hours` : 'Time unknown';
const syncedDate = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'date unavailable';
};

function rateNote(value) {
  const note = String(value);
  if (note.startsWith('Hourly processing estimate')) return 'The speed estimate assumes you spend 80% of the time training, allowing the rest for banking, menus and repairs. Gathering supplies and travel add extra time.';
  if (note.startsWith('Only after the ordinary-range burn-free threshold')) return 'This speed estimate applies once the food stops burning on an ordinary range. It assumes 80% of the time is spent cooking, allowing the rest for banking and menus. Gathering raw fish adds extra time.';
  if (note.startsWith('Uses the sourced solo bonfire')) return 'Uses solo bonfire XP and feeding speed. Extra XP from your level, other players and fire spirits is excluded.';
  if (note.startsWith('F2P spell recipe2ticks')) return 'Each enchantment gives 17.5 base Magic XP and takes 1.2 seconds. The speed estimate assumes 80% of the time is spent casting, allowing the rest for banking and menus. Cosmic and water runes are consumed without rune-saving equipment. Getting supplies adds extra time.';
  if (note.startsWith('Current spell interval')) {
    const high = note.includes('65XP');
    return `Each cast gives ${high ? '65' : '31'} base Magic XP and takes ${high ? '3' : '1.8'} seconds. The speed estimate assumes 80% of the time is spent casting, allowing the rest for banking and menus. It uses ${high ? '5' : '3'} fire runes and 1 nature rune per cast; a fire staff is not assumed. Getting runes and alchemy items adds extra time.`;
  }
  if (note.startsWith('Uses current recipe XP per one-log action')) return 'One log is used per action, which takes three game ticks. You need a reachable knife source. Time spent in menus is extra.';
  if (note.startsWith('Adds an explicitly assumed 2 seconds')) return 'The estimate adds 2 seconds per log for handling and banking. You still need to gather the logs.';
  if (note.startsWith('The low-level guide rate')) return 'The same guide speed is used at higher levels because a reliable level-by-level rate is unavailable.';
  if (note.startsWith('Zero supplied stock:')) return note.includes('setup/interface') ? 'Gather every log you use. Setting up and time spent in menus add extra time.' : 'Gather every log you use; existing bank supplies are not assumed.';
  if (note.startsWith('Uses the sourced F2P guide context')) return 'The guide assumes the best hatchet for your level. Your available hatchet, tree spacing, depletion and attention can change the speed.';
  if (note.startsWith('The sourced XP per log is retained')) return 'XP per log is known, but the time needed to light and gather the logs is unknown.';
  if (note.startsWith('Line-fire XP is sourced')) return 'XP from lighting logs is known. Lighting failures, movement and the time per log are unknown. High-level bonfire bonuses are excluded.';
  if (note.startsWith('Monster page XP overrides')) return 'XP per kill comes from the current monster page. Your kill speed depends on gear, food, ammunition and runes, so XP/hour is unknown.';
  if (note.startsWith('F2P trial cap 5. Failure/stun')) return 'F2P training stops at level 5. Failures, stuns and healing change your speed; a reliable hourly rate is unavailable.';
  if (note.startsWith('Catches are retained and valued')) return 'Keep the fish you catch. Rates for dropping fish do not apply to this method. Catching, travel and banking time are unknown; existing bank supplies are not assumed.';
  if (note.startsWith('Power-fishing guide hourly profile')) return 'The quoted fishing speed requires dropping every catch, so you keep no fish for cooking or banking. Your gear and attention can change the speed.';
  if (note.startsWith('Current July 2026 Construction')) return 'Uses the current furniture recipe rather than the old build-and-remove method. You need a reachable furniture workbench and access to your house/tutorial. Uses steel nails. F2P training stops at level 20; hourly speed is unknown.';
  if (note.startsWith('Guide consumes2436essence')) return "The guide uses 2,436 essence/hour with 28-slot presets, a charged skull sceptre and War's Retreat Teleport. The estimate is 12,180 base XP/hour, excluding ring and Savvy bonuses. Both teleports and the sceptre charges must be confirmed on your account. Recharging and gathering essence add extra time.";
  if (note.startsWith('F2P guide lower edge for30seconds')) return "The guide assumes 30 seconds per inventory and includes Savvy XP at the relevant levels, excluding urns. It requires a charged skull sceptre and War's Retreat Teleport on your account. XP and rune output per action change with your level. Gathering essence and recharging add extra time.";
  if (note.startsWith('F2P Smithing guide gives1200')) return 'Uses 1,200 bars/hour from a guide range of 1,200–1,400, including banking and restarting. Each bar gives 1 base XP. Faster smelting bonuses and extra bars are excluded. Gathering ore adds extra time.';
  if (note.startsWith('F2P guide1200–1400 bars')) return 'Uses 1,200 bars/hour from a guide range of 1,200–1,400, including banking and restarting. Level bonuses, extra bars and urns are excluded. Gathering ore adds extra time. Iron bars use two iron ores each.';
  if (note.startsWith('F2P Prayer guide1118')) return 'The guide estimates 1,118 incense sticks/hour, with 13 sticks per roughly 42-second inventory. XP shown is Prayer only; the recipe also gives Firemaking XP. Cutting logs into sticks and gathering ashes add extra time.';
  if (note.startsWith('Requires Necromancy! tutorial')) return 'Complete the Necromancy! tutorial and prepare 1 Elemental I glyph, 2 Reagent I glyphs and 4 lights. Ink averages 3.5 per ritual. Each ritual gives 200 base XP before disturbances. Candle use, setup, repairs and getting supplies add unknown time. F2P training stops at level 20.';
  return plain(note).replace(/\bModelled\b/gi, 'Estimated').replace(/\bmodel(?:led|s)?\b/gi, 'estimate')
    .replace(/\bauthored\s+/gi, '').replace(/\bbaseline\b/gi, 'starting rate')
    .replace(/\bthroughput\b/gi, 'training speed').replace(/\beffective\s+/gi, '')
    .replace(/\bsourced\s+/gi, '').replace(/\bcurated\b/gi, 'checked')
    .replace(/\bextrapolated\b/gi, 'converted').replace(/\binput acquisition\b/gi, 'getting supplies')
    .replace(/\bmaterial acquisition\b/gi, 'getting supplies').replace(/\bamortised\b/gi, 'averaged')
    .replace(/\boutput multiplicity\b/gi, 'runes produced per action').replace(/\bremain null\b/gi, 'are unknown');
}

function observedProgress(member, skill) {
  const value = member.skillProgress?.[skill];
  return progressBelongsToMember(value, member)
    && Number.isInteger(value.level) && value.level >= 1 && value.level <= 120 && Number.isFinite(value.xp) && value.xp >= 0 ? value : null;
}

export function trainingTargets(result, skill, cap, startingLevel = 0, member) {
  if (member && result?.memberId && result.memberId !== member.id) return [];
  const active = result?.presentation?.tasks ?? (result?.tasks ?? []).filter(task => task.selected);
  const goals = result?.activityInfo?.skills?.find(row => row.skill === skill)?.selectedGoals ?? [];
  const fullTasks = new Map((result?.tasks ?? []).map(task => [task.id, task]));
  const completed = new Set([...(member?.completedTasks ?? []), ...(result?.presentation?.completedTasks ?? []).map(task => task.id),
    ...Object.entries(member?.taskStatus ?? {}).filter(([, value]) => value?.challengeCompleted === true).map(([id]) => id)].filter(Boolean));
  const targets = new Map();
  for (const selected of [...active, ...goals]) {
    const task = selected.id && fullTasks.has(selected.id) ? { ...fullTasks.get(selected.id), ...selected } : selected;
    const family = [task.id, ...(task.aliases ?? []), ...(task.completionIds ?? []), ...(result?.collectionPlanning?.completionGroups?.[task.completionGroup] ?? [])];
    if (task.personalCompleted || task.challengeSatisfied || task.obligation === false || task.hidden || task.status !== 'available' || family.some(id => completed.has(id))) continue;
    const required = ['Skills', 'Requirements', 'SkillsNeeded', 'SkillReqs'].map(field => Number(task.record?.[field]?.[skill]) || 0);
    const categoryLevel = task.category === skill && (!task.record?.RequirementAlternatives || Number(task.level ?? task.record.Level ?? 1) > 1) ? Number(task.level ?? task.record?.Level) || 0 : 0;
    const level = Math.max(...required, Number(task.SkillReqs?.[skill]) || 0, Number(task.skillRequirements?.[skill]) || 0, categoryLevel);
    if (!Number.isInteger(level) || level <= startingLevel || level > cap) continue;
    const labels = targets.get(level) ?? new Set(); labels.add(plain(task.label)); targets.set(level, labels);
  }
  return [...targets].sort(([a], [b]) => a - b).map(([level, labels]) => ({ level, labels: [...labels] }));
}

export function trainingActionsPerHour(method, xpPerHour) {
  // Recipe intervals alone are not an observed hourly rate.
  return positive(method?.xpPerAction) && positive(xpPerHour) ? xpPerHour / method.xpPerAction : null;
}

export function nextBetterTrainingMethod(plan, catalogue) {
  const currentRate = Math.max(0, ...(plan.availableMethods ?? []).filter(method => method.eligibleNow).map(method => method.xpPerHour ?? 0));
  const cap = catalogue.skills.find(row => row.skill === plan.skill)?.f2pCap ?? plan.cap;
  return (plan.lockedMethods ?? []).filter(method => {
    const record = catalogue.methods.find(row => row.id === method.methodId);
    return record?.members === false && method.level <= cap && (method.maxLevel ?? cap) >= plan.fromLevel
      && positive(method.xpPerHour) && method.xpPerHour > currentRate && !(method.blockers ?? []).some(blocker => blocker.kind === 'membership');
  }).sort((a, b) => Math.max(plan.fromLevel, a.level) - Math.max(plan.fromLevel, b.level) || b.xpPerHour - a.xpPerHour)[0] ?? null;
}

function selectorText(name) { return plain(name).replace(/\[\+\](\d+)/g, ' alternatives ($1)').replace(/\[\+\]/g, ' type'); }
function blockerText(blocker) {
  const name = selectorText(blocker.name);
  if (blocker.kind === 'alternatives') return `One of: ${(blocker.alternatives ?? []).map(blockerText).join('; ')}`;
  if (blocker.kind === 'skill') return `${name} level ${blocker.level ?? '?'} on your account`;
  if (blocker.kind === 'quest') return `Complete ${name} on your account`;
  if (blocker.kind === 'task') return `Complete ${name} on your account`;
  if (blocker.kind === 'chunk') return `Reach ${name} and return through unlocked chunks`;
  if (blocker.kind === 'item') return `Obtain ${name} within your reachable chunks`;
  if (blocker.kind === 'unsupported-selector') return `Personal unlock or source for ${name || 'this requirement'} has not been confirmed`;
  if (blocker.kind === 'membership') return 'Requires membership';
  return `Reach ${name || 'the required training location'}`;
}

/** api(path, undefined, signal) is the shell's authenticated GET helper.
 * Returns dispose(): abort pending reads and reject late responses.
 * dispose.getDraft() returns temporary controls; refreshResult() refreshes
 * task targets without resetting controls, plans or pending requests.
 * Manual levels are temporary request inputs. Mining estimate choices are
 * personal preferences saved through the shell's validated command.
 */
export function renderTraining(host, { document = globalThis.document, api, member, command, canWrite = () => false, getPreferences = () => member.preferences ?? {}, getResult = () => null, isCurrent = () => true, target: initialTarget, stateRevision, draft, advanced = false }) {
  let disposed = false, generation = 0, catalogue = null, controller = null, miningSaving = false, woodcuttingSaving = false, bankingSaving = false;
  const listeners = [];
  const current = token => !disposed && isCurrent() && token === generation;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = plain(text); if (className) node.className = className; return node; };
  const listen = (node, event, callback) => { node.addEventListener(event, callback); listeners.push([node, event, callback]); };
  const field = (label, control) => { const node = el('label', undefined, 'helper-training-field'); node.append(el('span', label), control); return node; };
  const section = el('section', undefined, 'helper-training'), body = el('div', undefined, 'helper-training-body');
  const status = el('p', 'Loading F2P training methods…', 'helper-training-status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
  const form = el('form', undefined, 'helper-training-form'), output = el('div', undefined, 'helper-training-output');
  const skill = el('select'), target = el('select'), manualTarget = el('input'), manualFrom = el('input'), override = el('input');
  skill.setAttribute('aria-label', 'Training skill'); target.setAttribute('aria-label', 'Training target'); override.type = 'checkbox';
  for (const input of [manualTarget, manualFrom]) { input.type = 'number'; input.min = '1'; input.max = '120'; input.step = '1'; input.inputMode = 'numeric'; }
  const targetField = field('Custom target level', manualTarget), fromField = field('Temporary starting level', manualFrom), overrideField = el('label', undefined, 'helper-training-check');
  overrideField.append(override, el('span', 'Plan from a different starting level'));
  const progress = el('p', undefined, 'helper-training-progress'), capNote = el('p', undefined, 'helper-training-note');
  const submit = el('button', 'Plan my grind', 'helper-training-submit'); submit.type = 'submit'; submit.disabled = true;
  const retry = el('button', 'Retry loading methods'); retry.type = 'button'; retry.hidden = true;
  // Three rows: what you're training (and where you are now), where you want to get, and an optional different start.
  const facts = el('div', undefined, 'helper-training-facts'), skillRow = el('div', undefined, 'helper-training-row'), targetRow = el('div', undefined, 'helper-training-row'), startRow = el('div', undefined, 'helper-training-row helper-training-start');
  facts.append(progress, capNote); skillRow.append(field('Skill', skill), facts); targetRow.append(field('Target', target), targetField, submit); startRow.append(overrideField, fromField);
  form.append(skillRow, targetRow, startRow);
  const miningSettings = createMiningSettings({ el, command, canWrite, preferences: getPreferences,
    select: (options, value) => { const control = el('select'); for (const row of options) { const option = el('option', row.label); option.value = row.value; control.append(option); } control.value = value; return control; },
    showError: error => notice(error.message || 'Mining settings could not save. Try again.', true),
  }, member.id, { inline: true, isCurrent: () => !disposed && isCurrent(),
    level: () => usesManual() ? Number(manualFrom.value) || null : observedProgress(member, 'Mining')?.level,
    onChange: state => { invalidate(); miningSaving = state === 'saving'; submit.disabled = miningSaving || woodcuttingSaving || bankingSaving; if (state !== 'error') notice(state === 'saving' ? 'Saving Mining settings…' : 'Mining settings saved. Plan your grind again.'); },
  });
  miningSettings.hidden = true; form.append(miningSettings);
  const woodcuttingSettings = createWoodcuttingSettings({ el, command, canWrite, preferences: getPreferences,
    select: (options, value) => { const control = el('select'); for (const row of options) { const option = el('option', row.label); option.value = row.value; control.append(option); } control.value = value; return control; },
    showError: error => notice(error.message || 'Woodcutting settings could not save. Try again.', true),
  }, member.id, { inline: true, isCurrent: () => !disposed && isCurrent(),
    level: () => usesManual() ? Number(manualFrom.value) || null : observedProgress(member, 'Woodcutting')?.level,
    onChange: state => { invalidate(); woodcuttingSaving = state === 'saving'; submit.disabled = miningSaving || woodcuttingSaving || bankingSaving; if (state !== 'error') notice(state === 'saving' ? 'Saving Woodcutting settings…' : 'Woodcutting settings saved. Plan your grind again.'); },
  });
  woodcuttingSettings.hidden = true; form.append(woodcuttingSettings);
  const bankingSettings = createBankingSettings({ el, command, canWrite, preferences: getPreferences,
    select: (options, value) => { const control = el('select'); for (const row of options) { const option = el('option', row.label); option.value = row.value; control.append(option); } control.value = value; return control; },
    showError: error => notice(error.message || 'Banking settings could not save. Try again.', true),
  }, member.id, { inline: true, skill: () => skill.value, advanced, isCurrent: () => !disposed && isCurrent(),
    onChange: state => { invalidate(); bankingSaving = state === 'saving'; submit.disabled = miningSaving || woodcuttingSaving || bankingSaving; if (state !== 'error') notice(state === 'saving' ? 'Saving banking settings…' : 'Banking settings saved. Plan your grind again.'); },
  });
  bankingSettings.hidden = true; form.append(bankingSettings);
  form.hidden = true;
  section.append(el('h2', 'Grind planner'), el('p', 'Plan from your saved personal levels and quests using your reachable chunks, including connected duo chunks.', 'helper-training-note'), status, retry, body);
  body.append(form, output); host.replaceChildren(section);

  function invalidate() { generation++; controller?.abort(); controller = null; output.replaceChildren(); output.setAttribute('aria-busy', 'false'); }
  function notice(message, error = false) { status.textContent = plain(message); status.className = `helper-training-status${error ? ' helper-training-error' : ''}`; status.setAttribute('role', error ? 'alert' : 'status'); }
  function info() { return catalogue?.skills.find(row => row.skill === skill.value); }
  function usesManual() { return !observedProgress(member, skill.value) || override.checked; }
  function updateStarting() {
    const saved = observedProgress(member, skill.value);
    overrideField.hidden = !saved; fromField.hidden = !usesManual(); manualFrom.required = usesManual();
    progress.textContent = saved ? `${member.name ?? member.id}: ${skill.value} ${saved.level} · ${number(saved.xp)} XP · ${saved.source === 'game-plugin' ? 'Game plugin' : saved.source === 'hiscores' ? 'RS3 hiscores' : saved.source === 'official-api' ? 'RuneScape API' : 'RuneMetrics'}${saved.fetchedAt ? ` · Synced ${syncedDate(saved.fetchedAt)}` : ''}` : 'Your personal level is not saved. Enter your current level for this plan, or sync progress in Activity Info.';
  }
  function targetOptions() {
    const row = info(), saved = observedProgress(member, skill.value);
    const targets = trainingTargets(getResult(), skill.value, row.f2pCap, saved?.level ?? 0, member);
    target.replaceChildren();
    for (const goal of targets) { const option = el('option', `Level ${goal.level} · ${goal.labels.join('; ')}`); option.value = String(goal.level); target.append(option); }
    const custom = el('option', 'Custom target'); custom.value = 'custom'; target.append(custom);
    return targets;
  }
  function setTarget(value) {
    const text = String(value);
    target.value = [...target.children].some(option => option.value !== 'custom' && option.value === text) ? text : 'custom';
    manualTarget.value = text; targetField.hidden = target.value !== 'custom';
  }
  function refreshResult() {
    if (disposed || !isCurrent() || !catalogue) return;
    const selected = target.value, typed = manualTarget.value;
    targetOptions();
    if (selected === 'custom') { target.value = 'custom'; manualTarget.value = typed; }
    else if ([...target.children].some(option => option.value === selected)) { target.value = selected; manualTarget.value = typed; }
    else { target.value = 'custom'; manualTarget.value = selected; }
    targetField.hidden = target.value !== 'custom';
  }
  function getDraft() {
    const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    if (!catalogue) {
      const chosenSkill = typeof initialTarget?.skill === 'string' ? initialTarget.skill : typeof draft?.skill === 'string' ? draft.skill : '';
      const sameSkill = draft?.skill === chosenSkill;
      return { skill: chosenSkill, targetLevel: scalar(initialTarget?.level ?? (sameSkill ? draft.targetLevel : '')), manualFrom: scalar(sameSkill ? draft.manualFrom : ''), override: sameSkill && draft.override === true };
    }
    return { skill: skill.value, targetLevel: target.value === 'custom' ? manualTarget.value : target.value, manualFrom: manualFrom.value, override: override.checked === true };
  }
  function chooseSkill() {
    invalidate(); override.checked = false; manualFrom.value = ''; updateStarting();
    const row = info(), saved = observedProgress(member, skill.value);
    manualTarget.max = manualFrom.max = String(row.f2pCap);
    capNote.textContent = row.status === 'trial' ? `Members skill trial: F2P training stops at level ${row.f2pCap}.` : `F2P target limit: level ${row.f2pCap}.`;
    const targets = targetOptions();
    target.value = targets.length ? String(targets[0].level) : 'custom';
    manualTarget.value = String(Math.min(row.f2pCap, (saved?.level ?? 1) + 5)); targetField.hidden = target.value !== 'custom';
    notice(saved ? 'Choose a target, then plan your grind.' : 'Enter your current level to plan your grind.');
    updateGatheringSettings();
  }
  function updateGatheringSettings() {
    miningSettings.hidden = skill.value !== 'Mining' || (typeof canWrite === 'function' ? canWrite() : canWrite) !== true || typeof command !== 'function';
    miningSettings.refresh?.();
    woodcuttingSettings.hidden = skill.value !== 'Woodcutting' || (typeof canWrite === 'function' ? canWrite() : canWrite) !== true || typeof command !== 'function';
    woodcuttingSettings.refresh?.();
    bankingSettings.hidden = !['Mining', 'Woodcutting', 'Fishing'].includes(skill.value) || (typeof canWrite === 'function' ? canWrite() : canWrite) !== true || typeof command !== 'function';
    bankingSettings.refresh?.();
  }
  function level(input, label, cap = 120) {
    const raw = input.value.trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > cap) throw new Error(`${label} must be a whole level from 1 to ${cap}.`);
    return Number(raw);
  }
  function sources(ids, plan) {
    const box = el('details', undefined, 'helper-training-sources'); box.append(el('summary', 'Sources and rate evidence'));
    const rows = el('ul');
    const sourceRows = new Map([...(catalogue.sources ?? []), ...(plan.sources ?? [])].map(source => [source.id, source]));
    for (const id of new Set(ids)) {
      const source = sourceRows.get(id); if (!source) continue;
      let url; try { url = new URL(source.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.hostname !== 'runescape.wiki') continue;
      if (source.revision && !url.searchParams.has('oldid')) url.searchParams.set('oldid', source.revision);
      const li = el('li'), link = el('a', source.title ?? 'RuneScape Wiki source'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link);
      if (advanced && source.revision) li.append(el('span', ` · revision ${source.revision}`)); rows.append(li);
    }
    if (!rows.children.length) return null;
    box.append(rows); return box;
  }
  function rateText(method, record) {
    if (record?.skill === 'Fishing' || record?.fishingCurve || method.fishing) return fishingRateText(method);
    if (record?.skill === 'Woodcutting' || record?.woodcuttingCurve || method.woodcutting) {
      const range = (start, end, value) => positive(start) && positive(end) && Math.round(start) !== Math.round(end) ? `${whole(start)}–${whole(end)}` : whole(value);
      return `${positive(method.xpPerHour) ? `${range(method.xpPerHourStart, method.xpPerHourEnd, method.xpPerHour)} XP/hour estimated` : 'XP/hour unknown'} · ${positive(method.logsPerHour) ? `${range(method.logsPerHourStart, method.logsPerHourEnd, method.logsPerHour)} logs/hour estimated` : 'logs/hour unknown'}`;
    }
    if (record?.skill === 'Mining' || record?.miningCurve || method.mining) {
      const range = (start, end, value) => positive(start) && positive(end) && Math.round(start) !== Math.round(end) ? `${whole(start)}–${whole(end)}` : whole(value);
      return `${positive(method.xpPerHour) ? `${range(method.xpPerHourStart, method.xpPerHourEnd, method.xpPerHour)} XP/hour estimated` : 'XP/hour unknown'} · ${positive(method.orePerHour) ? `${range(method.orePerHourStart, method.orePerHourEnd, method.orePerHour)} ore/hour estimated` : 'ore/hour unknown'}`;
    }
    const actions = trainingActionsPerHour(record, method.xpPerHour);
    return `${positive(method.xpPerHour) ? `${number(method.xpPerHour)} XP/hour estimated` : 'XP/hour unknown'} · ${actions === null ? 'actions/hour unknown' : `${number(actions)} actions/hour estimated`} · ${positive(record?.xpPerAction) ? `${number(record.xpPerAction)} base XP/action` : 'XP/action unknown'}`;
  }
  function notes(record, values = [], mining, woodcutting, fishing, showAssumptions = true, fishingEnd, banking) {
    const details = el('details', undefined, 'helper-training-rate-notes'), list = el('ul', undefined, 'helper-training-notes');
    if (record?.skill === 'Mining' || record?.miningCurve || mining) {
      list.append(el('li', banking ? 'Drop rates are at the rock. Bank rates include walking and storing ore.' : 'Rates are at the rock, no banking. Travel and storing ore add time.'), el('li', 'Rockertunities, spirits, boosts and equipment bonuses are excluded. Natural extra ore from Mining levels is included.'));
      if (mining?.strengthSource === 'conservative-default') list.append(el('li', 'Strength is not synced; this estimate uses level 1.'));
      if (advanced && mining) {
        list.append(el('li', `${number(mining.damagePerSwing)} damage per swing`), el('li', `${number(mining.swingsPerGatheredOre ?? mining.swingsPerOre)} swings per ore`));
        list.append(el('li', `Stamina damage: ${number(mining.staminaMultiplier * 100)}%${mining.miningLevel < 15 ? ' (stamina starts at Mining 15)' : ''}`));
        if (mining.sourceVersion) list.append(el('li', `Rate source version: ${mining.sourceVersion}`));
      }
    } else if (record?.skill === 'Woodcutting' || record?.woodcuttingCurve || woodcutting) {
      list.append(el('li', banking ? 'Rates assume one tree, waiting for it to respawn and clicking again immediately. Bank rates include walking and storing logs.' : 'Rates assume one tree, waiting for it to respawn and clicking again immediately. Travel, banking and storing logs add time.'), el('li', 'Urns, outfits, perks, boosts and extra XP or log bonuses are excluded. A reachable hatchet source does not mean you own the tool.'));
      if (woodcutting?.provisionalDepletion) list.append(el('li', 'Normal-tree depletion uses provisional published data; its current felling chance needs validation.'));
      if (advanced && woodcutting) {
        list.append(el('li', `Chop chance: ${number(woodcutting.chopChance * 100)}%`), el('li', `${number(woodcutting.attemptsPerLog)} attempts per log`),
          el('li', `Felling chance: ${number(woodcutting.fellingChance * 100)}%`), el('li', `Respawn: ${number(woodcutting.respawnSeconds)} seconds`),
          el('li', `Downtime per log: ${number(woodcutting.downtimePerLogSeconds)} seconds`));
        if (woodcutting.sourceVersion) list.append(el('li', `Rate source version: ${woodcutting.sourceVersion}`));
      }
    } else if (record?.skill === 'Fishing' || record?.fishingCurve || fishing) {
      if (showAssumptions) list.append(el('li', banking ? 'Spot moves, re-clicking, urns, outfits and boosts are excluded. Bank rates include walking and storing the catch.' : fishingExclusions));
      if (advanced && fishing) for (const text of fishingChanceNotes(fishing, fishingEnd)) list.append(el('li', text));
    } else for (const value of new Set([...(record?.assumptions ?? []), ...values].map(rateNote))) if (nonEconomic(value)) list.append(el('li', value));
    details.open = false; details.hidden = !list.children.length;
    details.append(el('summary', 'Rate and supply notes'), list); return details;
  }
  function methodRecord(id) { return catalogue.methods.find(row => row.id === id); }
  function gatheringSummary(method) {
    if (method.banking) return el('p', `${method.mining ? miningPickaxeLabel(method.mining.pickaxeLabel) : method.woodcutting?.hatchetLabel ?? 'Fishing'} · ${method.banking.mode === 'bank' ? 'banking on foot' : 'dropping resources'}`, 'helper-training-note');
    if (method.fishing) return el('p', fishingSpotAssumption, 'helper-training-note');
    if (method.woodcutting) return el('p', `Assumed: ${method.woodcutting.hatchetLabel ?? 'hatchet unknown'} · at the tree, no banking`, 'helper-training-note');
    if (!method.mining) return null;
    const rate = method.mining, attention = rate.profileId === 'afk' ? 'AFK' : rate.profileId === 'occasional' ? 'Occasional clicking' : 'Active clicking';
    const assumed = (getPreferences().miningPickaxe ?? 'auto') === 'auto';
    return el('p', `${assumed ? 'Assumed: ' : ''}${miningPickaxeLabel(rate.pickaxeLabel ?? 'pickaxe unknown')} · ${attention} · at the rock, no banking`, 'helper-training-note');
  }
  function showPlan(plan) {
    const route = plan.plans?.['best-xp'], ids = [...(info()?.sourceIds ?? [])];
    const view = el('div', undefined, 'helper-training-plan');
    if (plan.status === 'unknown-level') { override.checked = true; fromField.hidden = false; manualFrom.required = true; view.append(el('p', 'No saved personal level is available. Enter your current level and plan again.')); output.replaceChildren(view); return; }
    if ((plan.issues ?? []).some(issue => issue.code === 'skill-cap')) { view.append(el('p', `This target is outside the F2P limit for ${skill.value}. Choose level ${info().f2pCap} or below.`)); output.replaceChildren(view); return; }
    view.append(el('h3', `${skill.value} ${plan.fromLevel} → ${plan.toLevel}`), el('p', `${number(plan.xpNeeded)} XP needed`, 'helper-training-total'));
    const comparedMethods = new Set();
    if (plan.gatheringMode) view.append(el('p', plan.gatheringMode === 'bank' ? 'Training time includes the estimated bank trip.' : plan.gatheringProcessing && plan.gatheringProcessing !== 'none' ? 'Training time includes processing and dropping.' : 'Training time assumes you drop resources.', 'helper-training-note'));
    if (plan.progress?.source === 'manual' || (plan.issues ?? []).some(issue => issue.code === 'level-floor')) view.append(el('p', `Exact starting XP is unknown. This estimate starts at the minimum XP for level ${plan.fromLevel}.`, 'helper-training-note'));
    if (route?.complete && plan.xpNeeded === 0) view.append(el('p', 'Your starting progress already meets this target.'));
    else {
      view.append(el('h3', 'Fastest route in your chunks'), el('p', route?.complete ? `${duration(route.hours)} estimated training time` : route?.segments?.length ? `${duration(route.partialHours)} estimated for the covered part; remaining time unknown` : 'Training time unknown', 'helper-training-total'));
      const steps = el('ol', undefined, 'helper-training-steps');
      for (const segment of route?.segments ?? []) {
        if (segment.banking) comparedMethods.add(segment.methodId);
        const record = methodRecord(segment.methodId); if (record?.members !== false) continue;
        const step = el('li', undefined, 'helper-training-step');
        step.append(el('h4', `${segment.fromLevel} → ${segment.toLevel}: ${segment.label}`), el('p', rateText(segment, record), 'helper-training-rates'), el('p', ['Mining', 'Woodcutting', 'Fishing'].includes(record?.skill) ? `${duration(segment.hours)} estimated` : `${segment.actions == null ? 'Action count unknown' : `${number(segment.actions)} actions`} · ${duration(segment.hours)} estimated`));
        const summary = gatheringSummary(segment); if (summary) step.append(summary);
        const materials = el('ul', undefined, 'helper-training-materials');
        for (const input of segment.inputs ?? []) materials.append(el('li', `Gather or obtain ${input.totalQuantity == null ? 'an unknown quantity of' : segment.fishing ? `about ${whole(input.totalQuantity)}` : number(input.totalQuantity)} ${segment.fishing ? fishingSupplyLabel(input.item, input.totalQuantity == null ? null : Math.round(input.totalQuantity)) : input.item}`));
        if (segment.fishing) for (const fish of segment.species ?? []) materials.append(el('li', `Catches about ${whole(fish.fishProduced)} ${fish.label.toLowerCase()}${segment.banking ? segment.banking.mode === 'drop' ? ' (dropped)' : ' (kept)' : record.outputDisposition === 'drop' ? ' (dropped)' : ''}`));
        else for (const item of segment.outputs ?? []) materials.append(el('li', `Produces ${segment.woodcutting && positive(segment.logsProduced) ? `about ${whole(segment.logsProduced)}` : segment.mining && positive(segment.oreProduced) ? `about ${whole(segment.oreProduced)}` : item.totalQuantity == null ? 'an unknown quantity of' : number(item.totalQuantity)} ${item.item}`));
        step.append(materials, notes(record, segment.assumptions, segment.mining, segment.woodcutting, segment.fishing, true, segment.fishingEnd, segment.banking));
        if (segment.banking?.mode === 'bank') {
          const comparison = renderBankingComparison(el, segment.banking, { advanced, resourceLabel: skill.value === 'Mining' ? 'ore' : skill.value === 'Woodcutting' ? 'logs' : 'fish' });
          if (comparison) step.append(comparison);
        }
        steps.append(step); ids.push(...(record?.sourceIds ?? []));
      }
      view.append(steps);
      if (!route?.complete) view.append(el('p', 'There’s no known XP rate all the way to your target in your current chunks, so there’s no full time estimate. You can still train with the methods below.', 'helper-training-note'));
    }
    const eligible = (plan.availableMethods ?? []).filter(method => method.eligibleNow && methodRecord(method.methodId)?.members === false);
    // Fishing keep-the-catch variants match the drop variant until banking is modelled; list one of each.
    const shown = eligible.filter(method => !(method.fishing && method.methodId.endsWith('.bank') && eligible.some(other => other.methodId === method.methodId.slice(0, -5) && rateText(other, methodRecord(other.methodId)) === rateText(method, methodRecord(method.methodId)))));
    const methods = shown.map((method, index) => ({ method, index })).sort((a, b) => (positive(b.method.xpPerHour) ? b.method.xpPerHour : -1) - (positive(a.method.xpPerHour) ? a.method.xpPerHour : -1) || a.index - b.index).map(entry => entry.method);
    view.append(el('h3', 'Methods you can use now'));
    const available = el('ul', undefined, 'helper-training-methods');
    for (const method of methods) {
      const record = methodRecord(method.methodId), row = el('li'); row.append(el('strong', method.label), el('p', rateText(method, record)));
      if (record.inputs?.length) row.append(el('p', `Per ${method.fishing ? 'catch' : 'action'}: ${record.inputs.map(input => `${input.quantity == null ? 'quantity unknown' : number(input.quantity)} ${method.fishing ? fishingSupplyLabel(input.item, input.quantity) : input.item}`).join(', ')}. Supplies still need gathering.`));
      row.append(notes(record, method.assumptions, method.mining, method.woodcutting, method.fishing, false, undefined, method.banking));
      const comparison = comparedMethods.has(method.methodId) ? null : renderBankingComparison(el, method.banking, { advanced, resourceLabel: skill.value === 'Mining' ? 'ore' : skill.value === 'Woodcutting' ? 'logs' : 'fish' });
      if (comparison) row.append(comparison);
      available.append(row); ids.push(...(record.sourceIds ?? []));
    }
    view.append(methods.length ? available : el('p', 'None of the training methods we know about work at your starting level in these chunks yet.'));
    const better = nextBetterTrainingMethod(plan, catalogue);
    const locked = el('section', undefined, 'helper-training-locked'); locked.append(el('h3', 'Next better method to unlock'));
    if (better) {
      const record = methodRecord(better.methodId); locked.append(el('h4', `${better.label} · level ${better.level}`), el('p', rateText(better, record)));
      const summary = better.fishing ? null : gatheringSummary(better); if (summary) locked.append(summary);
      if (better.level > plan.toLevel) locked.append(el('p', `This method starts after your level ${plan.toLevel} target. Your training route above still covers only the selected target.`, 'helper-training-note'));
      const gates = el('ul'); if (better.level > plan.fromLevel) gates.append(el('li', `Reach ${skill.value} ${better.level} first`));
      for (const blocker of better.blockers ?? []) {
        const row = el('li', blockerText(blocker));
        const locations = (blocker.locations ?? []).map(location => `${plain(location.label ?? location.area ?? '')}${location.locationId ? ` (${location.locationId})` : location.chunkId ? ` (chunk ${location.chunkId})` : ''}`);
        if (locations.length) row.append(el('p', `Possible sources: ${[...new Set(locations)].join('; ')}. Check the route and return journey before using them.`)); gates.append(row);
      }
      locked.append(gates, notes(record, better.assumptions, better.mining, better.woodcutting, better.fishing, false)); ids.push(...(record.sourceIds ?? []));
    } else locked.append(el('p', 'No faster F2P method is locked behind these chunks.'));
    view.append(locked, el('p', plan.availableMethods?.some(method => method.banking) ? 'Drop and bank rates are estimates. Walking stays inside your reachable chunks; storing and bank actions use estimated delays.' : skill.value === 'Mining' ? 'Estimates are at the rock, no banking. Travel and storing ore add time. A reachable pickaxe source does not mean you own the tool.' : skill.value === 'Woodcutting' ? 'Estimates include one-tree respawn waits. Travel, banking and storing logs add time.' : skill.value === 'Fishing' ? 'Expected catches are estimates. Bait and feathers still need gathering; reachable sources do not mean you own the supplies.' : 'Estimates depend on gear, attention and the stated method assumptions. Training time excludes gathering inputs and travel unless a method note explicitly includes them. Total time with self-gathered supplies is unknown. Duo supplies can be shared; reachable sources do not mean your bank already has stock.', 'helper-training-note'));
    const evidence = sources(ids, plan); if (evidence) view.append(evidence); output.replaceChildren(view);
  }
  async function run(event) {
    event?.preventDefault(); if (disposed || !isCurrent() || !catalogue || miningSaving || woodcuttingSaving || bankingSaving) return;
    invalidate(); const token = generation;
    let to, from;
    try { to = target.value === 'custom' ? level(manualTarget, 'Target level', info().f2pCap) : level(target, 'Target level', info().f2pCap); if (usesManual()) from = level(manualFrom, 'Starting level', info().f2pCap); }
    catch (error) { notice(error.message, true); return; }
    const params = new URLSearchParams({ memberId: member.id, skill: skill.value, targetLevel: String(to), preference: 'best-xp' });
    if (from !== undefined) params.set('fromLevel', String(from));
    controller = new AbortController(); notice('Planning with your current chunks and personal quest progress…'); output.setAttribute('aria-busy', 'true');
    try {
      const plan = await api(`/api/training-plan?${params}`, undefined, controller.signal);
      if (!current(token)) return;
      if (stateRevision != null && plan.stateRevision != null && plan.stateRevision !== stateRevision) throw new Error('The save changed while planning. Wait for the picker to refresh, then plan again.');
      if (plan.memberId !== undefined && plan.memberId !== member.id || plan.skill !== skill.value || plan.toLevel !== to) throw new Error('The player or target changed. Plan again with the current selection.');
      showPlan(plan); notice(plan.status === 'unknown-level' ? 'Enter your current level and plan again.' : 'Plan ready. Rates and times are estimates.');
    } catch (error) { if (current(token) && error.name !== 'AbortError') notice(error.message || 'The plan could not load. Try Plan my grind again.', true); }
    finally { if (current(token)) output.setAttribute('aria-busy', 'false'); }
  }
  async function load() {
    if (disposed || !isCurrent()) return; invalidate(); const token = generation; controller = new AbortController(); retry.hidden = true; notice('Loading F2P training methods…');
    try {
      const data = await api('/api/training-catalogue', undefined, controller.signal); if (!current(token)) return;
      if (!Array.isArray(data.skills) || !Array.isArray(data.methods)) throw new Error('Training methods are unavailable. Retry loading methods.');
      catalogue = data;
      for (const row of data.skills.filter(row => row.status !== 'unavailable' && Number.isInteger(row.f2pCap))) { const option = el('option', row.status === 'trial' ? `${row.skill} · F2P trial to ${row.f2pCap}` : row.skill); option.value = row.skill; skill.append(option); }
      if (!skill.children.length) throw new Error('No F2P training skills are available.');
      const hasSkill = name => [...skill.children].some(option => option.value === name);
      skill.value = hasSkill(initialTarget?.skill) ? initialTarget.skill : hasSkill(draft?.skill) ? draft.skill : skill.children[0].value;
      form.hidden = false; submit.disabled = false; chooseSkill();
      if (draft?.skill === skill.value) {
        manualFrom.value = typeof draft.manualFrom === 'string' || typeof draft.manualFrom === 'number' ? String(draft.manualFrom) : '';
        override.checked = draft.override === true; updateStarting();
        updateGatheringSettings();
        if (typeof draft.targetLevel === 'string' || typeof draft.targetLevel === 'number') setTarget(draft.targetLevel);
      }
      if (initialTarget?.skill === skill.value && Number.isInteger(initialTarget.level) && initialTarget.level >= 1 && initialTarget.level <= info().f2pCap) {
        setTarget(initialTarget.level);
      }
    } catch (error) { if (current(token) && error.name !== 'AbortError') { notice(error.message || 'Training methods could not load. Retry loading methods.', true); retry.hidden = false; } }
  }
  listen(form, 'submit', run); listen(skill, 'change', chooseSkill);
  listen(target, 'change', () => { invalidate(); targetField.hidden = target.value !== 'custom'; notice('Target changed. Plan your grind again.'); });
  listen(override, 'change', () => { invalidate(); updateStarting(); updateGatheringSettings(); notice('Starting level changed. Plan your grind again.'); });
  for (const input of [manualFrom, manualTarget]) listen(input, 'input', () => { invalidate(); updateGatheringSettings(); notice('Levels changed. Plan your grind again.'); });
  listen(retry, 'click', load); void load();
  const dispose = function () { disposed = true; generation++; controller?.abort(); miningSettings.dispose?.(); woodcuttingSettings.dispose?.(); bankingSettings.dispose?.(); for (const [node, event, callback] of listeners) node.removeEventListener(event, callback); };
  return Object.assign(dispose, { getDraft, refreshResult });
}
