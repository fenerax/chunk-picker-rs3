// Amounts typed the RuneScape way: 10k, 2.5m, 1b, 1t. Commas, spaces and
// underscores between digits are ignored. Anything else is NaN.
const exponents = { '': 0, k: 3, m: 6, b: 9, t: 12 };

export function parseAmount(text) {
  const match = /^(\d+)(?:\.(\d*))?([kmbt]?)$|^\.(\d+)([kmbt]?)$/i.exec(String(text ?? '').trim().replace(/(?<=\d)[,_ ](?=\d)/g, ''));
  if (!match) return NaN;
  const whole = match[1] ?? '0', fraction = match[2] ?? match[4] ?? '', shift = exponents[(match[3] ?? match[5]).toLowerCase()];
  // Move the decimal point in the text so 1.1k is exactly 1100.
  const digits = whole + fraction.padEnd(shift, '0');
  const point = whole.length + shift;
  return Number(digits.slice(0, point) + (digits.length > point ? `.${digits.slice(point)}` : ''));
}

/** Turns a number input into a text box that also takes k, m, b and t.
 * Range and whole-number checks move into the form's own validity. */
export function amountInput(input, { min = -Infinity, max = Infinity, whole = false } = {}) {
  input.type = 'text';
  // A numbers-only phone keyboard has no k, m or b, so keep the normal one.
  input.setAttribute('data-amount', whole ? 'whole' : 'any');
  input.setAttribute('autocomplete', 'off');
  input.spellcheck = false;
  const check = () => {
    const text = String(input.value ?? '').trim(), amount = parseAmount(text);
    let message = '';
    if (text && Number.isNaN(amount)) message = 'Enter a number. You can use k, m, b or t, like 10k or 2.5m.';
    else if (text && (amount < min || amount > max)) message = `Enter a number from ${min.toLocaleString('en-GB')} to ${max.toLocaleString('en-GB')}.`;
    else if (text && whole && !Number.isSafeInteger(amount)) message = 'Enter a whole number.';
    input.setCustomValidity?.(message);
  };
  input.addEventListener('input', check);
  check();
  return input;
}
