import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/item-membership.2026-10-08.v1.json");
import { createItemMembershipLookup } from './item-membership-index.mjs';
import { itemMembershipAlias,itemMembershipAliasCatalogue } from './item-membership-aliases.mjs';
const entities = await datasetJSON("app/data/picker-entities.2026-10-08.v1.json");
import { normalizeItemMembershipName } from './item-membership-index.mjs';
import { itemMembershipReview,itemMembershipReviewCatalogue } from './item-membership-review.mjs';
export { itemMembershipReviewCatalogue } from './item-membership-review.mjs';
export { itemMembershipAliasCatalogue } from './item-membership-aliases.mjs';
export { buildItemMembershipIndex, normalizeItemMembershipName } from './item-membership-index.mjs';

export const itemMembershipCatalogue = catalogue;
export const pickerEntityMembershipCatalogue = entities;
const lookups = new WeakMap();
const entityIndexes = new WeakMap();
/** Caller supplies a clean exact item name, not a picker task label. */
export function itemMembership(name, { catalogue = itemMembershipCatalogue,
  aliases = catalogue === itemMembershipCatalogue ? itemMembershipAliasCatalogue : null,
  reviews = catalogue === itemMembershipCatalogue ? itemMembershipReviewCatalogue : null } = {}) {
  let lookup = lookups.get(catalogue);
  if (!lookup) { lookup = createItemMembershipLookup(catalogue.entries ?? []); lookups.set(catalogue,lookup); }
  const result=lookup(name);
  const review=itemMembershipReview(name,{catalogue:reviews,physical:true});
  if(review)return {...result,status:review.status,members:review.members,reason:review.reason,
    resolvedIds:review.ids,wiki:review.wiki,availability:review.availability,review,
    candidateIds:[...new Set([...result.candidateIds,...review.ids])].sort((a,b)=>a-b)};
  if(result.members!==null||result.reason==='cache-wiki-disagreement')return result;
  const alias=itemMembershipAlias(name,{catalogue:aliases});
  if(!alias||typeof alias.members!=='boolean')return result;
  return {...result,status:alias.members?'members':'free',members:alias.members,reason:'pinned-wiki-alias-item-ids',
    resolvedIds:alias.ids,cacheNames:alias.cacheNames,wiki:alias.wiki,alias:alias.name,
    candidateIds:[...new Set([...result.candidateIds,...alias.ids])].sort((a,b)=>a-b)};
}

/** Picker selectors mix physical items with explicitly named virtual currency.
 * Equipment callers keep itemMembership; this helper preserves physical token
 * flags in its evidence while selecting the reviewed virtual entity identity. */
export function pickerEntityMembership(name,{catalogue=itemMembershipCatalogue,
  entities=catalogue===itemMembershipCatalogue?pickerEntityMembershipCatalogue:null,
  reviews=catalogue===itemMembershipCatalogue?itemMembershipReviewCatalogue:null,...options}={}) {
  const normalizedName=normalizeItemMembershipName(name);
  const review=itemMembershipReview(normalizedName,{catalogue:reviews});
  if(review&&['empty-outcome','method-capability','reward-bundle','experience-reward'].includes(review.kind))return {
    status:review.status,members:review.members,normalizedName,entityKind:review.kind,
    identity:'picker-entity',reason:review.reason,wiki:review.wiki,candidateIds:[],review,
  };
  let entry;
  if(entities){
    let index=entityIndexes.get(entities);
    if(!index){index=new Map((entities.entries??[]).map(row=>[row.name,row]));entityIndexes.set(entities,index);}
    entry=index.get(normalizedName);
  }
  if(entry?.kind==='currency'&&typeof entry.members==='boolean')return {
    status:entry.members?'members':'free',members:entry.members,normalizedName,entityKind:'currency',
    identity:'picker-entity',reason:entry.reason,wiki:entry.wiki,candidateIds:[],
    excludedPhysicalItems:entry.excludedPhysicalItems,
  };
  return itemMembership(name,{catalogue,reviews,...options});
}
