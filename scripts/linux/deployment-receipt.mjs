import path from 'node:path';
import { json, sha } from './files.mjs';
import { digestValue } from '../private-companion/release-identity.mjs';

// Receipt refusal is a read-only preflight, shared by both operator modes.
export async function reviewedDeploymentAdditions(evidence, pointer, current, candidate) {
  if (!evidence || evidence === '--stopped') return;
  const receipt = await json(evidence);
  if (receipt.previousPointerSha256 !== sha(current.pointerBytes) || receipt.candidateIdentity !== candidate.identity
    || path.resolve(receipt.pointer) !== path.resolve(pointer)) throw new Error('Staged deployment receipt changed.');
  if (receipt.savedIdentityAdditionsReviewed !== true || !Array.isArray(receipt.savedIdentityAdditions)
    || digestValue(receipt.savedIdentityAdditions) !== receipt.savedIdentityAdditionsDigest) {
    throw Object.assign(new Error('VPS additions require explicit review.'), { code: 'OPERATOR_ADDITIONS_REVIEW' });
  }
  return receipt.savedIdentityAdditions;
}
