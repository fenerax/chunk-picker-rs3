/** Inspect JSON text before JSON.parse discards repeated object members.
 * Values are retained as source slices so the report can distinguish identical
 * repeats from destructive collisions without changing archival bytes. */
export function findDuplicateJsonKeys(text) {
  JSON.parse(text); // Validate syntax, including escapes and trailing content.
  let at = 0, line = 1;
  const duplicates = [];
  const advance = () => { if (text[at++] === '\n') line++; };
  const whitespace = () => { while (/\s/.test(text[at] ?? '') && at < text.length) advance(); };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') break;
    }
    return JSON.parse(text.slice(start, at));
  }
  function value(path) {
    whitespace();
    if (text[at] === '{') {
      at++; whitespace();
      const seen = new Map();
      if (text[at] === '}') { at++; return; }
      while (at < text.length) {
        whitespace();
        const keyLine = line, key = string();
        whitespace(); at++; whitespace();
        const start = at;
        value([...path, key]);
        const current = { line: keyLine, value: JSON.parse(text.slice(start, at)) };
        if (seen.has(key)) {
          const previous = seen.get(key);
          duplicates.push({ path: [...path, key], firstLine: previous.line, laterLine: keyLine,
            before: previous.value, after: current.value });
        }
        seen.set(key, current);
        whitespace();
        if (text[at++] === '}') break;
      }
    } else if (text[at] === '[') {
      at++; whitespace();
      if (text[at] === ']') { at++; return; }
      let index = 0;
      while (at < text.length) {
        value([...path, index++]); whitespace();
        if (text[at++] === ']') break;
      }
    } else if (text[at] === '"') string();
    else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
  }
  value([]);
  return duplicates;
}
