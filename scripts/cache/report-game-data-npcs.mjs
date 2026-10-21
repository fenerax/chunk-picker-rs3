// Rebuild compact review and runtime identity index from the full local audit.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliOptions, writeDataset } from './game-data-common.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

export function compactNpcIndex(dataset,manifest,comparisonSha256) {
  const records=Object.fromEntries(dataset.records.map(row=>{
    const candidates=row.candidates.map(c=>({id:c.id,name:c.name,combatLevel:c.combatLevel,size:c.size,members:null,memberOptionsPresent:c.memberOptions.some(Boolean),morphTargetIds:c.morphTargetIds,stats:c.stats,lifePoints:null}));
    const values=new Set(candidates.map(c=>c.combatLevel));
    const consensusCombatLevel=candidates.length&&values.size===1&&candidates[0].combatLevel!==null?candidates[0].combatLevel:null;
    return [row.name,{status:row.status,candidates,consensusCombatLevel,consensusStatus:consensusCombatLevel===null?'unresolved':'all exact-name candidates agree; identity and active variant remain unverified',
      members:null,membershipStatus:'unavailable in pinned NPC schema',renameCandidates:row.renameCandidates,mutationAllowed:false}];
  }));
  return {schemaVersion:1,snapshot:'2026-10-08.v1',source:'copied RuneScape client cache; offline pinned decoder',
    reference:dataset.reference,decoder:{commit:dataset.decoder.commit,buildSchema:dataset.decoder.buildSchema},
    provenance:{comparisonSha256,comparisonHashScope:'raw external JSON bytes',manifestSources:manifest.sources,extractor:manifest.extractor},
    limits:dataset.limits,semantics:manifest.semantics,summary:dataset.summary,records};
}
export function reportNpcs({input,compact,review}) {
  const comparisonBytes=readFileSync(resolve(input,'npcs.comparison.v1.json')),dataset=JSON.parse(comparisonBytes);
  const manifestBytes=readFileSync(resolve(input,'npcs.manifest.v1.json')),manifest=JSON.parse(manifestBytes);
  const index=compactNpcIndex(dataset,manifest,sha256(comparisonBytes));
  const cohortExamples=Object.fromEntries(['Cow','Chicken','Hill giant','Lesser demon','Giant spider','Banker','Bob','Aris','Gypsy Aris'].map(name=>[name,index.records[name]??null]));
  const report={schemaVersion:1,snapshot:index.snapshot,summary:manifest.summary,semantics:manifest.semantics,limits:dataset.limits,
    provenance:{manifestSha256:sha256(manifestBytes),comparisonSha256:sha256(comparisonBytes),reference:dataset.reference,decoder:dataset.decoder,
      reportScriptSha256:sha256RepositoryText(readFileSync(import.meta.filename)),reportScriptHashScope:'repository text; CRLF normalized to LF'},
    samples:cohortExamples,renameCandidates:dataset.records.filter(r=>r.renameCandidates.length).map(r=>({name:r.name,origins:r.origins,candidates:r.renameCandidates,mutationAllowed:false})),
    unmatchedWithoutSuggestion:dataset.records.filter(r=>!r.candidateIds.length&&!r.renameCandidates.length).map(r=>({name:r.name,origins:r.origins}))};
  const written=[];
  if(compact)written.push(writeDataset(resolve(compact,'..'),resolve(compact).split(/[/\\]/).at(-1),index));
  if(review)written.push(writeDataset(resolve(review,'..'),resolve(review).split(/[/\\]/).at(-1),report));
  return {summary:report.summary,files:written};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(reportNpcs(cliOptions()),null,2));
