import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/item-membership-aliases.2026-10-08.v1.json");
import { normalizeItemMembershipName } from './item-membership-index.mjs';

export const itemMembershipAliasCatalogue = catalogue;
const indexes = new WeakMap();
/** Exact reviewed aliases only. Custom evidence never gains default aliases. */
export function itemMembershipAlias(name,{catalogue=itemMembershipAliasCatalogue}={}) {
  if(!catalogue)return null;
  let index=indexes.get(catalogue);
  if(!index){
    const exact=new Map((catalogue.entries??[]).map(entry=>[entry.name,entry])),folded=new Map();
    for(const entry of exact.values()){const key=entry.name.toLocaleLowerCase('en'),values=folded.get(key)??[];values.push(entry);folded.set(key,values);}
    index={exact,folded};indexes.set(catalogue,index);
  }
  const normalized=normalizeItemMembershipName(name),exact=index.exact.get(normalized);
  if(exact)return exact;
  const folded=index.folded.get(normalized.toLocaleLowerCase('en'))??[];
  return folded.length===1?folded[0]:null;
}
