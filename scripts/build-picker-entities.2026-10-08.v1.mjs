import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './lib/provenance-hash.mjs';
import { wikiCurrencyEntityFacts } from './lib/item-membership-alias-evidence.mjs';

export function buildPickerEntities({raw,evidence,output}={}) {
  if(!raw||!evidence||!output)throw new Error('Specify --raw --evidence --output.');
  const rawBytes=readFileSync(raw),rows=JSON.parse(rawBytes).records,evidenceBytes=readFileSync(evidence),payload=JSON.parse(evidenceBytes);
  const page=Object.values(payload.query.pages).find(p=>p.title==='Slayer points');
  if(!page)throw new Error('Missing exact Slayer points canonical page');
  const facts=wikiCurrencyEntityFacts(page),box=facts.boxes[0];
  const text=page.revisions[0].slots.main.content??page.revisions[0].slots.main['*'];
  if(facts.boxes.length!==1||box.fields.name!=='Slayer points'||!/^no$/i.test(box.fields.members??''))throw new Error('Currency identity/membership not exact reviewed evidence');
  const freeAcquisitionEvidence=/Slayer points can be earned in \[\[free-to-play\]\] by completing tasks from \[\[Jacquelyn\]\]\./.exec(text)?.[0];
  if(!freeAcquisitionEvidence)throw new Error('Missing independent explicit F2P Jacquelyn acquisition evidence');
  const excludedPhysicalItems=rows.filter(r=>r.definition.name==='Slayer points').map(r=>({id:r.id,name:r.definition.name,members:r.definition.members===true,
    source:{major:19,minor:Math.floor(r.id/256),subid:r.id%256}}));
  if(!excludedPhysicalItems.some(r=>r.id===50250&&r.members===true))throw new Error('Expected physical token flag changed');
  const result={schemaVersion:1,id:'picker-entities:2026-10-08:v1',generatedAt:'2026-10-08',
    provenance:{rawSha256:sha256(rawBytes),evidence:{file:'incidental-output-review.json',sha256:sha256(evidenceBytes)}},
    policy:'Only exact reviewed virtual entities in the picker mixed selector domain. Currency membership and an explicit independent free acquisition statement must agree. Physical cache token membership remains separate and unchanged.',
    entries:[{name:'Slayer points',kind:'currency',members:false,status:'free',reason:'pinned-wiki-currency-entity',
      wiki:{title:facts.title,revid:facts.revid,timestamp:facts.timestamp,url:facts.url},
      fields:box.fields,freeAcquisitionEvidence,excludedPhysicalItems}],summary:{currencies:1}};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];console.log(JSON.stringify(buildPickerEntities(options).summary));}
