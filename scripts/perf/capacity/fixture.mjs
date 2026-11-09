import path from 'node:path';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { catalogue, planFixture, random, digest, knownGaps, integer, syntheticWorld } from './model.mjs';
import { growthCommands, fixtureProgress } from './growth.mjs';

// No save/registry JSON is authored here. Only the harness manifest is serialized.
export async function generate(profile, directory) {
  const started = performance.now();
  const publish = fixtureProgress(async progress => {
    const filename = path.join(directory, 'fixture-progress.json');
    await writeFile(filename + '.tmp', JSON.stringify({ ...progress, elapsedMs: performance.now() - started }));
    await rename(filename + '.tmp', filename);
  });
  let groups = 0, characters = 0;
  const progress = update => publish({ groups, characters, ...update });
  await progress({ phase: 'catalogue', completed: 0, total: 1 });
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
  manifest.growthMode = 'one real replace-member batch unlock per member; no per-chunk growth History';
  manifest.initializationMs = performance.now() - started;
  let invites;
  try {
    // The legacy lock is held while its central session sidecar is open.
    await bindDatasetStorage(legacy,selectedDataset);
    const legacyStore=await openStore({dataDir:legacy,world,registry:rules,initialState:createGroupState([{id:'legacy1',name:'Synthetic legacy 1'},{id:'legacy2',name:'Synthetic legacy 2'}],rules)});
    try {
      invites=await openInviteStore({dataDir:legacy,masterToken:legacyStore.getAccessToken(),pickerRegistry:registry});
      for(const item of plan) {
        const groupStarted = performance.now();
        const step = update => progress({ groupIndex: item.index, rosterSize: item.size, grown: item.grown, ...update });
        await step({ phase: 'registry', completed: 0, total: item.size });
        const owner=await registry.firstLogin('discord',`capacity-${profile.seed}-${item.index}-0`);
        await registry.reserveTransferMembers(owner.picker.id,item.members.map(m=>m.id));
        const accounts=[owner.account];
        for(let i=1;i<item.size;i++) {
          const account=await registry.ensureIdentity('discord',`capacity-${profile.seed}-${item.index}-${i}`);
          await registry.attachMembership(account.id,{pickerId:owner.picker.id,role:'player',memberId:item.members[i].id}); accounts.push(account);
        }
        await step({ phase: 'registry', completed: item.size, total: item.size });
        let state=createGroupState(item.members,rules);
        state.provenance={dataset:{id:selectedDataset.datasetId,contractVersion:selectedDataset.datasetContractVersion,digest:selectedDataset.digest}};
        const chunks=Object.keys(data.chunks), rng=random(`${profile.seed}-${item.index}`);
        let tick=0;
        // Historical dates exercise ordinary retention/packing without changing its policy.
        const expectedTicks=item.size*(Math.max(1,Math.floor(chunks.length*f.unlockFraction))+6)+1+f.historyEvents+f.snapshots;
        const now=()=>Date.UTC(2026,9,1)+(tick-expectedTicks)*12*3600000;
        const growthStarted = performance.now();
        let growthCount = 0;
        if(item.grown) {
          const total = item.size * 7 + 2;
          for(const {command, ticks = 1} of growthCommands(state, item, chunks, f, now)) {
            await step({ phase: 'growth', completed: growthCount, total, commandType: command.type });
            // Preserve the old logical fixture dates despite batching unlocks.
            tick += ticks;
            state = applyCommand(state, command, { world, registry: rules, now: now(), random: rng });
            growthCount++;
            await step({ phase: 'growth', completed: growthCount, total });
          }
        }
        const growthMs = performance.now() - growthStarted;
        state.tasks=state.tasks.concat(structuredClone(tasks));
        const dataDir=registry.pickerDirectory(owner.picker.id); await bindDatasetStorage(dataDir,selectedDataset);
        await step({ phase: 'open-store', completed: 0, total: 1 });
        const durableStarted = performance.now();
        const store=await openStore({dataDir,world,registry:rules,initialState:state,now,random:rng});
        let keys;
        const group={index:item.index,pickerId:owner.picker.id,grown:item.grown,variant:item.variant,members:[]};
        try {
          if(item.grown) {
            // A replacement creates the app's pinned recovery boundary.
            await step({ phase: 'replacement', completed: 0, total: 1 });
            await store.replace({format:'rs3-chunk-picker',schemaVersion:1,state:store.getState()},store.getInfo().revision);
            for(const [phase, count] of [['history', f.historyEvents], ['snapshots', f.snapshots]]) {
              for(let i=0;i<count;i++) {
                await step({ phase, completed: i, total: count, commandType: 'set-note' });
                tick++;
                await store.command({type:'set-note',memberId:'owner',chunkId:chunks[i%chunks.length],note:phase === 'history' ? `Synthetic history ${item.index}-${i}` : `Synthetic snapshot ${i}`},store.getInfo().revision);
                await step({ phase, completed: i + 1, total: count });
              }
            }
            await step({ phase: 'prepare-snapshot', completed: 0, total: 1 });
            await store.prepareSnapshot();
          }
          group.durableMs = performance.now() - durableStarted;
          await step({ phase: 'sessions-keys', completed: 0, total: item.size });
          keys=await openPluginKeys({dataDir});
          for(const [i,member] of item.members.entries()) {
            const account=accounts[i], cookie='duo_access='+await invites.issuePickerSession(account.id,owner.picker.id,'discord');
            const issued=[];
            for(let k=0;k<f.keysPerMember;k++) {
              const {key}=await keys.create(member.id,`Synthetic key ${k+1}`,account.id);
              await registry.setCapability({kind:'plugin-key',hash:digest(key),pickerId:owner.picker.id,accountId:account.id,memberId:member.id}); issued.push(key); manifest.keys++;
            }
            group.members.push({memberId:member.id,cookie,key:issued[0]??null});
            await step({ phase: 'sessions-keys', completed: i + 1, total: item.size });
          }
          group.retention=store.getInfo().retention; group.retainedSnapshots=(await store.listBackups()).length;
          group.revision=store.getInfo().revision;
          const savedState = store.getState();
          group.stateDigest=digest(savedState);
          group.stateBytes = Buffer.byteLength(JSON.stringify(savedState));
          group.taskIds=tasks.slice(0,100).map(task=>task.id);
        } finally { await keys?.close(); await store.close(); }
        group.setupMs = performance.now() - groupStarted;
        group.growthMs = growthMs; group.growthCommands = growthCount;
        manifest.groups.push(group); manifest.characters+=item.size; manifest.logins+=item.size;
        groups = manifest.groups.length; characters = manifest.characters;
        await step({ phase: 'group-complete', completed: 1, total: 1 });
      }
    } finally { await invites?.close(); await legacyStore.close(); }
  } finally { await registry.close(); }
  // Synthetic capabilities are local to this disposable run; never embed them in results.
  await writeFile(path.join(directory,'fixture.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});
  await progress({ phase: 'complete', completed: groups, total: plan.length });
  return manifest;
}
