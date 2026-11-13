// Retain bounded exception chains, including fetch's transport cause. These
// receipts describe synthetic requests; they never copy request headers/bodies.
export function errorReceipt(error, depth = 0) {
  if (!error || depth >= 5) return null;
  if (typeof error !== 'object') return { message: String(error) };
  return { name: error.name ?? 'Error', message: error.message ?? '',
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.cause ? { cause: errorReceipt(error.cause, depth + 1) } : {}) };
}
export function failureOutcome(error) {
  const chain = []; for (let current = error; current && chain.length < 5; current = current.cause) chain.push(current);
  const status = chain.find(row => row.status !== undefined)?.status ?? (chain.some(row => row.name === 'TimeoutError') ? 'timeout' : 'network-error');
  return { status, error: errorReceipt(error), requestId: chain.find(row => row.requestId)?.requestId,
    ...Object.assign({}, ...chain.map(row => Object.fromEntries(['inheritedPreflightId', 'inheritedCooldownId', 'inheritedRequestId']
      .filter(key => row[key]).map(key => [key, row[key]])))) };
}
