import { datasetJSON } from "../../dataset-runtime.mjs";
import { datasetValue } from "../../dataset-runtime.mjs";
import { selectedDefinitionOverlays } from '../selected-definition-overlays.mjs';
import { reviewedServiceVariant } from '../reviewed-service-variants.mjs';
const review = await datasetJSON("app/data/members-start-banks.2026-10-12.v1.json");

// Match a reviewed service's physical cache placement, rather than declaring
// every bank-shaped object in a reviewed chunk usable. Guilds and interiors
// are excluded until their exact service prerequisites/geometry are known.
const surfaceMembers = datasetValue("app/data/training/banking-destinations.mjs#surfaceMembers");
const surfaceFree = datasetValue("app/data/training/banking-destinations.mjs#surfaceFree");
const reviewed = new Map([...review.optionA, ...review.optionAF2PExtension].map(row => [row.chunkId, row]));
export const bankingServiceEvidence = datasetValue("app/data/training/banking-destinations.mjs#bankingServiceEvidence");

export function reviewedBankingService(placement) {
  const variant = reviewedServiceVariant(placement, selectedDefinitionOverlays.flatMap(row => row.bankingServices ?? []));
  if (variant) return variant;
  const base = String(placement.chunkId), key = placement.classKey;
  if (!/^facility:(?:bank-|deposit-box)/.test(key)) return null;
  if (base === '12597') {
    if (placement.objectId === 782) return { label: 'Varrock west bank', kind: 'bank', members: false, evidence: bankingServiceEvidence.review };
    return null; // 19230 is the members hard-Varrock Cooks' Guild bank.
  }
  if (base === '11317' && [66665, 66666, 66667, 66668].includes(placement.objectId))
    return { label: 'Taverley bank', kind: key === 'facility:deposit-box' ? 'deposit' : 'bank', members: false, evidence: bankingServiceEvidence.taverley };
  if (base === '12082' && placement.objectId === 36788)
    return { label: 'Port Sarim deposit box', kind: 'deposit', members: false, evidence: bankingServiceEvidence.deposit };
  if (!surfaceMembers.has(base) && !surfaceFree.has(base)) return null;
  // Only a deposit's independently reviewed variant is certified; a normal
  // bank review does not establish a nearby deposit's separate requirements.
  if (key === 'facility:deposit-box' && ![2045, 26969, 100242, 25937, 104428, 9398, 34755].includes(placement.objectId)) return null;
  return { label: `${reviewed.get(base)?.place ?? base} ${key === 'facility:deposit-box' ? 'deposit box' : 'bank'}`,
    kind: key === 'facility:deposit-box' ? 'deposit' : 'bank', members: !surfaceFree.has(base),
    ...(base === '16692' ? { quest: 'Visions of Havenhythe' } : {}), evidence: bankingServiceEvidence.review };
}
