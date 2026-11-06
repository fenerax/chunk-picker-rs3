// These probes use only a synthetic maintenance-fenced operator configuration.
// All CLIs must refuse with their own diagnostic, never exit 0 without acting.
export const runtimeCliChecks = Object.freeze([
  ['scripts/linux/start-check.mjs', [], 'Service start blocked;'],
  ['scripts/linux/serve.mjs', [], 'Picker startup refused.'],
  ['scripts/linux/operator.mjs', ['health'], 'Operator command refused;'],
  ['scripts/linux/operator.mjs', ['backup'], 'Operator command refused;'],
]);
// Frozen #128 probe contract; later CLIs must not become rollback requirements.
export const tools128CliChecks = Object.freeze([
  ...runtimeCliChecks,
  ['scripts/linux/probe.mjs', [], 'Recovery probe refused.'],
  ['scripts/linux/prewarm.mjs', [], 'Calculator preparation unavailable.'],
  ['scripts/linux/rehearse.mjs', [], 'Scratch rehearsal refused;'],
  ['scripts/linux/tools-install.mjs', [], 'Tools switch refused:'],
  ['scripts/linux/tools-package.mjs', [], 'Tools package refused.'],
  ['scripts/release/vps/release.mjs', [], 'VPS release refused;'],
  ['scripts/release/vps/bundle.mjs', [], 'Candidate preparation refused;'],
  ['scripts/release/vps/review.mjs', [], 'VPS additions review refused:'],
  ['scripts/release/pc/quick-build.mjs', [], 'Quick build refused:'],
  ['scripts/private-companion/release-pack-check.mjs', [], 'Pack compatibility refused;'],
]);
export const toolsCliChecks = Object.freeze([
  ...tools128CliChecks,
  ['scripts/linux/bootstrap-alerts.mjs', [], 'Alert bootstrap refused;'],
  ['scripts/linux/notify.mjs', [], 'Notification pending;'],
  ['scripts/linux/monitor.mjs', [], 'Monitor failed;'],
  ['scripts/linux/offhost-backup.mjs', [], 'Off-site backup failed;'],
  ['scripts/linux/ops-status.mjs', [], 'Test ping failed.'],
  ['scripts/linux/scratch-alerts.mjs', [], 'Local rehearsal failed;'],
]);
