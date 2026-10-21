import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceClasses, resolveResourceDefinition, buildSelectors } from '../scripts/cache/resource-catalogue.mjs';

const definition = (objectId, raw) => ({objectId,name:raw.name,classKeys:resourceClasses(raw)});

test('explicit additional cache materials keep distinct classes and spelling evidence',()=>{
  // Decoded IDs 104007/104009, 131808, 112896, 133400 and 136445.
  const definitions=[
    definition(104007,{name:'Bamboo',actions_0:'Chop down'}),
    definition(104009,{name:'Golden Bamboo',actions_0:'Chop down'}),
    definition(131808,{name:'Fir',actions_0:'Chop down'}),
    definition(112896,{name:'Blurite rock',actions_0:'Mine'}),
    definition(133400,{name:'Platinum rock',actions_0:'Mine'}),
    definition(136445,{name:'Havensilver rock',actions_0:'Mine'}),
  ];
  const reference={chunks:{1:{Object:{'Bamboo (tree)':1,'Golden bamboo (tree)':1,'Fir tree':1,'Blurite rock':1,'Platinum rock':1,'Havensilver rock':1,'Iron rock':1}}}};
  const {mappings,unmatched}=buildSelectors(reference,definitions);
  const classes=name=>mappings.find(r=>r.name===name)?.classKeys;
  assert.deepEqual(classes('Bamboo (tree)'),['tree:bamboo']);
  assert.deepEqual(classes('Golden bamboo (tree)'),['tree:golden-bamboo']);
  assert.deepEqual(mappings.find(r=>r.name==='Golden bamboo (tree)').evidenceObjectIds,[104009]);
  assert.deepEqual(classes('Fir tree'),['tree:fir']);
  assert.deepEqual(classes('Blurite rock'),['ore:blurite']);
  assert.deepEqual(classes('Platinum rock'),['ore:platinum']);
  assert.deepEqual(classes('Havensilver rock'),['ore:havensilver']);
  assert.equal(unmatched.find(r=>r.name==='Iron rock').reason,'no-action-supported-definition-class');
  assert.deepEqual(resourceClasses({name:'Fir',actions_0:'Inspect'}),[]);
  assert.deepEqual(resourceClasses({name:'Tangle gum tree',actions_0:'Chop'}),['tree:tangle-gum']);
  assert.deepEqual(resourceClasses({name:'Grave creeper tree',actions_0:'Chop'}),['tree:grave-creeper']);
  assert.deepEqual(resourceClasses({name:'Kratonite ore',actions_0:'Mine'}),['ore:kratonite']);
  assert.deepEqual(resourceClasses({name:'Shadow animica rock',actions_0:'Mine'}),['ore:shadow-animica']);
});

test('new facilities require relevant actions and keep specialized activity names separate',()=>{
  assert.deepEqual(resourceClasses({name:'Counter',actions_0:'Bank'}),['facility:bank-other:counter']);
  assert.deepEqual(resourceClasses({name:'Gear crate',actions_0:'Bank'}),['facility:bank-other:gear-crate']);
  assert.deepEqual(resourceClasses({name:'Counter',actions_0:'Steal-from'}),[]);
  assert.deepEqual(resourceClasses({name:'Oven',actions_0:'Cook at'}),['facility:cooking-oven:oven']);
  assert.deepEqual(resourceClasses({name:'Oven',actions_0:'Study'}),[]);
  assert.deepEqual(resourceClasses({name:'Gnome cooker',actions_0:'Cook-at'}),['facility:cooking-station:gnome-cooker']);
  assert.deepEqual(resourceClasses({name:'Fremennik Furnace',actions_0:'Smelt'}),['facility:furnace:fremennik-furnace']);
  assert.deepEqual(resourceClasses({name:'Chaos altar',actions_0:'Pray-at'}),['facility:altar:chaos-altar']);
  assert.deepEqual(resourceClasses({name:'Fletching workbench',actions_0:'Craft'}),['facility:workbench:fletching-workbench']);
  assert.deepEqual(resourceClasses({name:'Temporary bank chest',actions_0:'Bank'}),[]);
});

test('qualified trees and ores cannot witness ordinary typed selectors',()=>{
  const fixtures=[
    [131907,'Eternal magic tree','Chop down','tree:magic:eternal-magic-tree'],
    [37821,'Cursed magic tree','Chop down','tree:magic:cursed-magic-tree'],
    [136421,'Dead oak','Chop down','tree:oak:dead-oak'],
    [1,'Evil oak tree','Chop','tree:oak:evil-oak-tree'],
    [112947,"'Perfect' gold rock",'Mine','ore:gold:perfect-gold-rock'],
    [112996,'Soft clay rock','Mine','ore:clay:soft-clay-rock'],
    [133406,'Porcelain clay rock','Mine','ore:clay:porcelain-clay-rock'],
    [2,'Concentrated gold deposit','Mine','ore:gold:concentrated-gold-deposit'],
  ];
  const definitions=fixtures.map(([id,name,action,key])=>{
    const row=definition(id,{name,actions_0:action});
    assert.deepEqual(row.classKeys,[key]);return row;
  });
  const reference={chunks:{1:{Object:Object.fromEntries([...fixtures.map(([,name])=>[name,1]),...['Magic tree','Oak','Gold rock','Clay rock'].map(name=>[name,1])])}}};
  const {mappings,unmatched,reviewedAliases}=buildSelectors(reference,definitions);
  assert.equal(mappings.length,fixtures.length);
  assert.equal(reviewedAliases.length,0);
  for(const name of ['Magic tree','Oak','Gold rock','Clay rock'])assert.ok(unmatched.some(r=>r.name===name));
  const withOrdinary=buildSelectors(reference,[...definitions,definition(3,{name:'Magic',actions_0:'Chop down'})]);
  assert.deepEqual(withOrdinary.mappings.find(r=>r.name==='Magic tree').classKeys,['tree:magic']);
  assert.deepEqual(withOrdinary.mappings.find(r=>r.name==='Magic tree').evidenceObjectIds,[3]);
  assert.deepEqual(withOrdinary.mappings.find(r=>r.name==='Eternal magic tree').classKeys,['tree:magic:eternal-magic-tree']);
});

test('fixed fishing and hunter scenery cannot certify fish yields or other scenery meanings',()=>{
  const definitions=[
    definition(74307,{name:'Fishing hole',actions_0:'Fish'}),
    definition(19337,{name:'Rabbit burrow',actions_0:'Flush'}),
    definition(136978,{name:'Jackalope burrow',actions_0:'Flush'}),
    definition(109405,{name:'Rockodile',actions_0:'Set trap'}),
    definition(19205,{name:'Boulder',actions_0:'Set-trap'}),
  ];
  const reference={chunks:{1:{Object:{'Fishing hole':1,'Fishing spot (crayfish)':1,'Rabbit burrow':1,'Jackalope burrow':1,'Rockodile':1,'Boulder':1}}}};
  const {mappings,unmatched}=buildSelectors(reference,definitions);
  assert.deepEqual(mappings.find(r=>r.name==='Fishing hole').classKeys,['facility:static-fishing:fishing-hole']);
  assert.deepEqual(mappings.find(r=>r.name==='Rabbit burrow').classKeys,['facility:hunter-burrow:rabbit-burrow']);
  assert.ok(mappings.some(r=>r.name==='Jackalope burrow'));
  assert.ok(mappings.some(r=>r.name==='Rockodile'));
  assert.equal(unmatched.find(r=>r.name==='Fishing spot (crayfish)').reason,'no-action-supported-definition-class');
  assert.equal(unmatched.find(r=>r.name==='Boulder').reason,'same-name-scenery-needs-identity-review');
  assert.deepEqual(resourceClasses({name:'Burrow',actions_0:'Inspect'}),[]);
  assert.deepEqual(resourceClasses({name:'Rabbit burrow',actions_0:'Enter'}),[]);
  assert.deepEqual(resourceClasses({name:'Divine crayfish bubble',actions_0:'Fish'}),[]);
});

test('generic facility and material selectors remain review-only even in explicit aliases or objectItems',()=>{
  const definitions=[
    definition(12309,{name:'Chest',actions_0:'Bank'}),
    definition(2012,{name:'Counter',actions_0:'Bank'}),
    definition(12683,{name:'Gear crate',actions_0:'Bank'}),
    definition(1,{name:'Tree',actions_0:'Chop down'}),
    definition(2,{name:'Rocks',actions_0:'Mine'}),
    definition(3,{name:'Yew',actions_0:'Chop down'}),
  ];
  const reference={objectItems:{Chest:{Coins:true},'Yew tree':{'Yew logs':true},Tree:{Logs:true},Rocks:{Ore:true}},codeItems:{objectsPlus:{'Storage[+]':['Chest','Counter','Gear crate']}}};
  const {mappings,unmatched,reviewedAmbiguities}=buildSelectors(reference,definitions);
  const alias=mappings.find(r=>r.name==='Storage[+]');
  assert.deepEqual(alias.classKeys,['facility:bank-other:gear-crate']);
  assert.deepEqual(alias.unmatchedChildren,['Chest','Counter']);
  assert.deepEqual(mappings.find(r=>r.name==='Yew tree').evidenceObjectIds,[3]);
  assert.equal(unmatched.find(r=>r.name==='Tree').reason,'generic-resource-type-needs-explicit-evidence');
  assert.equal(unmatched.find(r=>r.name==='Rocks').reason,'generic-resource-type-needs-explicit-evidence');
  assert.equal(unmatched.find(r=>r.name==='Chest').reason,'same-name-scenery-needs-identity-review');
  assert.deepEqual(reviewedAmbiguities.find(r=>r.name==='Chest').evidenceObjectIds,[2079,12309]);
});

test('renderer defaults and crop or trap branches never substitute for present identical morph leaves',()=>{
  const defs=new Map([
    [1,{name:'Fir',morphs_1:{varbit:7,varp:65535,options:[2],default:3}}],
    [2,{name:'Fir',actions_0:'Chop down',width:2}],
    [3,{name:'Fir tree',actions_0:'Chop down',width:2}],
  ]);
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,['tree:fir']);
  defs.get(1).morphs_1.default=65535;
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  assert.equal(resolveResourceDefinition(1,defs).policy,'conditional-review');
  defs.get(1).morphs_1.default=3;
  defs.get(3).width=3;
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  defs.set(3,{name:'Tree stump',actions_0:'Clear',width:2});
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  defs.set(2,{name:'Young tree',actions_0:'Set-trap'});
  defs.set(3,{name:'Young tree',actions_0:'Dismantle'});
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  defs.set(2,{name:'Herb patch',actions_0:'Rake'});
  defs.set(3,{name:'Herbs',actions_0:'Pick'});
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
  defs.delete(3);
  assert.deepEqual(resolveResourceDefinition(1,defs).classKeys,[]);
});
