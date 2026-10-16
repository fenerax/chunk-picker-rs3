export const BANKING_TRAVEL_SOURCES = Object.freeze([
  { title: 'Home Teleport', oldid: 37178861, url: 'https://runescape.wiki/w/Home_Teleport?oldid=37178861', retrieved: '2026-10-15',
    timestamp: '2026-09-17T15:18:39Z', sourceSha256: 'fee30d4bc35b3bc413eefc0bdc9626c1f3d58c8848b5be4e56d8266183d20f43' },
  { title: 'Surge', oldid: 37177973, url: 'https://runescape.wiki/w/Surge?oldid=37177973', retrieved: '2026-10-15',
    timestamp: '2026-09-15T13:11:58Z', sourceSha256: '56b1ffcc983c3b5f74259b0f5cc3df57eff454ca4ca5ec9981d4b18e461a4e4e' },
]);
export const HOME_TELEPORT_TICKS = 17;

/** A normal Surge along an already checked straight path; no corner cutting,
 * Double Surge, Mobile or optimal ability-path search. Cooldown carries between
 * both legs and successive trips. Missing path geometry means ordinary walking. */
export function bankingTripTravel(route, { surge = false, gatheringSeconds = 0, destinationSeconds = 0 } = {}) {
  const outbound = route.outboundRuns ?? route.walkingRuns;
  const inbound = route.returnRuns ?? (route.walkingRuns ? [...route.walkingRuns].reverse() : null);
  const outSteps = route.outboundTileSteps ?? route.tileSteps;
  const backSteps = route.returnTileSteps ?? route.tileSteps;
  const extra = route.extraTravelSeconds ?? 0, teleport = route.teleportSeconds ?? 0;
  if (![outSteps, backSteps, extra, teleport].every(n => Number.isFinite(n) && n >= 0)) return null;
  const walkingSeconds = (outSteps + backSteps) * .6 + extra + teleport;
  if (!surge || !outbound || !inbound) return { travelSeconds: walkingSeconds, walkingSeconds, surgeUses: 0,
    geometryMissing: surge && (!outbound || !inbound) };
  if (![...outbound, ...inbound].every(n => Number.isInteger(n) && n >= 0)
    || outbound.reduce((a, b) => a + b, 0) !== outSteps || inbound.reduce((a, b) => a + b, 0) !== backSteps) return null;
  // Start every trip at the conservative cooldown bound. Thus a short gathering
  // cycle never receives a free reset; long gathers recover the full cooldown.
  let cooldown = Math.max(0, 20.4 - gatheringSeconds), uses = 0;
  const wait = seconds => { cooldown = Math.max(0, cooldown - seconds); };
  const leg = runs => {
    let seconds = 0;
    for (const run of runs) {
      let steps = run;
      while (steps > 0) {
        if (steps >= 10 && cooldown < 1e-8) { steps -= 10; seconds += .6; cooldown = 19.8; uses++; }
        else { steps--; seconds += .6; wait(.6); }
      }
    }
    return seconds;
  };
  wait(teleport);
  const out = leg(outbound); wait(destinationSeconds + extra);
  const back = leg(inbound);
  return { travelSeconds: out + back + extra + teleport, walkingSeconds, surgeUses: uses, geometryMissing: false };
}
