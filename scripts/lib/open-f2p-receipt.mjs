import { createHash } from 'node:crypto';

// Hash source facts, not transport details. Historical cache envelopes remain
// readable; request grouping, JSON whitespace and incidental API metadata do
// not affect this receipt. Preserve the exact Wiki text, including Lua data.
export function canonicalWikiReceipt(cached) {
  const page = cached?.page, revision = page?.revisions?.[0], main = revision?.slots?.main;
  if (typeof cached?.requestedTitle !== 'string' || !cached.requestedTitle
    || typeof page?.title !== 'string' || !page.title
    || !Number.isSafeInteger(revision?.revid) || revision.revid < 1
    || !['wikitext', 'Scribunto'].includes(main?.contentmodel) || typeof main.content !== 'string') {
    throw new Error('Wiki receipt requires a titled, pinned wikitext or Scribunto revision.');
  }
  return { requestedTitle: cached.requestedTitle, title: page.title, revision: revision.revid,
    contentmodel: main.contentmodel, content: main.content };
}

export const wikiReceiptSha256 = cached => createHash('sha256')
  .update(JSON.stringify(canonicalWikiReceipt(cached))).digest('hex');
