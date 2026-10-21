import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { automaticTravelInputKey } from '../core/travel-inputs.mjs';

// Use the conservative travel proof boundary: every personal completion and
// explicit backlog value remains an input. Challenge satisfaction is overlaid
// afterwards. In particular we do not infer that a completed ordinary-looking
// row is harmless: it can seed training, processing, items or access elsewhere.
export function eligibilityInputKey(state, memberId, options) {
  // With sharing and typed travel disabled, another member cannot supply access,
  // training or items. Keep roster identity/order for explanations and overlays.
  const independent = state.rules?.['access.shared'] === false
    && state.rules?.['travel.automatic'] !== true && state.rules?.['access.transport'] !== true;
  const input = independent ? { ...state, members: state.members.map(member => member.id === memberId ? member
    : { id: member.id, name: member.name, sourceMapId: member.sourceMapId }) } : state;
  return createHash('sha256').update(automaticTravelInputKey(input)).update(JSON.stringify([memberId, options ?? null])).digest('hex');
}

// Retain bytes instead of allocating a second full graph on every cold miss.
// Decoding on a hit still gives callers private, mutable rows. Keep engine facts
// explicitly: neither structured cloning nor V8 serialization keeps descriptors.
function retainResult(result) {
  return serialize({ result, processing: result.processing,
    primary: result.tasks.map(row => row.processingPrimary),
    metrics: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(result.metrics))
      .filter(([, descriptor]) => !descriptor.enumerable)) });
}

function copyResult(bytes) {
  const copy = deserialize(bytes);
  if (copy.processing !== undefined) Object.defineProperty(copy.result, 'processing', { value: copy.processing });
  copy.result.tasks.forEach((row, index) => {
    if (copy.primary[index] !== undefined) Object.defineProperty(row, 'processingPrimary', { value: copy.primary[index] });
  });
  Object.defineProperties(copy.result.metrics, copy.metrics);
  return copy.result;
}

export function applyCompletionOverlay(result, state, memberId) {
  const member = state.members.find(owner => owner.id === memberId);
  const scope = state.rules?.['tasks.completion'] ?? 'any';
  const owners = scope === 'personal' ? [member] : state.members;
  const completed = new Map(owners.map(owner => [owner, new Set(owner.completedTasks ?? [])]));
  for (const row of result.tasks) {
    const done = owner => completed.get(owner).has(row.id) || !!owner.taskStatus?.[row.id]?.challengeCompleted;
    row.challengeSatisfied = scope === 'all' ? owners.every(done) : owners.some(done);
  }
  return result;
}

export function createEligibilityCache({ limit = 2 } = {}) {
  const entries = new Map();
  return {
    evaluate(state, memberId, options, compute) {
      // Automatic travel already owns an exact, bounded baseline cache. Avoid
      // retaining and cloning the same large capability proof a second time.
      if (options?.reuseEligibility === false) {
        const result = compute();
        Object.defineProperty(result.metrics, 'eligibilityCacheHit', { value: false });
        return applyCompletionOverlay(result, state, memberId);
      }
      const key = eligibilityInputKey(state, memberId, options);
      const cached = entries.get(key);
      let result;
      if (cached) {
        entries.delete(key); entries.set(key, cached);
        result = copyResult(cached);
      } else {
        // Release the oldest retained proof before computing a new one.
        if (entries.size >= limit) entries.delete(entries.keys().next().value);
        result = compute();
        entries.set(key, retainResult(result));
        while (entries.size > limit) entries.delete(entries.keys().next().value);
      }
      Object.defineProperty(result.metrics, 'eligibilityCacheHit', { value: !!cached });
      return applyCompletionOverlay(result, state, memberId);
    },
  };
}
