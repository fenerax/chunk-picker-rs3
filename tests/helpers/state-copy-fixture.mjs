import { openStore } from '../../app/storage/store.mjs';
import { openGamePlugin } from '../../app/game-plugin.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { fixture, options, now, taskCatalogue, world, first } from './owned-format2-fixture.mjs';

export const note = text => ({ type: 'set-note', memberId: 'member-1', chunkId: '100', note: text });
export async function copyFixture(root, format, overrides = {}) {
  const built = fixture(), calls = [];
  // Deliberately retained, unrelated input. Readers of members must not copy it.
  built.state.legacy.synthetic.padding = 'synthetic retained evidence '.repeat(200);
  const beforeCommit = Object.assign(change => { calls.push(change.operation); }, { operations: Object.freeze(['replace']) });
  const syntheticWorld = { ...world, surface: new Set(['100', '101']) };
  const config = { dataDir: `${root}/save`, initialState: built.state, world: syntheticWorld, now, random: () => 0,
    registry: createRuleRegistry(), taskCatalogue, retention: false, completionCodec: false, beforeCommit,
    ownedFormat2: format === 2 ? options(`${root}/catalogue`) : false, ...overrides };
  const store = await openStore(config);
  let at = Date.parse(now()), output, input, controller, key;
  const saved = Buffer.from(JSON.stringify({ tasks: [{ id: first, label: 'Synthetic first', category: 'Synthetic', status: 'available' }],
    taskLocations: { [first]: ['100'] } }));
  return { built, store, config, calls,
    async plugin() {
      controller = await openGamePlugin({ store, dataDir: config.dataDir, world: syntheticWorld, registry: config.registry, clock: () => at,
        questMapping: new Map(), serializeMutation: work => work(), bodyJSON: async () => input,
        json: async (_request, _response, _status, body) => { output = JSON.stringify(body); }, checkRequestOrigin() {},
        savedTasks: () => ({ bytes: saved, revision: store.getInfo().revision }) });
      ({ key } = await controller.create({ admin: true }, { memberId: 'member-1', label: 'Synthetic copy probe' }));
    },
    async call(route, report) {
      at += 1001; input = report;
      const url = `/api/plugin/v1/${route}`;
      await controller.handle({ method: report ? 'POST' : 'GET', url, headers: { authorization: `Bearer ${key}` } }, {},
        { route: url.split('?')[0], security: {} });
      return output;
    },
    async close() { await controller?.close(); await store.close(); },
  };
}
