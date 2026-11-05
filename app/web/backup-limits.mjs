// Source-save budget plus room for restore provenance and the portable manifest.
export const MAX_BACKUP_BYTES = 208 * 1024 * 1024;
export const MAX_PORTABLE_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = MAX_PORTABLE_BACKUP_BYTES + 1024 * 1024;
export const BACKUP_LIMIT_LABEL = `${MAX_PORTABLE_BACKUP_BYTES / (1024 * 1024)} MiB`;
