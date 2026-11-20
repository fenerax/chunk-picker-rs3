export async function runBetaLinkCommand({ command, argument, expiryDays, perform, origin, registry }) {
  let body;
  if (command === 'beta-link-issue') {
    if (expiryDays !== undefined && (!/^\d+$/.test(expiryDays) || !Number.isSafeInteger(Number(expiryDays)) || Number(expiryDays) < 1)) throw new TypeError('Expiry must be positive whole days.');
    body = { action: 'issue', ...(argument !== undefined ? { label: argument } : {}), ...(expiryDays !== undefined ? { expiresInMs: Number(expiryDays) * 86400000 } : {}) };
  } else if (command === 'beta-link-list') {
    if (argument !== undefined || expiryDays !== undefined) throw new TypeError('List takes no arguments.');
    body = { action: 'list' };
  } else if (command === 'beta-link-revoke') {
    if (!argument || expiryDays !== undefined) throw new TypeError('Revoke requires one link ID.');
    body = { action: 'revoke', id: argument };
  } else throw new TypeError('Unknown beta-link command.');
  if (perform) return perform(body);
  return betaLinkOperation(registry, origin, body);
}

export async function betaLinkOperation(registry, origin, body) {
  if (body.action === 'list' && Object.keys(body).length === 1) return registry.listBetaLinks();
  if (body.action === 'revoke' && Object.keys(body).length === 2 && typeof body.id === 'string') return registry.revokeBetaLink(body.id);
  if (body.action !== 'issue' || !Object.keys(body).every(k => ['action', 'label', 'expiresInMs'].includes(k))) throw new TypeError('Invalid beta-link operation.');
  if (!origin || new URL(origin).origin !== origin || new URL(origin).protocol !== 'https:') throw new TypeError('An HTTPS public origin is required.');
  const { action, ...input } = body;
  const { secret, ...record } = await registry.issueBetaLink(input);
  return { ...record, link: `${origin}/auth/beta#${secret}` };
}
