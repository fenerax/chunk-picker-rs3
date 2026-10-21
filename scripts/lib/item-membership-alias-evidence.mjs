import { normalizeItemMembershipName } from '../../app/data/item-membership-index.mjs';

/** All balanced Item infoboxes, excluding NPC/Recipe IDs and nested templates. */
function wikiTemplateFacts(page,kind) {
  const revision=page.revisions?.[0],text=revision?.slots?.main?.content??revision?.slots?.main?.['*']??'',boxes=[];
  const pattern=new RegExp(`\\{\\{Infobox ${kind}\\s*[\\n|]`,'gi');
  for(let match;(match=pattern.exec(text));){
    const start=match.index;let depth=0,end=start,closed=false,outer='';
    for(;end<text.length-1;end++){
      const pair=text.slice(end,end+2);
      if(pair==='{{'){if(depth===1)outer+='[nested-template]';depth++;end++;}
      else if(pair==='}}'){depth--;end++;if(!depth){end++;closed=true;break;}}
      else if(depth===1)outer+=text[end];
    }
    if(!closed)return {title:page.title,revid:revision?.revid??null,timestamp:revision?.timestamp??null,reason:'unclosed-item-infobox',boxes:[]};
    pattern.lastIndex=end;
    const fields=new Map([...outer.matchAll(/^\|\s*(id\d*|members\d*|name\d*|version\d*)\s*=\s*([^\n]*)/gmi)].map(m=>[m[1].toLowerCase(),m[2].trim()]));
    const bool=value=>/^(yes|true)$/i.test(value??'')?true:/^(no|false)$/i.test(value??'')?false:null;
    const variants=[...fields].filter(([key])=>key.startsWith('id')).flatMap(([key,value])=>{
      if(!/^\d+(?:\s*,\s*\d+)*$/.test(value))return [];
      const suffix=key.slice(2),memberField=fields.has(`members${suffix}`)?`members${suffix}`:'members';
      const nameField=fields.has(`name${suffix}`)?`name${suffix}`:'name';
      return value.split(',').map(id=>({id:Number(id),members:bool(fields.get(memberField)),memberField,
        wikiName:fields.get(nameField)??null,version:fields.get(`version${suffix}`)??null}));
    });
    boxes.push({ordinal:boxes.length,fields:Object.fromEntries(fields),variants});
  }
  return {title:page.title,pageid:page.pageid??null,revid:revision?.revid??null,timestamp:revision?.timestamp??null,
    url:revision?`https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision.revid}`:null,
    reason:page.missing?'missing-page':boxes.length?`${kind.toLowerCase()}-infobox`:`no-${kind.toLowerCase()}-infobox`,boxes};
}

export const wikiAliasItemFacts = page => wikiTemplateFacts(page,'Item');
export const wikiCurrencyEntityFacts = page => wikiTemplateFacts(page,'Currency');

/** IDs establish identity. No substring/name edit supplies a membership flag. */
export function resolveWikiItemAlias(name,facts,rawById,{cacheNames,ids}={}) {
  let variants=facts.boxes.flatMap(box=>box.variants.map(v=>({...v,infobox:box.ordinal})));
  if(ids)variants=variants.filter(v=>ids.includes(v.id));
  if(cacheNames)variants=variants.filter(v=>cacheNames.includes(rawById.get(v.id)?.definition?.name));
  const rejected=[],selected=[];
  for(const variant of variants){
    const raw=rawById.get(variant.id)?.definition;
    if(!raw?.name){rejected.push({id:variant.id,reason:'missing-cache-id-or-name'});continue;}
    if(['noteTemplate','noteTemplate_old','loanTemplate','loanTemplate_old','bindTemplate','bindTemplate_old','combine_template','combine_template_old'].some(k=>raw[k]!==undefined)){
      rejected.push({id:variant.id,reason:'template'});continue;
    }
    if(variant.members===null){rejected.push({id:variant.id,reason:'unknown-wiki-members'});continue;}
    if(raw.members!==undefined && typeof raw.members!=='boolean')throw new Error(`Invalid raw members flag ${variant.id}`);
    if((raw.members===true)!==variant.members){rejected.push({id:variant.id,reason:'cache-wiki-disagreement',cacheMembers:raw.members===true,wikiMembers:variant.members});continue;}
    selected.push({...variant,cacheName:normalizeItemMembershipName(raw.name),cacheMembers:raw.members===true});
  }
  if(rejected.length||!selected.length)return {name,status:'unknown',reason:rejected.length?'rejected-explicit-id':'no-explicit-item-ids',rejected,selected};
  if(new Set(selected.map(v=>v.members)).size!==1)return {name,status:'unknown',reason:'mixed-wiki-members',rejected,selected};
  return {name,status:selected[0].members?'members':'free',members:selected[0].members,reason:'pinned-wiki-alias-item-ids',
    ids:[...new Set(selected.map(v=>v.id))].sort((a,b)=>a-b),cacheNames:[...new Set(selected.map(v=>v.cacheName))].sort(),selected,
    wiki:{title:facts.title,pageid:facts.pageid,revid:facts.revid,timestamp:facts.timestamp,url:facts.url}};
}
