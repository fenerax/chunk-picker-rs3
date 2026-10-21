import { readFileSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './lib/provenance-hash.mjs';

const templateFields=['noteTemplate','noteTemplate_old','loanTemplate','loanTemplate_old','bindTemplate','bindTemplate_old','combine_template','combine_template_old'];
export function buildItemMembershipFlags({source,output}={}) {
  if(!source||!output)throw new Error('Specify --source --output.');
  const rawBytes=readFileSync(join(source,'items.raw.v1.json')),raw=JSON.parse(rawBytes);
  const manifestBytes=readFileSync(join(source,'items.manifest.v1.json')),manifest=JSON.parse(manifestBytes);
  const declared=manifest.outputs.find(row=>row.path.endsWith('/items.raw.v1.json'));
  if(declared?.sha256!==sha256(rawBytes))throw new Error('Raw membership manifest hash differs');
  const rows=raw.records.map(row=>{
    if(row.definition.members!==undefined&&typeof row.definition.members!=='boolean')throw new Error(`Invalid raw membership field ${row.id}`);
    const excluded=templateFields.filter(field=>row.definition[field]!==undefined);
    if(!row.definition.name)excluded.unshift('unnamed');
    return excluded.length?[row.id,row.definition.members===true,excluded]:[row.id,row.definition.members===true];
  }).sort((a,b)=>a[0]-b[0]);
  if(new Set(rows.map(row=>row[0])).size!==rows.length)throw new Error('Duplicate cache IDs');
  const templates=raw.records.filter(row=>templateFields.some(field=>row.definition[field]!==undefined));
  const result={schemaVersion:1,id:'item-membership-flags:2026-10-08:v1',generatedAt:'2026-10-08',
    provenance:{raw:{file:'items.raw.v1.json',sha256:sha256(rawBytes)},manifest:{file:'items.manifest.v1.json',sha256:sha256(manifestBytes)},decoder:raw.decoder},
    columns:['id','rawMembers','ordinaryNameExclusions (optional)'],
    policy:{flag:'Raw decoded opcode0x10 members=true; absence defaults false. This is an audit of every decoded ID, without name matching or Wiki identity resolution.',
      exclusions:'Unnamed IDs and all note/loan/bind/combine template fields stay in this table even though the ordinary-name resolver excludes them.',
      inheritance:'Template records carry their own raw opcode bits. No template inheritance is evaluated here. A false bit on an unnamed note/loan/bind/combine definition does not certify its linked ordinary item as free. Ordinary item names use the independently reviewed name/ID resolver.'},
    summary:{decodedIds:rows.length,rawMembersTrue:rows.filter(row=>row[1]).length,rawMembersFalse:rows.filter(row=>!row[1]).length,
      explicitlyFalseFields:raw.records.filter(row=>row.definition.members===false).length,
      unnamedIds:raw.records.filter(row=>!row.definition.name).length,templateIds:templates.length,
      namedTemplateIds:templates.filter(row=>row.definition.name).length,
      namedOrdinaryIds:raw.records.filter(row=>row.definition.name&&!templateFields.some(field=>row.definition[field]!==undefined)).length,
      unnamedNonTemplateIds:raw.records.filter(row=>!row.definition.name&&!templateFields.some(field=>row.definition[field]!==undefined)).length,
      templateFields:Object.fromEntries(templateFields.map(field=>[field,raw.records.filter(row=>row.definition[field]!==undefined).length]))},rows};
  writeFileSync(output,JSON.stringify(result)+'\n');return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];console.log(JSON.stringify(buildItemMembershipFlags(options).summary,null,2));}
