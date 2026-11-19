import { readFile } from 'node:fs/promises';
import { bodyJSON, httpError, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';

const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Past maps · Chunk Picker</title><link rel="stylesheet" href="/past-maps.css"><script type="module" src="/past-maps.mjs"></script></head><body><main><a href="/characters">Your characters</a><h1>Past maps</h1><p>Frozen at departure · Read only · Your current map stays separate.</p><div id="past-maps">Loading retained maps…</div><p id="past-error" role="alert"></p></main></body></html>';
const selection = (request, target, header, keys) => {
  const values = keys.flatMap(k => target.searchParams.getAll(k)); if (request.headers[header] !== undefined) values.push(request.headers[header]);
  if (new Set(values).size !== 1 || typeof values[0] !== 'string') throw httpError(403, 'Choose one explicit character and group.'); return values[0];
};
export function createGroupDepartureHandler({ registry, service, authenticate, backupDisclosure, available = () => true }) {
  return async (request, response, security, bindBody) => {
    const target = new URL(request.url, 'http://localhost'), route = target.pathname;
    if (['/past-maps.mjs', '/past-maps.css'].includes(route)) {
      if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Past maps are read only.');
      const bytes = await readFile(new URL('./web' + route, import.meta.url));
      response.writeHead(200, { 'Content-Type': route.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); response.end(request.method === 'HEAD' ? undefined : bytes); return;
    }
    const identity = authenticate(request, security);
    if (identity?.kind !== 'account') {
      if (request.method === 'GET' && route.startsWith('/past-maps')) { response.writeHead(303, { Location: `/auth/signin?returnTo=${encodeURIComponent(route)}`, 'Cache-Control': 'private, no-store' }); response.end(); return; }
      throw httpError(401, 'Sign in to open your retained maps or change a group.');
    }
    bindBody?.({ accountId: identity.accountId, pickerId: 'account' });
    if (route === '/api/group-departure') {
      const picker = selection(request, target, 'x-picker-id', ['picker', 'pickerId']), character = selection(request, target, 'x-character-id', ['character']);
      if (!/^p_[0-9a-f]{32}$/.test(picker) || !/^c_[0-9a-f]{32}$/.test(character) || request.headers['x-picker'] !== undefined && request.headers['x-picker'] !== picker) throw httpError(403, 'Conflicting character or group selection.');
      if (request.method === 'GET') { await json(request, response, 200, { ...await service.review(identity.accountId, character, picker), backups: backupDisclosure }); return; }
      if (request.method !== 'POST') throw httpError(405, 'Use GET or POST.');
      checkRequestOrigin(request, security);
      const body = await bodyJSON(request, 4096);
      if (body.confirmed !== true || Object.keys(body).some(k => !['confirmed', 'requestId', 'characterId', 'revision'].includes(k))) throw httpError(400, 'Review and confirm departure first.');
      if (!available()) throw httpError(409, 'There is not enough picker residency for departure. Existing maps are unchanged.');
      await json(request, response, 200, await service.depart(identity.accountId, character, picker, body)); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Past maps are read only.');
    if (route.startsWith('/past-maps')) {
      if (route !== '/past-maps') await registry.readPastMap(identity.accountId, route.slice('/past-maps/'.length));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }); response.end(request.method === 'HEAD' ? undefined : page); return;
    }
    if (route === '/api/past-maps') { await json(request, response, 200, { maps: registry.listPastMaps(identity.accountId) }); return; }
    const match = /^\/api\/past-maps\/([^/]+)(\/download)?$/.exec(route); if (!match) throw httpError(404, 'Past map not found.');
    const value = await registry.readPastMap(identity.accountId, match[1]);
    if (match[2]) { response.setHeader('Content-Disposition', `attachment; filename="past-map-${value.metadata.id}.json"`); await json(request, response, 200, value.document); }
    else await json(request, response, 200, value);
  };
}
