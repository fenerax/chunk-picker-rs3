// Capture-only appearance changes reuse one fixture document per entry. The
// ordinary gallery still navigates between samples and never exposes this hook.
export function createGalleryCapture(c, document, themes, waitFrame) {
  return async theme => {
    if (!Object.hasOwn(themes, theme)) throw new Error('Unknown gallery theme');
    c.member().preferences.theme = theme;
    if (!c.canWrite()) c.viewerPreferences.theme = theme;
    c.preferenceSignature = undefined;
    c.applyPreferences();
    c.phoneLayout?.select(c.phoneLayout.tab, { persist: false });
    await waitFrame(); // Let the real responsive layout react to changed metrics.
    c.map.resize(); c.renderMapState();
    for (const node of document.querySelectorAll('*')) {
      if (node.scrollTop) node.scrollTop = 0;
      if (node.scrollLeft) node.scrollLeft = 0;
    }
    document.defaultView.scrollTo(0, 0);
    await waitFrame();
    document.documentElement.dataset.galleryTheme = theme;
    return true;
  };
}
