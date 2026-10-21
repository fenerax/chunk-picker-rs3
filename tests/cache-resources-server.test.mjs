import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const previous = process.env.RS3_RESOURCE_CONTENTS;
process.env.RS3_RESOURCE_CONTENTS = 'retained';
after(() => { if (previous === undefined) delete process.env.RS3_RESOURCE_CONTENTS; else process.env.RS3_RESOURCE_CONTENTS = previous; });
const [{ createServer }, { createGroupState }] = await Promise.all([import('../app/server.mjs'), import('../app/core/state.mjs')]);

test('browser resource imports and retained rollback mode are served by an isolated server', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'resource-server-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const server = await createServer({ port: 0, dataDir: directory, definitions: {
    chunks: { '12339': {} }, sections: { '12339': { 0: [] } }, walkableChunks: ['12339'], walkableChunksF2P: ['12339'],
  }, taskMap: {}, initialState: createGroupState([{ id: 'm', name: 'Fixture' }]) });
  t.after(() => server.close());
  await server.listen();
  const url = new URL(server.inviteUrl);
  const headers = { authorization: `Bearer ${url.pathname.split('/').at(-1)}` };
  for (const resource of ['cache-resources.mjs', 'cache-resources.2026-10-08.v1.json', 'cache-resource-selectors.2026-10-08.v1.json']) {
    const response = await fetch(`${url.origin}/data/${resource}`, { headers });
    assert.equal(response.status, 200, resource);
    assert.match(response.headers.get('content-type'), resource.endsWith('.json') ? /application\/json/ : /javascript/);
    assert((await response.text()).length > 0);
  }
  assert.equal((await (await fetch(`${url.origin}/api/rules`, { headers })).json()).cacheResources, false);
});
