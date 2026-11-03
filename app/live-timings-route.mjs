import { readFile } from 'node:fs/promises';
import { bodyJSON, json, httpError } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';

const assets = new Map([['/admin/live-timings', ['live-timings.html', 'text/html']], ['/admin/live-timings.mjs', ['live-timings.mjs', 'text/javascript']], ['/admin/live-timings.css', ['live-timings.css', 'text/css']]]);
export const isLiveTimingsRoute = route => assets.has(route) || ['/api/admin/live-timings', '/api/admin/cpu-profiles'].includes(route);
export async function serveLiveTimings(request, response, { route, identity, security, timings, profiles }) {
  if (!isLiveTimingsRoute(route)) return false;
  if (!identity?.admin || identity.readOnly || security.publicRequest || identity.kind === 'plugin') throw httpError(403, 'Administrator access requires a private connection.');
  if (!timings || !profiles) throw httpError(503, 'Live timings unavailable.');
  if (['GET', 'HEAD'].includes(request.method)) {
    if (assets.has(route)) {
      const [file, type] = assets.get(route), bytes = await readFile(new URL(`./web/${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } else if (route === '/api/admin/live-timings') await json(request, response, 200, { ...timings.summary(), profile: profiles.status(), profiles: await profiles.list() });
    else {
      const name = new URL(request.url, 'http://localhost').searchParams.get('name') ?? '';
      const bytes = await profiles.download(name);
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    return true;
  }
  if (request.method !== 'POST' || route !== '/api/admin/cpu-profiles') throw httpError(405, 'Method not allowed.');
  checkRequestOrigin(request, security);
  const body = await bodyJSON(request, 1024);
  if (body.action === 'stop') await profiles.stop();
  else if (body.action === 'start') await profiles.start(body.seconds ?? 180);
  else throw httpError(400, 'Choose start or stop.');
  await json(request, response, 200, profiles.status()); return true;
}
