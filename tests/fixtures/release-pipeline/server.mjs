// A real owned listener/store boundary with synthetic contents. Both the copied
// startup seed and the latest-save compatibility probe use this same factory.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export const marker = 'committed core';
export async function createServer({ dataDir, port }) {
  assert.equal(port, 0, 'compatibility startup must atomically acquire its own port');
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(file)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { revision: 9, members: [{ id: 'one', completedTasks: [], taskStatus: {} }], tasks: [{ id: 'rs3:task:1' }] };
    await writeFile(file, JSON.stringify(state), { flag: 'wx' });
  }
  assert.equal(state.revision, 9, 'latest synthetic save must be opened');
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ tasks: state.tasks }));
  });
  return {
    dataset: {}, store: { getState: () => state, backup: async () => ({ state }) },
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }),
    get inviteUrl() { return `http://127.0.0.1:${server.address().port}/join/synthetic`; },
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
