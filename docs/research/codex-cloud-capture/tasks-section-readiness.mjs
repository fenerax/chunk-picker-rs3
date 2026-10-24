// Passive, serializable DOM readiness only. No app calls, mutations or timing oracle.
// In the pinned UI, Tasks auto-opens DETAILS and CSS hides its SUMMARY.
export function selectedTasksSectionReady() {
  const visible = node => {
    if (!node?.isConnected || node.hidden || node.closest('[hidden]')) return false;
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  };
  const content = document.getElementById('chunk-content'), info = document.getElementById('chunk-info');
  if (!visible(content) || !info || info.hidden) return false;
  const tasks = [...content.querySelectorAll('button[data-tab="tasks"][role="tab"]')];
  if (tasks.length !== 1) return false;
  const tab = tasks[0], panelId = tab.getAttribute('aria-controls');
  if (!visible(tab) || tab.getAttribute('aria-selected') !== 'true' || !tab.id || !panelId) return false;
  const panel = document.getElementById(panelId);
  if (!panel || !content.contains(panel) || panel.getAttribute('role') !== 'tabpanel'
      || panel.getAttribute('aria-labelledby') !== tab.id || !visible(panel)) return false;
  const sections = [...panel.children].filter(node => node.tagName === 'DETAILS'
    && node.classList.contains('chunk-section')
    && [...node.children].filter(child => child.tagName === 'SUMMARY' && child.textContent === 'Possible Tasks').length === 1);
  return sections.length === 1 && sections[0].open === true && visible(sections[0]);
}
