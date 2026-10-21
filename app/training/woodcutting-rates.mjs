// Browser-safe lookup of the offline success table, with a one-tree renewal mean.
import { WOODCUTTING_TREES, WOODCUTTING_HATCHETS, WOODCUTTING_BOUNDS } from './woodcutting-rules.mjs';
export { WOODCUTTING_TREES, WOODCUTTING_HATCHETS, WOODCUTTING_BOUNDS, WOODCUTTING_SOURCES, WOODCUTTING_FORMULA, WOODCUTTING_UNMODELLED_TREES } from './woodcutting-rules.mjs';
const trees = new Map(WOODCUTTING_TREES.map(tree => [tree.id, tree]));
const hatchets = new Map(WOODCUTTING_HATCHETS.map(hatchet => [hatchet.id, hatchet]));

/** The caller checks tree access; auto is a tool assumption, not owned equipment. */
export function lookupWoodcuttingRate(input = {}, catalogue) {
  if (!input || typeof input !== 'object') return null;
  const {treeId, woodcuttingLevel, hatchetId = 'auto'} = input;
  if (!Number.isInteger(woodcuttingLevel) || woodcuttingLevel < WOODCUTTING_BOUNDS.woodcuttingMin
    || woodcuttingLevel > WOODCUTTING_BOUNDS.woodcuttingMax || catalogue?.schemaVersion !== 1
    || catalogue.supportedLevels?.woodcuttingMax !== WOODCUTTING_BOUNDS.woodcuttingMax
    || catalogue.packing?.denominator !== 2560000) return null;
  const tree = trees.get(treeId);
  const hatchet = hatchetId === 'auto' ? WOODCUTTING_HATCHETS.findLast(row => row.level <= woodcuttingLevel) : hatchets.get(hatchetId);
  if (!tree || !hatchet || woodcuttingLevel < Math.max(tree.level, hatchet.level)) return null;
  const roll = catalogue.rates?.[treeId]?.[hatchet.id]?.[woodcuttingLevel - Math.max(tree.level, hatchet.level)];
  if (!Number.isInteger(roll) || roll <= 0 || roll > 2560000) return null;
  const chopChance = roll / 2560000;
  const attemptsPerLog = 1 / chopChance;
  const downtimePerLogSeconds = tree.fellingChance * tree.respawnSeconds;
  const secondsPerLog = 2.4 * attemptsPerLog + downtimePerLogSeconds;
  const logsPerHour = 3600 / secondsPerLog;
  const uninterruptedLogsPerHour = 1500 * chopChance;
  return {
    xpPerHour: logsPerHour * tree.xpPerLog, logsPerHour, xpPerLog: tree.xpPerLog,
    treeId, treeLabel: tree.label, woodcuttingLevel, hatchetId: hatchet.id, hatchetLabel: hatchet.label,
    chopChance, attemptsPerLog, fellingChance: tree.fellingChance, respawnSeconds: tree.respawnSeconds,
    respawnRangeSeconds: [...tree.respawnRangeSeconds], downtimePerLogSeconds, secondsPerLog,
    uninterruptedLogsPerHour, uninterruptedXpPerHour: uninterruptedLogsPerHour * tree.xpPerLog,
    provisionalDepletion: tree.provisionalDepletion, sourceVersion: catalogue.version,
    assumptions: [...(catalogue.assumptions ?? [])],
  };
}
