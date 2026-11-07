// One acknowledged chunk at a time; the retained source proof never moves.
export const ELIGIBILITY_CHUNK_BYTES = 1024 * 1024;
export const ELIGIBILITY_HANDOFF_BYTES = 8 * (ELIGIBILITY_CHUNK_BYTES + 8192);

export const eligibilityChunk = message => message?.type === 'eligibility-seed' ? message.proof?.proof
  : message?.result?.proof?.offset !== undefined ? message.result.proof : undefined;

// These dedicated control packets contain one owned byte view and no other
// binary data. The IPC codec sends an ArrayBuffer so its decoder allocates
// dedicated storage, rather than a typed view into the IPC parser's buffer.
export function eligibilityTransferList(message) {
  const bytes = eligibilityChunk(message)?.bytes;
  return bytes instanceof ArrayBuffer ? [bytes] : bytes?.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
}
export function releaseEligibilityChunk(message) {
  for (const buffer of eligibilityTransferList(message)) {
    if (buffer.byteLength) buffer.transfer(0);
  }
}
