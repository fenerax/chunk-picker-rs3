/** Run with CDP Runtime.evaluate: `(${detectOverflow})()`.
 * No app hooks or dependencies. Hits are observations requiring triage, not
 * automatic defect severities. Call again after scrolling/revealing a surface.
 */
export function detectOverflow({ root = null, tolerance = 1, minTouch = 44 } = {}) {
  const scope = root ? document.querySelector(root) : document.querySelector('dialog[open]:modal') ?? document.body;
  if (!scope) return { hits: [], checked: 0, exclusions: {}, error: 'ROOT_NOT_FOUND' };
  const hits = [], exclusions = {}, seen = new Set();
  const exclude = reason => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
  const rect = r => Object.fromEntries(['x', 'y', 'width', 'height', 'left', 'right', 'top', 'bottom'].map(k => [k, Math.round(r[k] * 100) / 100]));
  const selector = node => {
    if (node.id) return '#' + CSS.escape(node.id);
    if (node === document.documentElement) return 'html';
    const parts = [];
    for (let current = node; current && current !== document.body; current = current.parentElement) {
      if (!current.parentElement) { parts.unshift(current.tagName.toLowerCase()); break; }
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      parts.unshift(current.tagName.toLowerCase() + ':nth-child(' + ([...current.parentElement.children].indexOf(current) + 1) + ')');
    }
    return parts.join(' > ');
  };
  const visible = node => {
    const s = getComputedStyle(node), r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && s.visibility === 'visible' && s.display !== 'none' && Number(s.opacity) !== 0 && node.checkVisibility();
  };
  const add = (kind, node, measurements) => {
    const key = kind + selector(node);
    if (seen.has(key)) return;
    seen.add(key); hits.push({ kind, selector: selector(node), tag: node.tagName.toLowerCase(), classes: node.className?.baseVal ?? node.className,
      measurements: { box: rect(node.getBoundingClientRect()), ...measurements } });
  };
  const scrollbar = (node, axis) => {
    const s = getComputedStyle(node), horizontal = axis === 'x';
    const overflow = horizontal ? s.overflowX : s.overflowY;
    const gutter = horizontal ? node.offsetHeight - node.clientHeight - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth)
      : node.offsetWidth - node.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
    const pseudo = getComputedStyle(node, '::-webkit-scrollbar');
    return /auto|scroll/.test(overflow) && s.scrollbarWidth !== 'none' && pseudo.display !== 'none' && gutter > tolerance;
  };
  const affordance = node => {
    if (scrollbar(node, 'x')) return 'visible-scrollbar';
    const controls = [...(node.parentElement ?? node).querySelectorAll('button,[role=button]')].filter(visible);
    const arrows = controls.filter(n => /scroll|previous|next|left|right/i.test(n.getAttribute('aria-label') ?? n.title ?? ''));
    if (arrows.length >= 2) return 'visible-scroll-arrows';
    const s = getComputedStyle(node), before = getComputedStyle(node, '::before'), after = getComputedStyle(node, '::after');
    const fade = [s.maskImage, s.backgroundImage, before.backgroundImage, after.backgroundImage].some(x => x?.includes('gradient'));
    if (fade && controls.some(n => /more/i.test(n.textContent))) return 'fade-and-more';
    return null;
  };
  const geometry = node => {
    const r = node.getBoundingClientRect();
    let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    const clips = [];
    let verticalScroll = false, innerScrollY = false, hardClipY = false;
    for (let p = node.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect();
      const x = /hidden|clip|auto|scroll/.test(s.overflowX), y = /hidden|clip|auto|scroll/.test(s.overflowY);
      const cutsY = y && (r.top < b.top - tolerance || r.bottom > b.top + p.clientHeight + tolerance);
      if (cutsY && /hidden|clip/.test(s.overflowY) && !innerScrollY) hardClipY = true;
      if (x) { left = Math.max(left, b.left + p.clientLeft); right = Math.min(right, b.left + p.clientLeft + p.clientWidth); }
      if (y) { top = Math.max(top, b.top + p.clientTop); bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight); }
      if (x && (r.left < b.left - tolerance || r.right > b.left + p.clientWidth + tolerance)
        || y && (r.top < b.top - tolerance || r.bottom > b.top + p.clientHeight + tolerance)) {
        clips.push({ selector: selector(p), overflowX: s.overflowX, overflowY: s.overflowY, box: rect(b) });
      }
      if (/auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight + tolerance) { verticalScroll = true; innerScrollY = true; }
    }
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const hit = document.elementFromPoint(centre.x, centre.y);
    const ownsCentre = hit === node || node.contains(hit) || hit?.closest('label')?.contains(node);
    const offscreenY = r.bottom > innerHeight + tolerance || r.top < -tolerance;
    const documentScroll = document.scrollingElement.scrollHeight > innerHeight + tolerance;
    const unreachableY = hardClipY || offscreenY && !verticalScroll && (!documentScroll || getComputedStyle(node).position === 'fixed');
    return { unreachableY, clips, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), centre, ownsCentre: !!ownsCentre,
      centreHit: hit ? selector(hit) : null, verticalScroll, r };
  };
  const elements = [scope, ...scope.querySelectorAll('*')].filter(visible);
  const interactive = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem]';
  const groups = 'nav,menu,[class*=toolbar],[class*=menu],[class*=chip],[class*=button-group],[class*=actions],[class*=filters],[role=tablist],[role=toolbar],[role=menu],[role=group],.tab-bar,.toolbar-group,.more-tools-menu,.map-toolbar,.task-options,.form-actions,.panel-tools,.chunk-actions,.leads-to,.duo-task-filters,.duo-task-chooser,.task-claim-confirm,.interior-choices';
  for (const node of elements) {
    if (node.closest('.sr-only,.gallery-safety-note') || node.matches('option,optgroup,svg,svg *')) continue;
    const r = node.getBoundingClientRect(), g = geometry(node);
    // Ordinary vertical content belongs to another capture page. Horizontal
    // offscreen content is never excused here. Pagination records its own limit.
    const horizontal = r.right > innerWidth + tolerance || r.left < -tolerance || g.visibleWidth < r.width - tolerance;
    if (!horizontal && !g.unreachableY && (r.bottom <= 0 || r.top >= innerHeight || g.visibleHeight === 0)) { exclude('vertical-page'); continue; }
    if (node.matches(groups) && node.scrollWidth > node.clientWidth + tolerance) {
      const cue = affordance(node);
      if (cue) exclude(cue); else add('hidden-group-overflow', node, { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX, scrollbarWidth: getComputedStyle(node).scrollbarWidth, affordance: null });
    }
    if (node.matches(interactive) && !node.disabled && !node.closest('[inert]')) {
      if (r.width <= 1 && r.height <= 1 || getComputedStyle(node).clip !== 'auto') { exclude('accessible-proxy'); continue; }
      const clippedX = g.visibleWidth < r.width - tolerance;
      const clippedY = g.visibleHeight < r.height - tolerance;
      const offscreenX = r.right > innerWidth + tolerance || r.left < -tolerance;
      const offscreenY = r.bottom > innerHeight + tolerance || r.top < -tolerance;
      const hardClip = g.unreachableY;
      if (clippedX || offscreenX || (clippedY || offscreenY) && (!g.verticalScroll || hardClip)) {
        add('clipped-control', node, { clips: g.clips, visibleWidth: g.visibleWidth, visibleHeight: g.visibleHeight,
          centre: g.centre, ownsCentre: g.ownsCentre, centreHit: g.centreHit, outsideViewport: offscreenX || offscreenY });
      } else if (!g.ownsCentre && g.visibleWidth > 0 && g.visibleHeight >= Math.min(10, r.height) && !offscreenY) {
        add('occluded-control', node, { centre: g.centre, ownsCentre: false, centreHit: g.centreHit });
      }
      if (matchMedia('(pointer:coarse)').matches) {
        let target = node;
        if (node.matches('input[type=checkbox],input[type=radio]') && node.labels?.length) {
          // The control remains a hit region even when its separate text label
          // is shorter. Prefer the largest minimum dimension, not label alone.
          target = [node, ...[...node.labels].filter(visible)].sort((a, b) => {
            const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
            return Math.min(y.width, y.height) - Math.min(x.width, x.height);
          })[0];
        }
        const b = target.getBoundingClientRect();
        if (b.width < minTouch || b.height < minTouch) add('small-touch-target', node, { target: selector(target), width: b.width, height: b.height, minTouch });
      }
    }
    if (node.matches('input,select,textarea,canvas,img,script,style')) continue;
    // Text-node ranges avoid flagging a parent's legitimately tall descendants.
    for (const text of [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) {
      const range = document.createRange(); range.selectNodeContents(text);
      const boxes = [...range.getClientRects()];
      if (boxes.some(b => b.left < r.left - tolerance || b.right > r.right + tolerance)) {
        add('text-overflow', node, { textBoxes: boxes.map(rect), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
          textOverflow: getComputedStyle(node).textOverflow, whiteSpace: getComputedStyle(node).whiteSpace });
      }
      if (node.matches('button,a,summary,[role=button]') && r.width < 120) {
        for (const match of text.textContent.matchAll(/\p{L}{3,}/gu)) {
          range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].map(b => Math.round(b.top)));
          if (lines.size > 1) { add('mid-word-wrap', node, { columnWidth: r.width, wordLength: match[0].length, lines: lines.size }); break; }
        }
      }
    }
  }
  return { hits, checked: elements.length, exclusions, viewport: { width: innerWidth, height: innerHeight }, coarse: matchMedia('(pointer:coarse)').matches };
}
