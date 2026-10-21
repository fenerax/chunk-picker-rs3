import { galleryEntries } from './gallery-catalogue.mjs';
import { applyTheme, themePalettes } from './map-tools.mjs';
const theme = document.getElementById('gallery-theme'), width = document.getElementById('gallery-width'), frame = document.getElementById('gallery-preview');
const preferredThemes = ['dark', 'gray', 'light'];
for (const id of [...preferredThemes, ...Object.keys(themePalettes).filter(id => !preferredThemes.includes(id))]) {
  const option = document.createElement('option'); option.value = id; option.textContent = id === 'mono' ? 'Monochrome' : id[0].toUpperCase() + id.slice(1); theme.append(option);
}
theme.value = 'dark';
for (const entry of galleryEntries) { const a = document.createElement('a'); a.href = `#${entry.id}`; a.textContent = entry.label; a.dataset.entry = entry.id; document.getElementById('gallery-index').append(a); }
function render() {
  const entry = galleryEntries.find(entry => entry.id === location.hash.slice(1)) ?? galleryEntries[0];
  applyTheme(document.documentElement, theme.value);
  document.getElementById('gallery-label').textContent = entry.label;
  document.getElementById('gallery-source').textContent = entry.source;
  document.getElementById('gallery-note').textContent = entry.note ?? 'Not saved: gallery';
  for (const a of document.querySelectorAll('[data-entry]')) a.setAttribute('aria-current', String(a.dataset.entry === entry.id));
  frame.width = width.value; frame.src = `/gallery/preview?entry=${entry.id}&theme=${theme.value}`;
}
theme.addEventListener('change', render); width.addEventListener('change', render); window.addEventListener('hashchange', render); render();
