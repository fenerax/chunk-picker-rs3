import { createScreenUsage } from './screen-usage.mjs';
import { galleryUsageTime } from './gallery-usage-fixture.mjs';

export async function renderGalleryUsage(c, entry) {
  // Do not start Usage's tracking listeners, timer or beacon lifecycle.
  let enabled = String(entry.counting !== false);
  createScreenUsage(c, { storage: { getItem: () => enabled, setItem: (_key, value) => { enabled = value; } },
    now: () => new Date(galleryUsageTime) });
  if (entry.render === 'usage-settings') {
    c.applySession({ readOnly: entry.viewer === true, admin: false, memberId: entry.viewer ? undefined : 'player1' });
    c.applyPreferences();
    return c.usage.openSettings();
  }
  await c.usage.openView();
  if (entry.person) {
    const person = c.$('dialog-content').querySelector('.usage-controls select');
    person.value = entry.person;
    person.dispatchEvent(new Event('change'));
  }
}
