const refusal = message => { throw Object.assign(new Error(message), { status: 409 }); };
const bump = (map, key, amount) => { const count = (map.get(key) ?? 0) + amount; if (count) map.set(key, count); else map.delete(key); };

// Runtime indexes only. Startup scans once; a proposal visits only its changed
// records. Publish the proposal after the corresponding durable write succeeds.
export function createRegistryCaps(document, caps, onCheck = () => {}) {
  const accounts = new Map(), pickers = new Map(), capabilities = new Map();
  let activePickers = 0, capabilityTotal = document.capabilities.length;
  for (const account of document.accounts) accounts.set(account.id, account.memberships.length);
  for (const picker of document.pickers) {
    pickers.set(picker.id, { members: picker.memberIds.length, active: picker.lifecycle !== 'deleted' });
    if (picker.lifecycle !== 'deleted') activePickers++;
  }
  for (const capability of document.capabilities) bump(capabilities, capability.pickerId, 1);

  function prepare(next, ledger, { accounts: changedAccounts = [], pickers: changedPickers = [], addedCapabilities = [], removedCapabilities = [] } = {}) {
    const accountUpdates = new Map(), pickerUpdates = new Map(), capabilityUpdates = new Map();
    let nextActive = activePickers;
    const nextTotal = capabilityTotal + addedCapabilities.length - removedCapabilities.length;
    for (const account of changedAccounts) accountUpdates.set(account.id, account.deleted ? null : account.memberships.length);
    for (const picker of changedPickers) {
      const old = pickerUpdates.get(picker.id) ?? pickers.get(picker.id), entry = { members: picker.memberIds.length, active: picker.lifecycle !== 'deleted' };
      nextActive += Number(entry.active) - Number(old?.active ?? false); pickerUpdates.set(picker.id, entry);
    }
    for (const [records, amount] of [[addedCapabilities, 1], [removedCapabilities, -1]]) for (const record of records) {
      capabilityUpdates.set(record.pickerId, (capabilityUpdates.get(record.pickerId) ?? capabilities.get(record.pickerId) ?? 0) + amount);
    }
    onCheck({ accounts: changedAccounts.length, pickers: changedPickers.length, capabilities: addedCapabilities.length + removedCapabilities.length });
    if (next.accounts.length > caps.accounts) refusal('The login account limit has been reached. Ask the operator about available capacity.');
    if (nextActive > caps.pickers) refusal('The picker limit has been reached. Existing maps are unchanged. Ask the operator about available capacity.');
    if (ledger.issuedPickerIds.length > caps.issuedPickerIds) refusal('The picker ID limit has been reached. Ask the operator for help; existing IDs cannot be reused.');
    if (ledger.accounts.length > caps.retiredAccounts) refusal('The retired account record limit has been reached. Ask the operator for help; existing records must be kept.');
    if (next.capabilities.length !== nextTotal) throw new Error('Capability count change is inconsistent.');
    if (nextTotal > caps.capabilities) refusal('The access key limit has been reached. Revoke an unused key or ask the operator for help.');
    for (const count of accountUpdates.values()) if (count > caps.membershipsPerAccount) refusal('The account membership record limit has been reached. Ask the operator for help; existing memberships are unchanged.');
    for (const entry of pickerUpdates.values()) if (entry.members > caps.membersPerPicker) refusal('The picker member ID limit has been reached. Ask the operator for help; historical member IDs must be kept.');
    for (const count of capabilityUpdates.values()) if (count > caps.capabilitiesPerPicker) refusal('This picker has reached its access key limit. Revoke an unused key before creating another.');
    return () => {
      for (const [id, count] of accountUpdates) if (count === null) accounts.delete(id); else accounts.set(id, count);
      for (const [id, entry] of pickerUpdates) pickers.set(id, entry);
      for (const [id, count] of capabilityUpdates) if (count) capabilities.set(id, count); else capabilities.delete(id);
      activePickers = nextActive; capabilityTotal = nextTotal;
    };
  }
  // Check the initial index with the same rules, without a picker × key scan.
  const initialize = ledger => prepare(document, ledger, { accounts: document.accounts, pickers: document.pickers,
    addedCapabilities: [] });
  return { prepare, get activePickers() { return activePickers; },
    snapshot() { return { accounts: accounts.size, activePickers,
      memberships: Object.fromEntries(accounts), members: Object.fromEntries([...pickers].map(([id, value]) => [id, value.members])),
      capabilities: Object.fromEntries(capabilities), capabilityTotal }; },
    checkInitial(ledger) {
      initialize(ledger);
      for (const count of capabilities.values()) if (count > caps.capabilitiesPerPicker) refusal('This picker has reached its access key limit. Revoke an unused key before creating another.');
    },
  };
}
