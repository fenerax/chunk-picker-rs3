import { observedSkills } from '../../app/core/game-progress.mjs';
// Synthetic official API responses with invented account progress.
// Totals deliberately differ from summed quest awards (historical/replay cases).
export const platformProfile = (name = 'exampleGIMab') => ({ name, skills: [
  { id: 0, name: 'Overall', rank: 10000, level: 33, xp: 12000 },
  { id: 1, name: 'Attack', rank: -1, level: 7, xp: 700 },
  { id: 2, name: 'Defence', rank: 10001, level: 9, xp: 1000 },
  { id: 28, name: 'Archaeology', rank: -1, level: 6, xp: 600 },
  { id: 29, name: 'Necromancy', rank: 10002, level: 11, xp: 1400 },
], activities: [{ id: 0, name: 'RuneScore', rank: -1, score: 100 }] });

export const platformQuests = (name = 'exampleGIMab') => ({ name, qp: 17, qp_max: 450, quests: {
  '11': { title: 'Broken Home', status: 'COMPLETED', difficulty: 1, members: false, qp: 1, eligible: true },
  '23': { title: 'Necromancy!', status: 'COMPLETED', difficulty: 0, members: false, qp: 1, eligible: true },
  '35': { title: 'Unstable Foundations', status: 'COMPLETED', difficulty: 0, members: false, qp: 0, eligible: true },
  '47': { title: 'Stolen Hearts', status: 'NOT_STARTED', difficulty: 0, members: false, qp: 1, eligible: true },
} });

export const apiJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export function platformResponse(url) {
  const quest = url.pathname.includes('/playerQuests/');
  const name = quest ? decodeURIComponent(url.pathname.split('/').at(-1)) : url.searchParams.get('player');
  return apiJson(quest ? platformQuests(name) : platformProfile(name));
}

// Convert invented legacy fixtures to the published Platform shape.
export function recordedPlatformResponse(url, fixture) {
  const name = url.searchParams.get('player') ?? decodeURIComponent(url.pathname.split('/').at(-1));
  return apiJson(url.pathname.includes('/playerQuests/')
    ? { name, qp: 1, qp_max: 450, quests: Object.fromEntries(fixture.quests.quests.map((row, id) => [id, row])) }
    : { name: fixture.profile.name ?? name, skills: fixture.profile.skillvalues.map(row => ({ ...row,
      id: row.id + 1, name: observedSkills[row.id] ?? 'Future skill', xp: Math.floor(row.xp / 10) })) });
}
