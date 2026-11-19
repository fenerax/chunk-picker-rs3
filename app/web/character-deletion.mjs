import { startupRetryAfter } from '../startup-read.mjs';

export function deletionControls({ el, fetch = globalThis.fetch, kind, characterId, pickerId, beforeDeparture = async () => () => {}, beforeSignOut = async () => {}, isCurrent = () => true, generation = () => 0, showReceipt, location = globalThis.location, randomId = () => crypto.randomUUID() }) {
  const root = el('div', undefined, 'form-stack deletion-review'), rows = el('div'), error = el('p', '', 'field-help'); error.setAttribute('role', 'alert');
  const params = new URLSearchParams({ kind, ...(kind === 'account' ? {} : { character: characterId, picker: pickerId }), deleteGroup: 'true' });
  const url = '/api/deletion?' + params;
  let review, attempt, release, completed;
  const request = async body => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.message || 'Deletion is unavailable.'), { status: response.status, retryAfterMs: startupRetryAfter(response) }); return value;
  };
  const button = (label, work) => {
    let retryAt = 0;
    const b = el('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', async () => {
      if (b.disabled || Date.now() < retryAt) return;
      b.disabled = true; error.textContent = '';
      try { await work(); } catch (e) {
        error.textContent = e.message;
        if (e.retryAfterMs > 0) { retryAt = Date.now() + e.retryAfterMs; const timer = setTimeout(() => { b.disabled = false; }, Math.min(2147483647, e.retryAfterMs)); timer?.unref?.(); }
      } finally { b.disabled = Date.now() < retryAt; }
    }); return b;
  };
  async function load() {
    if (release) throw new Error('Retry this deletion to recover its result before refreshing.');
    review = await request(); attempt = undefined; rows.replaceChildren();
    rows.append(el('p', 'This cannot be undone. Delete exactly these characters:'));
    for (const c of review.characters) rows.append(el('p', `${c.runescapeName || 'Unnamed character'} · ${c.characterId} · group ${c.pickerId}`, 'field-help'));
    if (!review.characters.length) rows.append(el('p', 'No characters. This deletes the empty login and its sign-in access.'));
    if (kind === 'account') rows.append(el('p', 'Your login, linked sign-ins, sessions and issued access will also be deleted. Other logins keep their characters and surviving group maps.'));
    else rows.append(el('p', `Your login remains available with ${review.keptCharacters.length} other character(s). An empty login stays empty until you choose Add character.`));
    rows.append(el('p', 'The deleted characters stop contributing access, supplies and task completion. Their exact keys, links, streams and pending reviews are revoked. Surviving groups keep their maps and historical attribution. Past maps and retained backups follow the existing retention policy.'));
    rows.append(el('p', review.backups.message, 'field-help'));
    const confirm = el('input'); confirm.type = 'checkbox';
    const label = el('label'); label.append(confirm, el('span', 'I reviewed the complete character and login deletion list.')); rows.append(label);
    const final = el('input'); final.type = 'checkbox';
    if (review.groups.length) {
      rows.append(el('p', `Also delete these final groups and all their saved gameplay: ${review.groups.join(', ')}.`));
      const label = el('label'); label.append(final, el('span', 'I explicitly confirm deletion of these groups and their saved gameplay.')); rows.append(label);
    }
    rows.append(button('Confirm deletion', async () => {
      const activeGeneration = generation();
      if (!isCurrent() || completed) return;
      if (!confirm.checked || review.groups.length && !final.checked) throw new Error('Confirm every reviewed deletion first.');
      attempt ??= { requestId: randomId(), reviewToken: review.reviewToken, confirmed: true, finalGroupConfirmed: final.checked };
      release ??= await beforeDeparture();
      if (!isCurrent() || generation() !== activeGeneration) { release(); release = undefined; return; }
      try {
        const result = await request(attempt); release(); release = undefined;
        completed = result;
      } catch (e) {
        if (e.status >= 400 && e.status < 500) { release?.(); release = undefined; }
        throw Object.assign(new Error(e.message + ' Retry the same confirmation to recover its result.'), { retryAfterMs: e.retryAfterMs });
      }
      const finish = async () => { await beforeSignOut(); location.assign(completed.href); };
      try { await finish(); }
      catch {
        const receipt = el('div', undefined, 'form-stack');
        receipt.append(el('p', 'Deletion complete. Browser storage could not be cleared. Restore browser storage, then continue.'),
          button(kind === 'account' ? 'Continue to sign in' : 'Open your characters', finish));
        if (showReceipt) showReceipt(receipt); else root.replaceChildren(receipt);
      }
    }));
  }
  root.append(rows, error, button('Refresh deletion review', load));
  void load().catch(e => { error.textContent = e.message; }); return root;
}
