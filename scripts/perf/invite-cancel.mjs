// Synthetic production-page/HTTP check. No real providers, packs, saves or identities.
// node scripts/perf/invite-cancel.mjs --playwright /scratch/node_modules/playwright-core/index.mjs
// --characterize reports missing recovery choices without failing (for baseline measurement).
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const options = Object.fromEntries(process.argv.slice(2).map((value, index, args) =>
  value.startsWith('--') ? [value.slice(2), args[index + 1]?.startsWith('--') ? true : args[index + 1] ?? true] : []).filter(pair => pair.length));
const samples = Number(options.samples ?? 5);
assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 20);
assert.ok(Number(process.versions.node.split('.')[0]) > 24 ||
  Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 20, 'Node 24.20+ required');
let origin;
const directory = await mkdtemp(path.join(tmpdir(), 'invite-cancel-'));
const keys = ['RS3_DATASET', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR', 'RS3_PACKS_DIR', 'RS3_PACK_SELECTION',
  'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_GAME_DEFAULTS_FILE', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256',
  'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_ROLE', 'RS3_LOOPBACK_PORT', 'RS3_SIGNIN',
  'RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
const previous = new Map(keys.map(key => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p';
process.env.RS3_GAME_DATA_DIR = path.join(directory, 'unused-data');
process.env.RS3_MAP_ASSETS_DIR = path.join(directory, 'unused-assets');
process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client';
process.env.RS3_DISCORD_CLIENT_SECRET_FILE = path.join(directory, 'secret');
await writeFile(process.env.RS3_DISCORD_CLIENT_SECRET_FILE, 'synthetic-secret');
let app, browser, tlsProxy;
const totals = { samplesPerJourney: samples, simulatedProviderConsent: true, providerCalls: 0, contractFailures: 0 };
try {
  const { createServer } = await import('../../app/server.mjs');
  const { createGroupState } = await import('../../app/core/state.mjs');
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=picker.example'], { stdio: 'ignore' });
  tlsProxy = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname === '/synthetic-consent') {
      response.writeHead(303, { location: `/auth/discord/callback?${new URLSearchParams({ state: url.searchParams.get('state'), error: 'access_denied' })}`, 'Cache-Control': 'no-store' });
      response.end(); return;
    }
    const upstream = http.request({ host: '127.0.0.1', port: app.loopbackAddress().port,
      path: request.url, method: request.method, agent: false,
      headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' } }, result => {
      const headers = { ...result.headers };
      if (headers.location?.startsWith('https://discord.com/oauth2/authorize?')) {
        const authorization = new URL(headers.location);
        headers.location = '/synthetic-consent?' + new URLSearchParams({ state: authorization.searchParams.get('state') });
      }
      response.writeHead(result.statusCode, headers); result.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); request.pipe(upstream);
  });
  await new Promise(resolve => tlsProxy.listen(0, '127.0.0.1', resolve));
  origin = `https://picker.example:${tlsProxy.address().port}`;
  app = await createServer({ dataDir: path.join(directory, 'game'), host: '127.0.0.1', port: 0,
    loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', predictionPrewarm: false,
    initialState: createGroupState([{ id: 'synthetic-player', name: 'Synthetic player', unlocked: ['11825'] }]),
    definitions: { chunks: { '11825': { Name: 'Synthetic chunk' } }, challenges: {}, walkableChunks: ['11825'], walkableChunksF2P: ['11825'] }, taskMap: {},
    signInProvider: { fetch: async () => { totals.providerCalls++; throw Error('Unexpected provider exchange'); } },
    rateLimits: { failedJoins: 1000, unauthenticated: 10000 }, shutdownDeadlineMs: 500 });
  await app.listen();
  const publicAddress = `http://127.0.0.1:${app.loopbackAddress().port}`;
  const privateAddress = `http://127.0.0.1:${app.address().port}`;
  const state = app.store.getState();
  function send(address, route, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(address + route, { method, agent: false, headers }, response => {
        const parts = []; response.on('data', part => parts.push(part)); response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts) }));
      });
      request.setTimeout(10000, () => request.destroy(Error('Synthetic request timed out')));
      request.on('error', reject); request.end(body);
    });
  }
  const proxy = { host: new URL(origin).host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' };
  async function invitation() {
    const result = await send(privateAddress, '/api/invites', { method: 'POST',
      headers: { authorization: `Bearer ${app.store.getAccessToken()}`, origin: privateAddress, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Synthetic player', memberId: 'synthetic-player' }) });
    assert.equal(result.status, 201);
    return new URL(JSON.parse(result.body).link).pathname;
  }
  const summary = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { median: +((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2).toFixed(2),
      min: +sorted[0].toFixed(2), max: +sorted.at(-1).toFixed(2) };
  };
  const visible = html => html.includes('action="/auth/invite"');
  const expectedIdentity = identity => { assert.equal(identity.kind, 'invite'); assert.equal(identity.memberId, 'synthetic-player'); };
  for (const transport of ['http', ...(options.playwright ? ['chromium'] : [])]) {
    if (transport === 'chromium') {
      const { chromium } = await import(pathToFileURL(path.resolve(options.playwright)));
      browser = await chromium.launch({ executablePath: options.chromium ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP picker.example 127.0.0.1'] });
    }
    const counts = { initialChoice: 0, cancellationChoice: 0, retryChoice: 0, directSuccess: 0, cancellationSuccess: 0, gameplayDifferences: 0 };
    const durations = { direct: [], cancelled: [] };
    for (let index = 0; index < samples; index++) for (const cancel of [false, true]) {
      const start = performance.now(), link = await invitation();
      if (transport === 'http') {
        const jar = new Map();
        async function request(route, method = 'GET') {
          const result = await send(publicAddress, route, { method, headers: { ...proxy,
            ...(method === 'POST' ? { origin } : {}), cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } });
          for (const item of result.headers['set-cookie'] ?? []) {
            const pair = item.split(';')[0], split = pair.indexOf('='), key = pair.slice(0, split), value = pair.slice(split + 1);
            if (!value || /max-age=0/i.test(item)) jar.delete(key); else jar.set(key, value);
          }
          return result;
        }
        const initial = await request(link); assert.equal(initial.status, 200);
        counts.initialChoice += Number(visible(initial.body.toString()));
        if (cancel) {
          const started = await request('/auth/discord'); assert.equal(started.status, 303);
          const state = new URL(started.headers.location).searchParams.get('state');
          const cancelled = await request(`/auth/discord/callback?${new URLSearchParams({ state, error: 'access_denied' })}`);
          assert.equal(cancelled.status, 400);
          counts.cancellationChoice += Number(visible(cancelled.body.toString()));
          counts.retryChoice += Number(cancelled.body.includes('href="/auth/discord"'));
        }
        assert.equal((await request('/auth/invite', 'POST')).status, 303);
        const session = await request('/api/session'); assert.equal(session.status, 200); expectedIdentity(JSON.parse(session.body));
      } else {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        try {
          // The proxy simulates only the provider consent/redirect boundary.
          // Production pages, cookies, form submissions and CSRF headers travel
          // through Chromium's normal HTTPS stack. No external origin is needed.
          await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          await page.goto(origin + link);
          const button = page.getByRole('button', { name: 'Continue with invite link', exact: true });
          counts.initialChoice += Number(await button.isVisible());
          if (cancel) {
            await page.getByRole('link', { name: 'Sign in with Discord', exact: true }).click();
            await page.getByRole('heading', { name: 'Sign-in cancelled', exact: true }).waitFor();
            counts.cancellationChoice += Number(await button.isVisible());
            counts.retryChoice += Number(await page.getByRole('link', { name: 'Sign in with Discord', exact: true }).isVisible());
          }
          if (await button.isVisible()) {
            await Promise.all([page.waitForURL(origin + '/', { waitUntil: 'domcontentloaded' }), button.click()]);
          } else {
            // Baseline control: the omitted form still works through HTTP.
            assert.ok(options.characterize);
            assert.equal(await page.evaluate(async () => (await fetch('/auth/invite', { method: 'POST', redirect: 'manual' })).status), 0);
          }
          expectedIdentity(await page.evaluate(async () => (await fetch('/api/session')).json()));
        } finally { await context.close(); }
      }
      counts[cancel ? 'cancellationSuccess' : 'directSuccess']++;
      if (JSON.stringify(app.store.getState()) !== JSON.stringify(state)) counts.gameplayDifferences++;
      durations[cancel ? 'cancelled' : 'direct'].push(performance.now() - start);
    }
    totals.contractFailures += samples - counts.cancellationChoice;
    totals[transport] = { ...counts, journeyMs: { direct: summary(durations.direct), cancelled: summary(durations.cancelled) } };
    assert.equal(counts.initialChoice, samples * 2); assert.equal(counts.retryChoice, samples);
    assert.equal(counts.gameplayDifferences, 0);
    await browser?.close(); browser = undefined;
  }
  totals.serverPeakRssMiB = +(process.resourceUsage().maxRSS / 1024).toFixed(1);
  // Counts and timings only: never emit invitation links, auth URLs or cookies.
  console.log(JSON.stringify(totals, null, 2));
  assert.equal(totals.providerCalls, 0);
  if (!options.characterize) assert.equal(totals.contractFailures, 0, 'Every eligible cancellation must retain invitation continuation');
} finally {
  await browser?.close();
  tlsProxy?.closeAllConnections();
  if (tlsProxy?.listening) await new Promise(resolve => tlsProxy.close(resolve));
  await app?.close();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(directory, { recursive: true, force: true });
}
