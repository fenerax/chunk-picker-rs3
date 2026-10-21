import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import data from '../app/data/training/mining-rates.v1.json' with {type:'json'};
import { MINING_ROCKS, MINING_PICKAXES, MINING_PROFILES, lookupMiningRate } from '../app/training/mining-rates.mjs';
import { generateMiningCatalogue, CRITICAL_LEVELS } from '../scripts/training/mining-generate.mjs';
import { wikiMiningReference } from '../scripts/training/mining-wiki-reference.mjs';
const rate = args => lookupMiningRate(args, data);
const close = (actual,expected,tolerance=1e-6) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} ≠ ${expected} (±${tolerance})`);

test('versioned catalogue regenerates deterministically and stays below 300KB gzip', async () => {
  assert.deepEqual(generateMiningCatalogue(),data);
  const json = await readFile(new URL('../app/data/training/mining-rates.v1.json',import.meta.url));
  assert.ok(gzipSync(json).length < 300_000);
  for(const source of data.sources.filter(s=>s.oldid)) assert.ok(source.url.endsWith(`oldid=${source.oldid}`));
});

test('independent reference retains the pinned source subset and article discrepancy evidence', async () => {
  const module=JSON.parse(await readFile(new URL('./fixtures/mining/mining-module.37179407.json',import.meta.url),'utf8'));
  assert.equal(module.oldid,37179407);
  assert.ok(module.excerpts.join('\n').includes('local net_crit_bonus = crit_bonus + net_hardness'));
  const article=JSON.parse(await readFile(new URL('./fixtures/mining/mining-mechanics.37194674.json',import.meta.url),'utf8'));
  assert.ok(article.excerpts.join('\n').includes('15% at level 59 Mining, and to 20% at level 85'));
});

test('independent pinned wiki module: common-convention grid matches within mean-XP rounding', () => {
  let count=0, worstXp=0, worstOre=0;
  for(const rock of MINING_ROCKS) for(const pick of MINING_PICKAXES) {
    if(pick.penetration < rock.hardness) continue;
    for(const level of [...new Set([rock.level,pick.level,...rock.critLevels,...rock.doubleOreLevels,30,40,50,58])]) {
      if(level < Math.max(rock.level,pick.level) || level >=59) continue;
      const bonus=CRITICAL_LEVELS.filter(n=>n<=level).length*5;
      for(const strength of [1,30,99]) {
        // Above-cap or stamina-unlock differences have their own exact tests.
        if(level+Math.floor(strength/10)+pick.maxDamage+bonus>rock.durability) continue;
        for(const profile of MINING_PROFILES) {
          if(level<15 && profile.id!=='active') continue;
          const args={rockId:rock.id,pickaxeId:pick.id,miningLevel:level,strengthLevel:strength,profileId:profile.id};
          const ours=rate(args), reference=wikiMiningReference(args);
          const xpError=Math.abs(ours.xpPerHour-reference.xpPerHour), oreError=Math.abs(ours.orePerHour-reference.orePerHour);
          close(ours.xpPerHour,reference.xpPerHour,150*ours.staminaMultiplier+.03);
          close(ours.orePerHour,reference.orePerHour,.003);
          worstXp=Math.max(worstXp,xpError); worstOre=Math.max(worstOre,oreError); count++;
        }
      }
    }
  }
  assert.ok(count>=500);
  console.log(`Wiki common grid ${count}: worst XP/hour delta ${worstXp.toFixed(6)} (<=150*stamina+.03); ore/hour ${worstOre.toFixed(6)} (<=.003).`);
});

test('uniform rolls cap progress individually and carry over, with uncapped XP', () => {
  // Level20/Strength1 iron: normal25..35 (11 rolls), critical55..65.
  // Copper40: normal mean30, crit progress40 (rather than mean cap).
  const args={rockId:'copper',pickaxeId:'iron',miningLevel:20,strengthLevel:1};
  const ours=rate(args), reference=wikiMiningReference(args);
  close(ours.damagePerSwing,35); close(ours.xpPerHour,13860);
  close(ours.orePerHour,1320); // (.8*30+.2*40)/40 *1500*1.1
  close(reference.orePerHour,1443.75);
  close(ours.swingsPerOre,1.25);
  const partial=rate({...args,profileId:'occasional'});
  close(partial.orePerHour,1221); // normal27, critical cap40; expected29.6
  const afk=rate({...args,profileId:'afk'});
  close(afk.orePerHour,288.75); // uncapped: expected7 damage, progress carries over
  assert.ok(ours.xpPerOre!==partial.xpPerOre);
});

test('global critical milestones differ from pinned calculator by known damage bonuses', () => {
  let count=0;
  for(const level of [59,60,84,85,87,99,100,104,105,110]) for(const profile of MINING_PROFILES) {
    const args={rockId:'runite',pickaxeId:'rune+3',miningLevel:level,strengthLevel:99,profileId:profile.id};
    const ours=rate(args),ref=wikiMiningReference(args);
    const critBonus=CRITICAL_LEVELS.filter(n=>n<=level).length*5;
    const chance=.2+(level>=59?.05:0)+(level>=85?.05:0);
    const documentedDamage=level+9+53+critBonus*chance;
    close(ours.damagePerSwing,documentedDamage*profile.staminaMultiplier);
    close(ours.xpPerHour,documentedDamage*.76*.4*1500*profile.staminaMultiplier,.03);
    close(ours.orePerHour,documentedDamage/600*1500*1.05*profile.staminaMultiplier,.003);
    const extraDamage=critBonus*chance-Math.min(100,critBonus)*.2;
    close(ours.damagePerSwing-ref.damagePerSwing,extraDamage*profile.staminaMultiplier);
    count++;
  }
  console.log(`Documented global critical differences: ${count} comparisons.`);
});

test('hardness is subtracted once per roll and minimum-one damage precedes stamina', () => {
  const args={rockId:'mithril',pickaxeId:'bronze',miningLevel:30,strengthLevel:30};
  const ours=rate(args),ref=wikiMiningReference(args);
  close(ours.damagePerSwing,11.5); // normal6..10 mean8, +35 critical bonus at10%
  close(ref.damagePerSwing,8.5); // module wrongly includes hardness again in critical bonus
  close(ours.orePerHour,11.5/240*1500);
  const poor=rate({rockId:'runite',pickaxeId:'bronze',miningLevel:50,strengthLevel:1,profileId:'afk'});
  close(poor.damagePerSwing,.88); // .9*1 + .1*35 =4.4, then*.2
});

test('natural double ore only changes ore; non-core silver/gold get none', () => {
  for(const rockId of ['copper','iron','coal','mithril','adamantite','luminite','runite','silver','gold']) {
    const args={rockId,miningLevel:58,strengthLevel:30,pickaxeId:'rune+3'};
    const yes=rate(args),no=rate({...args,doubleOre:false});
    close(yes.xpPerHour,no.xpPerHour);
    close(yes.orePerHour/no.orePerHour,['silver','gold'].includes(rockId)?1:rockId==='copper'?1.1:1.05);
  }
});

test('stamina profiles coincide below15, differ after unlock, and Strength bands are exact', () => {
  assert.equal(rate({rockId:'copper',miningLevel:14}).staminaCapacity,null);
  for(const [level,capacity] of [[15,31],[19,41],[26,51],[33,61],[46,71],[57,81],[67,91],[71,101],[88,111]]) {
    const result=rate({rockId:'copper',miningLevel:level});
    assert.equal(result.staminaCapacity,capacity);
    assert.equal(result.swingsBeforeDrained,Math.ceil(capacity/10));
  }
  for(const level of [1,14,15,99]) {
    const active=rate({rockId:'copper',miningLevel:level,strengthLevel:90});
    for(const profile of MINING_PROFILES) {
      const other=rate({rockId:'copper',miningLevel:level,strengthLevel:99,profileId:profile.id});
      close(other.xpPerHour/active.xpPerHour,level<15?1:profile.staminaMultiplier);
    }
  }
  assert.ok(rate({rockId:'iron',miningLevel:20,strengthLevel:10}).xpPerHour>rate({rockId:'iron',miningLevel:20,strengthLevel:9}).xpPerHour);
});

test('lookup fails closed for invalid levels/tools/rock/profile and supports110', () => {
  const valid={rockId:'copper',miningLevel:1,strengthLevel:1,pickaxeId:'bronze'};
  for(const invalid of [{miningLevel:0},{miningLevel:111},{miningLevel:1.2},{strengthLevel:121},{strengthLevel:0},{pickaxeId:'rune'},{pickaxeId:'dragon'},{rockId:'banite'},{profileId:'unknown'},{doubleOre:1}]) assert.equal(rate({...valid,...invalid}),null);
  assert.equal(lookupMiningRate(valid,{}),null);
  assert.equal(rate({...valid,miningLevel:110,pickaxeId:'auto'}).pickaxeId,'rune+3');
});

test('existing F2P levels above99 keep exact Strength bands and critical105 milestone', () => {
  assert.deepEqual(data.supportedLevels,{miningMin:1,miningMax:110,strengthMin:1,strengthMax:120,strengthBands:13});
  const args={rockId:'runite',pickaxeId:'rune+3',miningLevel:110};
  for(const [strengthLevel,band] of [[99,9],[100,10],[109,10],[110,11],[119,11],[120,12]]) {
    const result=rate({...args,strengthLevel});
    assert.equal(result.strengthBand,band);
    // Normal mean Mining110+StrengthBand+pick53; 30% crit ×105.
    close(result.damagePerSwing,110+band+53+31.5);
    close(result.xpPerHour,(110+band+53+31.5)*.76*.4*1500,.03);
    close(result.orePerHour,(110+band+53+31.5)/600*1500*1.05,.003);
  }
  const before=rate({...args,miningLevel:104,strengthLevel:120}),after=rate({...args,miningLevel:105,strengthLevel:120});
  close(after.damagePerSwing-before.damagePerSwing,2.5); // +1 level and +5 crit damage ×30%
  assert.ok(rate({...args,miningLevel:100,strengthLevel:100}).xpPerHour > 0);
});
