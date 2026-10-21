// Independent no-bonus subset port of Module:Mining Rate Calculator Module,
// oldid 37179407, using MS Data oldid 37089129. This deliberately preserves
// the calculator's averaging, hardness, rounding and omitted global milestones.
// Clean source-subset fixtures under tests/fixtures/mining retain inspected Lua.
// Adapted from RuneScape Wiki contributors, CC BY-NC-SA 3.0.
const rocks = {
  copper: [1,40,0,.66,[2,8],[4,5]], tin: [1,40,0,.66,[2,8],[4,5]],
  iron: [10,120,5,.68,[12],[13]], coal: [20,140,15,.7,[25],[27]],
  silver: [20,140,15,.7,[],[]], mithril: [30,240,30,.72,[31,35],[36]],
  adamantite: [40,380,50,.74,[45,48],[49]], luminite: [40,380,50,.74,[45,48],[49]],
  gold: [40,200,50,.74,[],[]], runite: [50,600,75,.76,[56,58],[53]],
};
const picks = {
  bronze:[1,3,7,0], iron:[10,5,15,5], 'iron+1':[10,6,16,5],
  steel:[20,10,30,15], 'steel+1':[20,11,31,15],
  mithril:[30,15,45,30], 'mithril+1':[30,16,46,30], 'mithril+2':[30,17,47,30],
  adamant:[40,20,60,50], 'adamant+1':[40,21,61,50], 'adamant+2':[40,22,62,50],
  rune:[50,25,75,75], 'rune+1':[50,26,76,75], 'rune+2':[50,27,77,75], 'rune+3':[50,28,78,75],
};
const critLevels = [1,3,9,11,17,22,24,32,34,43,44,52,59,61,65,74,79,84,87,99];
const multiplier = { active:1, occasional:.9, afk:.2 };
export function wikiMiningReference({rockId, miningLevel, strengthLevel=1, pickaxeId, profileId='active'}) {
  const [unlock, diff, hardness, xp, chanceLevels, doubleLevels] = rocks[rockId];
  const [pickLevel, min, max, pen] = picks[pickaxeId];
  if (miningLevel < Math.max(unlock,pickLevel)) return null;
  let crit = 0;
  for(let i=0;i<20;i++) { if(miningLevel >= critLevels[i]) crit = (i+1)*5; else break; }
  const netHardness = Math.min(pen-hardness,0);
  const chance = .1 + .05 * chanceLevels.filter(n=>miningLevel>=n).length;
  const netCrit = Math.max(crit+netHardness,1) * chance;
  const damage = Math.max(miningLevel+Math.floor(strengthLevel/10)+netHardness+netCrit+(min+max)/2,1);
  const method = multiplier[profileId];
  const xpPerHour = Math.floor(10*damage*xp*.4)/10 * 1500 * method;
  const uncappedSwings = diff/damage;
  const swings = Math.max(uncappedSwings,1);
  const baseOre = 1/swings * 1500 * Math.min(method*(swings/uncappedSwings),1);
  const orePerHour = baseOre*(1+.05*doubleLevels.filter(n=>miningLevel>=n).length);
  return {xpPerHour,orePerHour,damagePerSwing:damage*method,criticalChance:chance};
}
