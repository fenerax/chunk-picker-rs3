import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { catalogue, planFixture, random, digest, knownGaps, integer, syntheticWorld } from './model.mjs';

// No save/registry JSON is authored here. Only the harness manifest is serialized.
export async function generate(profile, directory) {
  const [{openRegistry},{openStore},{openInviteStore},{openPluginKeys},{createGroupState,applyCommand},
    {createRuleRegistry},{createTaskEngine},{buildWorld},{selectedDataset},{bindDatasetStorage}]=await Promise.all([
    import('../../../app/storage/registry.mjs'),import('../../../app/storage/store.mjs'),import('../../../app/storage/invites.mjs'),
    import('../../../app/plugin-keys.mjs'),import('../../../app/core/state.mjs'),import('../../../app/core/rules.mjs'),
    import('../../../app/tasks/engine.mjs'),import('../../../app/data/world.mjs'),import('../../../app/dataset-runtime.mjs'),import('../../../app/dataset-binding.mjs')]);
  const plan=planFixture(profile), data=catalogue(profile.catalogue), world=syntheticWorld(data,buildWorld), rules=createRuleRegistry();
  const engine=createTaskEngine(data), tasks=engine.catalogue.map(({id,label,category})=>({id,label,category}));
  const f=profile.fixture;
  integer(f.historyEvents,0,10000,'historyEvents'); integer(f.snapshots,0,1000,'snapshots'); integer(f.keysPerMember,0,3,'keysPerMember');
  const paths={registryDir:path.join(directory,'registry'),pickerRoot:path.join(directory,'pickers'),tombstoneDir:path.join(directory,'tombstones')};
  const legacy=path.join(directory,'legacy'); await mkdir(legacy,{recursive:true});
  const registry=await openRegistry({...paths,caps:profile.entityCaps});
  const manifest={schemaVersion:1,seed:profile.seed,planDigest:digest(plan),catalogueDigest:digest(data),datasetDigest:selectedDataset.digest,
    catalogueBytes:Buffer.byteLength(JSON.stringify(data)),engineCatalogueTasks:tasks.length,
    shape:profile.catalogue,groups:[],characters:0,logins:0,keys:0,gaps:knownGaps,setupApi:'offline registry/store/session/key APIs; no timed admission overrides'};
  let invites;
  try {
    // The legacy lock is held while its central session sidecar is open.
    await bindDatasetStorage(legacy,selectedDataset);
    const legacyStore=await openStore({dataDir:legacy,world,registry:rules,initialState:createGroupState([{id:'legacy1',name:'Synthetic legacy 1'},{id:'legacy2',name:'Synthetic legacy 2'}],rules)});
    try {
      invites=await openInviteStore({dataDir:legacy,masterToken:legacyStore.getAccessToken(),pickerRegistry:registry});
      for(const item of plan) {
        const owner=await registry.firstLogin('discord',`capacity-${profile.seed}-${item.index}-0`);
        await registry.reserveTransferMembers(owner.picker.id,item.members.map(m=>m.id));
        const accounts=[owner.account];
        for(let i=1;i<item.size;i++) {
          const account=await registry.ensureIdentity('discord',`capacity-${profile.seed}-${item.index}-${i}`);
          await registry.attachMembership(account.id,{pickerId:owner.picker.id,role:'player',memberId:item.members[i].id}); accounts.push(account);
        }
        let state=createGroupState(item.members,rules);
        state.provenance={dataset:{id:selectedDataset.datasetId,contractVersion:selectedDataset.datasetContractVersion,digest:selectedDataset.digest}};
        const chunks=Object.keys(data.chunks), rng=random(`${profile.seed}-${item.index}`);
        let tick=0;
        // Historical dates exercise ordinary retention/packing without changing its policy.
        const expectedTicks=item.size*(Math.max(1,Math.floor(chunks.length*f.unlockFraction))+6)+1+f.historyEvents+f.snapshots;
        const now=()=>Date.UTC(2026,9,1)+(tick-expectedTicks)*12*3600000;
        const apply=command=>{ tick++; state=applyCommand(state,command,{world,registry:rules,now:now(),random:rng}); };
        if(item.grown) {
          for(const member of item.members) {
            for(const chunkId of chunks.slice(0,Math.max(1,Math.floor(chunks.length*f.unlockFraction)))) apply({type:'set-chunk',memberId:member.id,chunkId,status:'unlocked'});
            apply({type:'set-skill-levels',memberId:member.id,skill:'Mining',passiveLevel:20+item.variant*15});
            apply({type:'add-task',task:{id:`custom:capacity-${member.id}`,category:'Custom',label:`Synthetic private task ${item.index}-${member.id}`,memberIds:[member.id]}});
            apply({type:'complete-task',memberId:member.id,taskId:`custom:capacity-${member.id}`,completed:true});
            apply({type:'add-task',task:{id:`custom:quest-${member.id}`,category:'Quest',label:'Synthetic quest',memberIds:[member.id]}});
            apply({type:'add-task',task:{id:`custom:item-${member.id}`,category:'Custom',label:'Synthetic item goal',memberIds:[member.id]}});
            apply({type:'apply-game-progress',memberId:member.id,fetchedAt:new Date(now()).toISOString(),skills:[{skill:'Mining',level:20+item.variant*15,xp:4470}],
              quests:[{taskId:`custom:quest-${member.id}`,title:'Synthetic quest'}],items:[{taskId:`custom:item-${member.id}`,title:'Synthetic item',gameItemId:1000000,evidence:'owned',seen:'Synthetic fixture observation'}]});
          }
          apply({type:'set-rule',ruleId:'access.shared',value:item.variant%2===0});
          apply({type:'set-rule',ruleId:'roll.neighborMode',value:item.variant<2?'accessible':'geometric'});
        }
        state.tasks=state.tasks.concat(structuredClone(tasks));
        const dataDir=registry.pickerDirectory(owner.picker.id); await bindDatasetStorage(dataDir,selectedDataset);
        const store=await openStore({dataDir,world,registry:rules,initialState:state,now,random:rng});
        let keys;
        const group={index:item.index,pickerId:owner.picker.id,grown:item.grown,variant:item.variant,members:[]};
        try {
          if(item.grown) {
            // A replacement creates the app's pinned recovery boundary.
            await store.replace({format:'rs3-chunk-picker',schemaVersion:1,state:store.getState()},store.getInfo().revision);
            for(let i=0;i<f.historyEvents;i++) { tick++; await store.command({type:'set-note',memberId:'owner',chunkId:chunks[i%chunks.length],note:`Synthetic history ${item.index}-${i}`},store.getInfo().revision); }
            for(let i=0;i<f.snapshots;i++) { tick++; await store.command({type:'set-note',memberId:'owner',chunkId:chunks[i%chunks.length],note:`Synthetic snapshot ${i}`},store.getInfo().revision); }
            await store.prepareSnapshot();
          }
          keys=await openPluginKeys({dataDir});
          for(const [i,member] of item.members.entries()) {
            const account=accounts[i], cookie='duo_access='+await invites.issuePickerSession(account.id,owner.picker.id,'discord');
            const issued=[];
            for(let k=0;k<f.keysPerMember;k++) {
              const {key}=await keys.create(member.id,`Synthetic key ${k+1}`,account.id);
              await registry.setCapability({kind:'plugin-key',hash:digest(key),pickerId:owner.picker.id,accountId:account.id,memberId:member.id}); issued.push(key); manifest.keys++;
            }
            group.members.push({memberId:member.id,cookie,key:issued[0]??null});
          }
          group.retention=store.getInfo().retention; group.retainedSnapshots=(await store.listBackups()).length;
          group.revision=store.getInfo().revision;
          group.stateDigest=digest(store.getState());
          group.taskIds=tasks.slice(0,100).map(task=>task.id);
        } finally { await keys?.close(); await store.close(); }
        manifest.groups.push(group); manifest.characters+=item.size; manifest.logins+=item.size;
        await writeFile(path.join(directory,'fixture-progress.json'),JSON.stringify({groups:manifest.groups.length,characters:manifest.characters}));
      }
    } finally { await invites?.close(); await legacyStore.close(); }
  } finally { await registry.close(); }
  // Synthetic capabilities are local to this disposable run; never embed them in results.
  await writeFile(path.join(directory,'fixture.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});
  return manifest;
}
