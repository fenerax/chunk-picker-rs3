const STYLESHEET_LINK_RE = /^([ \t]*)<link\s+rel=["']stylesheet["']\s+href=["'](\/[a-zA-Z0-9._-]+\.css)["']\s*\/?>[ \t]*(\r?\n)?/gm;

export function extractBundledStylesheets(html) {
  const hrefs = [];
  for (const match of html.matchAll(STYLESHEET_LINK_RE)) hrefs.push(match[2]);
  return hrefs;
}

export function rewriteHtmlStylesheets(html, bundleHref = '/app.css') {
  const matches = [...html.matchAll(STYLESHEET_LINK_RE)];
  if (matches.length < 2) return html;
  let replaced = false;
  return html.replace(STYLESHEET_LINK_RE, (_, indent, _href, newline = '') => {
    if (replaced) return '';
    replaced = true;
    return `${indent}<link rel="stylesheet" href="${bundleHref}">${newline}`;
  });
}
