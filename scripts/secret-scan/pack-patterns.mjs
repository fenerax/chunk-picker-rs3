// Pack-only provenance checks. Public packs must not carry any home directory,
// including account names that are generic examples in repository source.

function decoded(value) {
  let text = value;
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/\\u\{([a-f0-9]{1,6})\}|\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi, (whole, extended, unicode, hex) => {
      const point = parseInt(extended ?? unicode ?? hex, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }).replace(/(?:%[a-f0-9]{2})+/gi, encoded => {
      try { return decodeURIComponent(encoded); }
      catch { return Buffer.from(encoded.replaceAll('%', ''), 'hex').toString('utf8'); }
    });
  }
  return text;
}

/** Return locations only. Never retain or return the matched home path. */
export function inspectPackPaths(text, { escaped = false } = {}) {
  // `escaped` is accepted for the same call shape as the core scanner. Both
  // spellings must block in packs, irrespective of the containing file type.
  void escaped;
  const rawLines = String(text).split('\n');
  const parts = rawLines.map(line => decoded(line.replace(/\r$/, '')));
  const origin = [], stable = [];
  for (let index = 0; index < parts.length; index++) {
    const lines = parts[index].split(/\r\n|\r|\n/);
    for (const line of lines) {
      origin.push(index + 1);
      stable.push(lines.length === 1);
    }
  }
  const normalized = parts.join('\n').replace(/\r\n|\r/g, '\n').replace(/\\+/g, '/');
  const breaks = [];
  for (let index = normalized.indexOf('\n'); index !== -1; index = normalized.indexOf('\n', index + 1)) breaks.push(index);
  const lineAt = offset => {
    let low = 0, high = breaks.length;
    while (low < high) { const middle = (low + high) >> 1; if (breaks[middle] < offset) low = middle + 1; else high = middle; }
    return low;
  };
  const found = new Map();
  // POSIX roots need a source boundary so public URL routes are
  // not mistaken for a filesystem path. Drive paths cannot be URL routes.
  const pattern = /\b[a-z]:\/+users\/+[^/\s"'`<>;,)}\]]+|\bfile:\/+(?:home|users)\/+[^/\s"'`<>;,)}\]]+|(?:^|[\s"'`=(\[,;\uFFFD])\/+(?:home|users)\/+[^/\s"'`<>;,)}\]]+|[%]userprofile[%]/gim;
  for (const match of normalized.matchAll(pattern)) {
    const offset = match.index + (match[0].match(/^\s+/)?.[0].length ?? 0);
    const index = lineAt(offset), line = origin[index] ?? 1;
    const previous = found.get(line);
    found.set(line, { category: 'machine-path', line, stable: (previous?.stable ?? true) && (stable[index] ?? false) });
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

export const hasPackHomePath = text => inspectPackPaths(text).length > 0;
