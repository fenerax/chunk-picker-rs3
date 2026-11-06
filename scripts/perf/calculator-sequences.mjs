// Pure calculator-verification commands. Record offers through the real command
// boundary so a later accepted roll retains a valid Undo history.
import { createRollPoolCache } from '../../app/core/rules.mjs';
export function acceptCalculatorRoll({ core, world, registry }, state, memberId, pool, index, epochMs) {
  const rows = pool.pool?.eligible;
  if (!Array.isArray(rows) || !Number.isSafeInteger(index) || index < 0 || index >= rows.length
    || !Number.isSafeInteger(epochMs)) throw Error('SequenceInputError');
  const cache = createRollPoolCache(world, registry);
  cache.set(state, memberId, pool);
  const count = Math.min(2, rows.length), chunkId = rows[index].id;
  const offered = core.applyCommand(state, { type: 'roll', memberId, count }, { world, registry,
    precomputedPool: cache.prepare(state, memberId), random: () => (index + 0.25) / rows.length,
    now: new Date(epochMs) });
  if (count === 1) return { chunkId, previewState: state, state: offered, offerCount: count };
  if (offered.members.find(member => member.id === memberId)?.pendingRoll[0] !== chunkId) throw Error('SequenceSelectionError');
  const accepted = core.applyCommand(offered, { type: 'unlock-selection', memberId, chunkId }, { world, registry,
    now: new Date(epochMs + 1000) });
  return { chunkId, previewState: offered, state: accepted, offerCount: count };
}
