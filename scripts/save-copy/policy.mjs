// Only committed public game data supplies safe values. Saves, local edits,
// player defaults, browser fixtures and gallery examples never extend trust.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeLegacyText } from '../../app/tasks/gameplay-compat.mjs';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const publicGameJSONInputs = Object.freeze([
  'app/data/legacy-dataset-values.2026-10-13.v1.json',
  'app/data/legacy-rules-text-values.2026-10-13.v1.json',
  'app/data/legacy-task-history.json',
]);

// Spellings from state and its nested validators, tasks/migration and storage.
// Callers must still distinguish schema objects from game dictionaries by path.
export const schemaKeys = new Set(`
  format schemaVersion state revision rules members tasks history legacy provenance
  id name sourceMapId unlocked selected pendingRoll blacklisted completedTasks
  obtainedEquipment teleports teleportOverrides notes journal taskStatus taskRules
  sectionOverrides sourceBacklogs areaOverrides preferences primaryOverrides
  passiveLevels maxLevels slayerLock stickers chunkColours chunkColourNames
  taskAlternatives runescapeName skillProgress questProgress runeMetricsSync
  originalPickerSync transportFacts f2pMap xpChoices identityRegistry taskClaims
  progressSnapshots finishLine groupGoals ruleReviews
  label category completionIds skill level memberIds destination available consumable
  backlogged backlogReason favorite note challengeCompleted type color text
  source fetchedAt capturedAt appliedAt createdAt updatedAt at sourceHash groups
  status xp rank observedLevel observedXp levelCap completed points questPoints
  totalLevel combatLevel unlockedChunks minLevel maxLevel passiveLevel maxLevel
  enabled target items customItems completedBy completion done link kind
  levels quests currencies conditions confirmations count amount choices slots
  index allocation selectedSkills importedAllocation sourceIndex rewardIndex
  memberId inviteId actor actors command undo undoRevision undoneRevision
  memberChanges taskChanges taskClaimChanges finishLineChange groupGoalChanges
  ruleReviewChange changes path before after exists value key oldValue newValue
  rulesBefore rulesAfter previousRevision expectedRevision revisionBefore
  task taskId taskIds ruleId preferenceId chunkId chunkIds sectionId areaId
  goalId goalText itemId itemIds group routeId sticker lock colour equipmentName
  member maps captures metadata version url hash timestamp
  entries aliases savedAliases unresolved rawLabel entityKind aliasesByCategory
  membersStart startChunk startingChunk startChunks options selection pool eligible
  eligibleCount reasons reason warnings report imported catalogueTasks reused
  gameplayMigration taskIdentityMigration schemaMigration progressAliasMigration
  journalMigration legacyAlternativeMembers taskStatusProvenance sources
  legacyKey legacyTaskId currentTaskId originalTaskId previousTaskId mappingIds
  conversions conflicts matched missing ambiguous resolved canonicalId candidates
  converted retained removed added changed checked skipped previous next
  beforeCount afterCount beforeTasks afterTasks beforeCompleted afterCompleted
  incomingRevision incomingHistory previousHistory incomingProvenance restore
  historyArchive historySegments archives archiveId firstRevision lastRevision
  digest dataset contractVersion identityNamespace coordinateSystem
  days truncated duo checkedAllTasks checkedChallenges completedChallenges
  backlog favoriteTasks altChallenges checkedTasks challengeTasks
  chunkOrder settings chunkinfo chunks activeSubTabs topbarSelection manualPrimary
  recentFancyRollTime recent recentTime randomLoot chunkNotes stickeredNotes
  userTasks friends friendsAlt selections blacklist tasksCompleted
  objects npcs monsters shops spawns equipment skills
  mappings currentNextIndex generated registered unresolvedIds importedMembers
  progressSnapshotsBefore progressSnapshotsAfter roster original previousMembers
  progressAliasVersion journalVersion legacyNotes legacyJournal
  progressAliasesVersion migratedMembers journalMigratedMembers manualSections
  manualAreas backloggedSources assignedXpRewards allTasks challenges checkedSkills
  methods completionGroups taskRuleMigration alternatives legacyAlternatives
  rolled starts title objectiveKind beforeExists afterExists restored cleared
  bankVersion pairing switchToMembers originalId identities sourceVersion capture
`.trim().split(/\s+/));

const privateCatalogueBranch = /(?:runescapename|sourceMapId|account(?:name|id)?|friend|(?:default|member|player|owner).*(?:name|identity)|gameDefaults)/i;
const excludedModule = /(?:^|\/)[^/]*(?:default|fixture|gallery)[^/]*\.mjs$/i;

function committedFiles(root) {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', 'app/core', 'app/tasks', 'app/data',
    'app/dataset-inputs.mjs', 'reference/original-picker/tasksMap.json', 'rs3-chunkpicker-chunkinfo-export.json'],
    { cwd: root, maxBuffer: 8 * 1024 ** 2 }).toString('utf8').split('\0').filter(Boolean);
}

// One byte-counted Git batch, instead of a process and filesystem read per file.
function committedBlobs(root, files) {
  const bytes = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: files.map(file => `HEAD:${file}\n`).join(''), maxBuffer: 128 * 1024 ** 2,
  });
  let offset = 0;
  return files.map(filename => {
    const newline = bytes.indexOf(10, offset);
    if (newline < 0) throw new Error('Committed game vocabulary is unavailable.');
    const match = /^[a-f0-9]+ blob (\d+)$/.exec(bytes.subarray(offset, newline).toString('utf8'));
    if (!match) throw new Error('Committed game vocabulary is unavailable.');
    const length = Number(match[1]), begin = newline + 1, end = begin + length;
    if (!Number.isSafeInteger(length) || bytes[end] !== 10) throw new Error('Committed game vocabulary is unavailable.');
    offset = end + 1;
    return [filename, bytes.subarray(begin, end).toString('utf8')];
  });
}

function enumLiterals(source, add, keys) {
  // Conservative data extraction, never evaluation. Comments are skipped;
  // dynamic templates, paths, prose messages and code fragments are excluded.
  const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`[^`$\\]*`/g;
  for (const match of source.matchAll(tokens)) {
    const literal = match[0];
    if (!['"', "'", '`'].includes(literal[0])) continue;
    let value;
    try { value = literal[0] === '"' ? JSON.parse(literal) : literal.slice(1, -1).replace(/\\(['"\\])/g, '$1'); }
    catch { continue; }
    // Exact quoted identifier spellings cover validator/command key arrays.
    // Unlike source-word harvesting this never treats comments or variables as
    // schema declarations. Callers still restrict schema trust by object path.
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) keys.add(value);
    if (/^[A-Za-z][A-Za-z0-9 _:'()-]{0,95}$/.test(value)
      && !/^(?:Unknown|Invalid|Unsupported|Cannot|Missing|Expected|Too many|Choose|Use |Start |Restore |Task |Member |History |Backup |Progress )/.test(value)
      && !/\b(?:must|requires?|needs?|cannot|should|undefined)\b/i.test(value)) add(value);
  }
}

function propertyNames(source, keys) {
  // Property accesses and object declarations are additional schema evidence.
  // Remove complete comments and quoted/template tokens first; words occurring
  // inside messages, wiki labels or commented examples are not declarations.
  // Template expressions are deliberately omitted as well: this extractor is
  // conservative and never executes or imports the source being inspected.
  const code = source.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    token => ' '.repeat(token.length));
  for (const match of code.matchAll(/(?:\?\.|\.)\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) keys.add(match[1]);
  for (const match of code.matchAll(/(?:\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)) keys.add(match[1]);
}

export async function gameVocabulary(root = repositoryRoot) {
  const [{ authoredIdentityRegistry, lookupPermanentId, resolveTaskAlias }, { stripTaskMarkup }] = await Promise.all([
    import('../../app/tasks/identity.mjs'), import('../../app/tasks/migration.mjs'),
  ]);
  const values = new Set(['', 'rs3-chunk-picker']), keys = new Set(schemaKeys);
  function add(value) {
    // Coordinates, numeric catalogue keys and build digests have their own
    // contextual policy. Keeping millions of them here both broadens trust
    // unnecessarily and increases memory on the release PC.
    if (value.length > 4096 || /^(?:\d+(?:[,:_-]\d+)*|[a-f0-9]{64})$/i.test(value)) return;
    if (values.has(value)) return;
    values.add(value);
    values.add(encodeURIComponent(value));
    const decoded = decodeLegacyText(value);
    values.add(decoded); values.add(encodeURIComponent(decoded));
    const plain = stripTaskMarkup(value);
    values.add(plain); values.add(encodeURIComponent(plain));
  }
  function collect(value) {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) for (const child of value) collect(child);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (privateCatalogueBranch.test(key)) continue;
      add(key); collect(child);
    }
  }
  const tracked = committedFiles(root), trackedSet = new Set(tracked);
  if (publicGameJSONInputs.some(file => !trackedSet.has(file))) throw new Error('Committed game vocabulary is unavailable.');
  // The committed engine manifest explicitly names reviewed game inputs. Read
  // its array as data rather than importing executable or working-tree code.
  const [[, manifest]] = committedBlobs(root, ['app/dataset-inputs.mjs']);
  const inputBlock = /export const DATASET_INPUTS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(manifest)?.[1];
  if (!inputBlock) throw new Error('Committed game vocabulary is unavailable.');
  const catalogueFiles = [...inputBlock.matchAll(/"([^"\r\n]+\.json)"/g)].map(match => match[1])
    .filter(file => trackedSet.has(file) && !/(?:fixture|gallery|default)/i.test(file)
      && (file.startsWith('app/data/') || file === 'reference/original-picker/tasksMap.json'
        || file === 'rs3-chunkpicker-chunkinfo-export.json'));
  const jsonInputs = [...new Set([...publicGameJSONInputs, ...catalogueFiles])];
  const modules = tracked.filter(file => /^app\/(?:core|tasks|data)\//.test(file)
    && file.endsWith('.mjs') && !excludedModule.test(file) && file !== 'app/data/original-data.mjs');
  // Parse one catalogue at a time: the complete installed input set can exceed
  // a child-process output limit and needlessly keep several huge blobs alive.
  for (const filename of [...jsonInputs, ...modules]) {
    const [[, source]] = committedBlobs(root, [filename]);
    if (filename.endsWith('.json')) collect(JSON.parse(source));
    else { enumLiterals(source, add, keys); propertyNames(source, keys); }
  }
  // The engine registry contains public identities and their rendered labels,
  // including plain spellings not present verbatim in the captured catalogues.
  // Apply transformations while collecting, so these labels receive them too.
  collect(authoredIdentityRegistry());
  const [{ stickerDefinitions }, settings, routes] = await Promise.all([
    import('../../app/core/map-markers.mjs'), import('../../app/data/settings.mjs'), import('../../app/data/transport-routes.mjs'),
  ]);
  collect(stickerDefinitions);
  collect(settings.taskRuleDefinitions); collect(settings.preferenceDefinitions ?? []);
  // Route and setting records are authored engine data, never saved overrides.
  for (const [key, value] of Object.entries(routes)) if (typeof value !== 'function') collect(value);
  const cache = new Map();
  function gameValue(value) {
    if (typeof value !== 'string') return false;
    if (values.has(value) || value.startsWith('*fb*_') && values.has(value.slice(5))) return true;
    if (cache.has(value)) return cache.get(value);
    const decoded = decodeLegacyText(value);
    if (decoded !== value && gameValue(decoded)) { cache.set(value, true); return true; }
    let safe = false;
    if (value.length <= 4096) {
      try {
        const entry = lookupPermanentId(value);
        if (entry) {
          safe = true;
          // The spelling comes from the public engine, not the queried save.
          if (entry.label) add(entry.label);
        } else safe = resolveTaskAlias(value).status === 'resolved';
        // Generated display labels omit wiki markup. Restore only the engine's
        // known syntax, then require resolution of all authored subjects.
        if (!safe && value.startsWith('Obtain ')) safe = resolveTaskAlias(`Obtain ~|${value.slice(7)}|~`).status === 'resolved';
        if (!safe && value.startsWith('Kill X ')) safe = resolveTaskAlias(`Kill X ~|${value.slice(7)}|~`).status === 'resolved';
        if (!safe) {
          const colon = value.indexOf(': ');
          if (colon > 0) {
            const source = value.slice(0, colon), item = value.slice(colon + 2);
            safe = resolveTaskAlias(`${source}: ~|${item}|~`).status === 'resolved'
              || resolveTaskAlias(`~|${source}|~: ~|${item}|~`).status === 'resolved';
          }
        }
      } catch { /* unknown */ }
    }
    if (/^revision-[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value.slice(9)))) safe = true;
    cache.set(value, safe); return safe;
  }
  return { values, keys, gameValue };
}
