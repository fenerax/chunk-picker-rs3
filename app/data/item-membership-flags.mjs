import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/item-membership-flags.2026-10-08.v1.json");

export const rawItemMembershipCatalogue=catalogue;
const rows=new Map(catalogue.rows.map(row=>[row[0],row]));
/** Audit raw bits by numeric ID; this does not interpret template inheritance. */
export function rawItemMembership(id) {
  const row=rows.get(Number(id));if(!row)return null;
  const exclusions=row[2]??[];
  return {id:row[0],rawMembers:row[1],namePresent:!exclusions.includes('unnamed'),
    templateFields:exclusions.filter(field=>field!=='unnamed'),ordinaryNameExclusions:exclusions};
}
