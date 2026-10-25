// Bound nesting before JSON.parse allocates a deeply nested object graph.
// JSON.parse remains responsible for syntax, including escapes and delimiters.
export function parseRequestJSON(text, maxDepth = 128) {
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > maxDepth) throw Object.assign(new Error('JSON nesting exceeds the 128 level limit.'), { status: 400 });
    } else if (character === '}' || character === ']') depth--;
  }
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Request body is not valid JSON.'), { status: 400 }); }
}
