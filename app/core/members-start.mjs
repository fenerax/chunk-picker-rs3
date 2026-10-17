const OPTION_KEYS = new Set(['pool', 'includeConditional', 'includeF2P', 'traderWoes', 'pairing', 'switchToMembers']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be an object`);
  }
}

function ids(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 2) {
    throw new TypeError('Members starts support one or two members');
  }
  const result = values.map(value => typeof value === 'string' ? value : value?.id);
  if (result.some(id => typeof id !== 'string' || !id.trim()) || new Set(result).size !== result.length) {
    throw new TypeError('Member IDs must be unique non-empty strings');
  }
  return result;
}

/** Validate command options without inferring personal achievement completion. */
export function normalizeMembersStartOptions(options = {}, memberIds) {
  object(options, 'Members start options');
  const members = ids(memberIds);
  for (const key of Reflect.ownKeys(options)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`Unknown members start option: ${String(key)}`);
  }
  const pool = Object.hasOwn(options, 'pool') ? options.pool : 'optionA';
  const pairing = Object.hasOwn(options, 'pairing') ? options.pairing : 'different';
  if (!['optionA', 'optionB'].includes(pool)) throw new TypeError('Pool must be optionA or optionB');
  if (!['different', 'independent'].includes(pairing)) throw new TypeError('Pairing must be different or independent');
  const booleans = {};
  for (const [key, fallback] of [['includeConditional', false], ['includeF2P', false], ['switchToMembers', true]]) {
    const value = Object.hasOwn(options, key) ? options[key] : fallback;
    if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`);
    booleans[key] = value;
  }
  const achievements = Object.hasOwn(options, 'traderWoes') ? options.traderWoes : {};
  object(achievements, 'traderWoes');
  for (const key of Reflect.ownKeys(achievements)) {
    if (!members.includes(key)) throw new TypeError(`Unknown Trader Woes member: ${String(key)}`);
    if (typeof achievements[key] !== 'boolean') throw new TypeError(`Trader Woes for ${key} must be boolean`);
  }
  return { pool, ...booleans, traderWoes: Object.fromEntries(members.map(id => [id,
    Object.hasOwn(achievements, id) ? achievements[id] : false])), pairing };
}

/** Older bank data keeps its short condition in the first sentence of the note. */
export function membersStartBankCondition(bank) {
  return bank.condition ?? bank.requirementsNote?.trim().match(/^[\s\S]*?[.!?](?=\s|$)|^[\s\S]+$/)?.[0] ?? '';
}

function uniqueBanks(banks) {
  if (!Array.isArray(banks) || !banks.length) throw new TypeError('Bank pool must be a non-empty array');
  const unique = new Map();
  for (const bank of banks) {
    object(bank, 'Bank');
    if (typeof bank.chunkId !== 'string' || !/^\d+$/.test(bank.chunkId)
      || typeof bank.place !== 'string' || !bank.place.trim()) {
      throw new TypeError('Banks require a numeric chunkId string and a place');
    }
    if (Object.hasOwn(bank, 'condition') && typeof bank.condition !== 'string') {
      throw new TypeError('Bank condition must be a string');
    }
    if (!unique.has(bank.chunkId)) unique.set(bank.chunkId, { ...bank });
  }
  return [...unique.values()];
}

/** A's conditional flag confirms its gates; B checks personal Trader Woes flags. */
export function membersStartPools(data, members, options = {}) {
  object(data, 'Members start data');
  const memberIds = ids(members);
  const settings = normalizeMembersStartOptions(options, memberIds);
  const baseline = data[settings.pool];
  if (!Array.isArray(baseline)) throw new TypeError(`Missing ${settings.pool} bank list`);
  return memberIds.map(memberId => {
    let banks = [...baseline];
    if (settings.pool === 'optionA') {
      if (settings.includeConditional) {
        if (!Array.isArray(data.optionAConditional)) throw new TypeError('Missing optionAConditional bank list');
        banks.push(...data.optionAConditional);
      }
      if (settings.includeF2P) {
        if (!Array.isArray(data.optionAF2PExtension)) throw new TypeError('Missing optionAF2PExtension bank list');
        banks.push(...data.optionAF2PExtension);
      }
    } else if (settings.traderWoes[memberId]) {
      if (!Array.isArray(data.optionBConditional)) throw new TypeError('Missing optionBConditional bank list');
      banks.push(...data.optionBConditional);
    }
    return { memberId, banks: uniqueBanks(banks) };
  });
}

/** Uniformly sample valid ordered assignments, including asymmetric personal pools. */
export function rollMembersStarts(pools, pairing = 'different', random = Math.random) {
  if (!['different', 'independent'].includes(pairing)) throw new TypeError('Pairing must be different or independent');
  if (typeof random !== 'function') throw new TypeError('Random must be a function');
  if (!Array.isArray(pools)) throw new TypeError('Pools must be an array');
  ids(pools.map(pool => pool?.memberId));
  const banks = pools.map(pool => uniqueBanks(pool.banks));
  function choose(values) {
    const draw = random();
    if (typeof draw !== 'number' || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new TypeError('Random must return a number in [0, 1)');
    }
    return values[Math.floor(draw * values.length)];
  }
  let chosen;
  if (pairing === 'independent' || banks.length === 1) {
    chosen = banks.map(choose);
  } else {
    const assignments = [];
    for (const first of banks[0]) {
      for (const second of banks[1]) {
        if (first.chunkId !== second.chunkId) assignments.push([first, second]);
      }
    }
    // Both members sharing the sole eligible chunk is the only unavoidable overlap.
    if (!assignments.length) assignments.push([banks[0][0], banks[1][0]]);
    chosen = choose(assignments);
  }
  return chosen.map((bank, index) => ({ memberId: pools[index].memberId, chunkId: bank.chunkId, place: bank.place }));
}
