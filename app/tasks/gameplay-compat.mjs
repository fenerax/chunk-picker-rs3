const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Decode the encoding used by the upstream picker's encodeObject helper. */
export function decodeLegacyText(value) {
  if (typeof value !== 'string') return value;
  // Compiled catalogue labels are already plain text. Avoid the Firebase/URI
  // decoding pipeline for every potential objective when no marker is present.
  if (!/(?:%|-_-|_-[0-9a-f]{2}|-2H|<)/i.test(value)) return value;
  let encoded = value.replaceAll('-_-', '%');
  // Older exports occasionally omitted the first hyphen in the Firebase marker.
  encoded = encoded.replace(/_-(?=[0-9a-f]{2})/gi, '%');
  encoded = encoded.replaceAll('%25', '%')
    .replaceAll(/%2E/gi, '.').replaceAll(/%2F/gi, '#').replaceAll(/%2G/gi, '/')
    .replaceAll(/%2H/gi, "'").replaceAll(/-2H/gi, "'").replaceAll(/%2I/gi, ',')
    .replaceAll(/%2J/gi, '+').replaceAll(/%2Q/gi, '!')
    .replace(/%(?![0-9a-f]{2})/gi, '%25');
  try { encoded = decodeURIComponent(encoded); } catch { return value; }
  return encoded.replaceAll(/%2E/gi, '.').replaceAll(/%2F/gi, '#')
    .replaceAll(/%2G/gi, '/').replaceAll(/%2H/gi, "'").replaceAll(/-2H/gi, "'")
    .replaceAll(/%2I/gi, ',').replaceAll(/%2J/gi, '+').replaceAll(/%2Q/gi, '!')
    .replace(/<[^>]*>/g, '');
}

/** A completed conversion makes absent authored overrides mean automatic. */
export function hasGameplayMigration(state, member, field) {
  const migration = state.legacy?.gameplayMigration;
  if (!record(migration) || member.sourceMapId == null) return false;
  if (['areaOverrides', 'sourceBacklogs'].includes(field) && migration.schemaVersion < 2) return false;
  if (Array.isArray(migration.migratedMembers)) return migration.migratedMembers.some(entry => record(entry) && entry.memberId === member.id && entry.sourceMapId === member.sourceMapId);
  // Version 1 converted all then-present map owners, before per-owner markers
  // existed. Its deletable fields must not be imported again during an upgrade.
  return migration.schemaVersion === 1;
}

