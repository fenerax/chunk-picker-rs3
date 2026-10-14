const MESSAGE_LIMIT = 2000;

function plainText(value, limit = Infinity) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
  let bounded = '';
  for (const character of normalized) {
    if (bounded.length + character.length > limit) break;
    bounded += character;
  }
  return bounded.replace(/[\\`*_~|<>\[\]]/gu, '\\$&').replace(/@/gu, '@\u200b');
}

/** Format Discord bullets without changing inputs; ordinary copies fit one message. */
export function formatCopyList({ player, title, groups, date, range, limit = MESSAGE_LIMIT }) {
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const header = range === undefined
    ? `${plainText(player, 100)} — ${plainText(title, 80)} (${count}) — ${plainText(date, 32)}`
    : `${plainText(player, 100)} · ${plainText(title, 80)} · ${plainText(range, 80)} · ${count} ${count === 1 ? 'task' : 'tasks'}`;
  let text = header;
  let copiedCount = 0;
  let fittingPrefix = header;
  let fittingCount = 0;

  for (const group of groups) {
    let firstItem = true;
    for (const item of group.items) {
      const label = firstItem ? plainText(group.label) : '';
      const addition = `${label ? `\n\n${label}:` : ''}\n- ${plainText(item)}`;
      const omittedCount = count - copiedCount - 1;
      const suffix = omittedCount ? `\n…and ${omittedCount} more` : '';
      if (text.length + addition.length > limit) {
        return {
          text: `${fittingPrefix}\n…and ${count - fittingCount} more`,
          count,
          copiedCount: fittingCount,
          omittedCount: count - fittingCount,
        };
      }
      text += addition;
      copiedCount += 1;
      firstItem = false;
      if (text.length + suffix.length <= limit) {
        fittingPrefix = text;
        fittingCount = copiedCount;
      }
    }
  }

  return { text, count, copiedCount, omittedCount: 0 };
}
