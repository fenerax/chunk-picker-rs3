import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openRegistry } from '../../app/storage/registry.mjs';
import { openStore } from '../../app/storage/store.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { createGroupInviteService } from '../../app/group-invite-service.mjs';

export async function inviteFixture(root, { crashPoint, now = () => Date.parse('2026-01-01T00:00:00Z'), caps } = {}) {
  const options = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), legacyDir: path.join(root, 'legacy') };
  await mkdir(options.legacyDir, { recursive: true });
  const registry = await openRegistry({ ...options, crashPoint, now, caps });
  const firstLogin = registry.firstLogin;
  registry.firstLogin = async (...args) => { const result = await firstLogin(...args); return { ...result, character: registry.listCharacters(result.account.id)[0] }; };
  const contexts = new Map();
  const gameplayRules = createRuleRegistry([{ id: 'house.synthetic', label: 'Synthetic house rule', type: 'boolean', default: true }]);
  const open = async id => {
    if (!contexts.has(id)) {
      const p = registry.getPicker(id);
      const initialState = createGroupState(p.memberIds.map(id => ({ id, name: 'Unnamed character' })), gameplayRules);
      const store = await openStore({ dataDir: registry.pickerDirectory(id), initialState, registry: gameplayRules, now,
        beforeCommit: change => change.operation === 'roster' ? crashPoint?.('invite-roster-prepared', { pickerId: id }) : undefined });
      let queue = Promise.resolve();
      contexts.set(id, { store, groupRuleDefinitions: () => gameplayRules.definitions, withGroupAdmission(work) { const result = queue.then(() => work(store)); queue = result.catch(() => {}); return result; },
        untouchedOnboarding() { const s = store.getCalculationSnapshot().readState; return store.getInfo().revision === 0 && s.members.length === 1 && s.members[0].id === 'owner' && !s.history.length; } });
    }
    return contexts.get(id);
  };
  const service = createGroupInviteService({ registry, acquire: async id => ({ context: await open(id) }), release() {}, point: async (name, pickerId) => crashPoint?.(name, { pickerId }) });
  return { registry, service, options, open,
    async join(invite, account, input = {}) { const review = await service.review(invite.secret, account.id); return service.accept(invite.secret, account.id, input, review.review?.revision); },
    async close() { await service.close(); for (const c of contexts.values()) await c.store.close(); await registry.close(); } };
}
