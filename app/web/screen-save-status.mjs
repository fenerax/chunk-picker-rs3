import { canSaveAddress } from './save-address.mjs';

// Live synchronization reports shared revisions; only the local attempt can
// clear a refused change or finish an in-flight save.
export function createSaveStatus(c) {
  let refused = false, saving = false;
  function saved(text, failed = false, revision, outcome = {}) {
    if (outcome.confirmed || outcome.resolved) { refused = false; saving = false; }
    if (text === 'Saving…') { refused = false; saving = true; }
    if (outcome.refused) { refused = true; saving = false; }
    const writable = c.canWrite(), pending = writable && c.hasPendingCommand?.();
    if (failed && !pending) saving = false;
    let status = failed ? 'failed' : 'saved';
    if (writable && !canSaveAddress()) {
      text = 'This address cannot save'; status = 'failed';
    } else if (pending && (c.pendingCommandPaused?.() || failed)) {
      text = c.pendingCommandPaused?.() ? 'Save not confirmed' : 'Save confirmation needed'; status = 'failed';
    } else if (refused) {
      text = 'Change refused · review'; status = 'failed';
    } else if (saving || pending) {
      text = 'Saving…'; status = 'saving';
    } else if (!writable && text === 'Saved') text = 'Live';
    const badge = c.$('save-status');
    badge.textContent = text; badge.dataset.status = status;
    badge.title = revision ? `Last confirmed revision ${revision}` : '';
  }
  c.reviewSaveRefusal = () => {
    if (!refused) return;
    refused = false; saved('Saved', false, c.state?.revision);
  };
  return saved;
}
