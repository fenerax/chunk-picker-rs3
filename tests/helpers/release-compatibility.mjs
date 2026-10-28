import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export const syntheticAdditions = Array.from({ length: 4 }, (_, index) => ({ key: `rs3:task:synthetic-${index}`, target: `rs3:task:synthetic-${index}` }));
const resolution = id => ({ status: 'resolved', id, candidates: [id] });
export function compatibilityReports() {
  const before = { authored: { ids: ['rs3:task:existing'], aliases: {} }, saved: { 'rs3:task:existing': resolution('rs3:task:existing') },
    datasetAuthored: { 'rs3:task:existing': 'rs3:task:existing' }, datasetAuthoredKeys: {},
    taskIds: ['rs3:task:existing'], progressDigest: 'progress', progressFields: { members: 'progress' },
    historyEvents: ['command'], historyTypes: ['command'], migrationArchives: ['archive'], migrationConversions: [], migrationConflicts: [],
    registryDigest: 'old', migrationSummary: { lostRecords: 0 }, tasksServed: true };
  const after = { ...before, saved: { ...before.saved, ...Object.fromEntries(syntheticAdditions.map(row => [row.key, resolution(row.target)])) },
    datasetAuthored: { ...before.datasetAuthored, ...Object.fromEntries(syntheticAdditions.map(row => [row.key, row.target])) },
    taskIds: [...before.taskIds, ...syntheticAdditions.map(row => row.target)], registryDigest: 'new',
    historyEvents: ['command', 'refresh'], historyTypes: ['command', 'catalogue-refresh'], migrationArchives: ['archive', 'refresh-archive'] };
  return { before, after: structuredClone(after) };
}

// A tiny release exercises the production report generator and child protocol.
// All identifiers and save values are synthetic. Test listeners use port 0.
export async function syntheticCore(core, { additions = false } = {}) {
  const put = async (name, source) => { const file = path.join(core, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, source); };
  const ids = additions ? syntheticAdditions.map(row => row.target) : [];
  await put('app/tasks/identity.mjs', `export const authoredIdentityRegistry = () => ({ entries: { 'rs3:task:existing': {} }, aliases: {} });
export const resolveIdentity = id => ({ status: 'resolved', id, candidates: [id] });`);
  await put('app/dataset-bootstrap.mjs', `export const loadDatasetInputs = async () => ({ definitionBytes: Buffer.from(JSON.stringify({ challenges: { Synthetic: Object.fromEntries(${JSON.stringify(ids)}.map(id => [id, { PickerId: id }])) } })) });`);
  await put('app/dataset-pipeline.mjs', 'export const prepareTaskDefinitions = value => value;');
  await put('app/server.mjs', `import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
export async function createServer({ dataDir, host, loopbackPort }) {
  if (host !== '127.0.0.1' || loopbackPort !== undefined) throw new Error('Probe must be loopback-only.');
  const file = dataDir + '/state.json', document = JSON.parse(await readFile(file, 'utf8'));
  const state = document.state ?? document;
  state.tasks ??= [{ id: 'rs3:task:existing' }]; state.identityRegistry ??= {};
  for (const id of ${JSON.stringify(ids)}) if (!state.tasks.some(task => task.id === id)) {
    state.tasks.push({ id }); state.identityRegistry[id] = id;
  }
  state.history ??= [{ type: 'command', value: 'synthetic' }];
  if (${additions} && !state.history.some(event => event.type === 'catalogue-refresh')) state.history.push({ type: 'catalogue-refresh' });
  await writeFile(file, JSON.stringify(document));
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ tasks: state.tasks })); });
  return { dataset: {}, store: { getState: () => state, backup: async () => ({ state }) },
    listen: () => new Promise(resolve => server.listen(0, host, resolve)),
    get inviteUrl() { return 'http://127.0.0.1:' + server.address().port + '/join/synthetic'; },
    close: () => new Promise(resolve => server.close(resolve)) };
}`);
}
