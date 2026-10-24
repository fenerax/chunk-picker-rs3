// Pure rules only. Importing this module starts no service or browser.
export const CASES = Object.freeze(['ignore', 'consume', 'cancel', 'baseline', 'candidate']);
export const WINDOW_MS = 5000;
export const SOURCE_PIN = '6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const RESPONSE_TEXT = '{"accepted":true}';
export const CONTROL_PAYLOAD = '{"events":[]}';
export const COUNTER_PAYLOAD = JSON.stringify({ counts: [{ id: 'search', actor: 'r139-author', device: 'desktop', day: '2026-10-01', count: 1 }] });
export const PINS = Object.freeze({
  node: 'v24.19.0', nodeSha256: 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12',
  image: 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac',
  playwright: '1.62.1', chromium: '151.0.7922.34', revision: '1234',
  executable: '/ms-playwright/chromium-1234/chrome-linux64/chrome',
  baseline: '5a0f33a978030884c187bb4740199efe827bec39a7d3225ed920c1f09990c67a',
  candidate: '6efa06d912fefd93e05877bcdaead28121828c14ccf73d173123c2c0c1ec072e',
  catalogue: '126eba45bf8bbf4549107b5c9d7cb1b510ddf4a262f702d003629a426272e1ff',
  ledger: '5bad0bff91320fb3ebba510de124bdb98e611d8c1cda4de85e8fb9c9e2fd60c3',
  patch: '08560be23d83b0179a0f9a8e2006e1a7f0b66d36eb1ff383c68d30d2b74ca8c4',
});
export const OPS = Object.freeze(['entry-admit','manifest-verify','runtime-verify','source-verify','fixture-listen',
  'browser-launch','browser-version','cdp-attach','navigation','module-load','setup-drain','policy-issue',
  'checkpoint','body-survey','validate','network-event','http-request','page-error','page-crash','browser-disconnected',
  'cleanup-cdp','cleanup-browser','cleanup-http','write-result','deadline']);
export const GUARD_CODES = Object.freeze(['manifest-argument','manifest-sha','manifest-shape','manifest-member','manifest-member-sha','manifest-closure',
  'runtime-pin','runtime-executable','node-sha','package-browser-pin','pinned-module-sha','source-module-sha','fresh-output','trace-cap','unexpected-http',
  'server-case-identity','payload-cap','payload-identity','socket-cap','browser-version','request-epoch','response-request-identity',
  'terminal-request-identity','post-path','pre-navigation-coverage','setup-network','response-url-identity','response-status-identity',
  'observational-coverage','result-cap','fixture-listen','cdp-detach','browser-close','http-close','r139-deadline']);
export const INTEGER_FIELDS = Object.freeze(['observedPostCount','requestOrdinal','targetOrdinal','sessionOrdinal','documentOrdinal',
  'responseStatus','requestIdentityMatched','responseIdentityMatched','bodyUsedOnHeaders','bodyUsedAfterFlush','bodyUsedAtSurvey',
  'bodyReadBytes','flushReturned','cancelComplete','serverAcceptedRequests','serverAcceptedEvents','serverPayloadBytes',
  'serverResponseBytes','serverFinishedByCutoff','serverClosedByCutoff','surveyAfterCutoffUs']);
export const CASE_ENUM_FIELDS = Object.freeze({
  terminal: ['loadingFinished','loadingFailed-canceled','loadingFailed-other','unobserved'],
  action: ['none','pending','complete','failed','module','unknown'],
  visibility: ['visible','hidden','unknown'], consent: ['default','enabled','disabled','not-applicable','unknown'],
});
export function emptyCases() {
  return Object.fromEntries(CASES.map(name => [name, { ...Object.fromEntries(INTEGER_FIELDS.map(key => [key, null])),
    terminal: 'unobserved', action: 'unknown', visibility: 'unknown', consent: 'unknown' }]));
}
export function terminalAt(post, cutoff) {
  if (!post) return 'unobserved';
  if (Number.isFinite(post.finishedAt) && post.finishedAt <= cutoff) return 'loadingFinished';
  if (Number.isFinite(post.failedAt) && post.failedAt <= cutoff) return post.canceled === true ? 'loadingFailed-canceled' : 'loadingFailed-other';
  return 'unobserved';
}
export function acceptPayload(name, text) {
  if (!CASES.includes(name)) return false;
  return text === (name === 'baseline' || name === 'candidate' ? COUNTER_PAYLOAD : CONTROL_PAYLOAD);
}
export function observationComplete(value) {
  if (value?.schema !== 'r139-body-lifecycle-v1' || value.mode !== 'r139-five-case-component-v1' || value.acceptance !== false
    || value.cleanupPassed !== true || value.metrics?.r139WindowMs !== WINDOW_MS || value.metrics?.r139CaseCount !== 5
    || value.metrics?.r139CoverageTargets !== 5 || value.metrics?.r139LedgerFaultCount !== 0
    || value.metrics?.r139LedgerDropped !== 0 || value.metrics?.r139LedgerPendingWrites !== 0
    || value.metrics?.r139PreClosePersisted !== 1) return false;
  const clock=value.metrics;
  if (![clock.r139WindowStartMs,clock.r139CutoffMs,clock.r139CheckpointCapturedMs].every(Number.isFinite)
    || Math.abs(clock.r139CutoffMs-clock.r139WindowStartMs-WINDOW_MS)>1e-6
    || clock.r139CheckpointCapturedMs<clock.r139CutoffMs) return false;
  const seen = new Set();
  for (const [index, name] of CASES.entries()) {
    const row = value.r139Cases?.[name];
    if (!row || row.observedPostCount !== 1 || row.responseStatus !== 200 || row.requestIdentityMatched !== 1
      || row.responseIdentityMatched !== 1 || row.bodyUsedOnHeaders !== 0 || row.serverAcceptedRequests !== 1
      || row.serverAcceptedEvents !== (index >= 3 ? 1 : 0) || row.serverResponseBytes !== 17
      || row.serverFinishedByCutoff !== 1 || row.serverClosedByCutoff !== 1 || row.targetOrdinal !== index + 1
      || !Number.isSafeInteger(row.requestOrdinal) || row.requestOrdinal < 1 || seen.has(row.requestOrdinal)
      || !CASE_ENUM_FIELDS.terminal.includes(row.terminal)) return false;
    seen.add(row.requestOrdinal);
    if (name === 'ignore' && row.action !== 'none') return false;
    if (name === 'consume' && (row.action !== 'complete' || row.bodyReadBytes !== 17)) return false;
    if (name === 'cancel' && (row.action !== 'complete' || row.cancelComplete !== 1)) return false;
    if (index >= 3 && row.flushReturned !== 1) return false;
    for (const key of ['bodyUsedOnHeaders','bodyUsedAfterFlush','bodyUsedAtSurvey']) if (![0,1,null].includes(row[key])) return false;
  }
  return value.metrics.r139ClosedPages === 5 && value.metrics.r139DetachedSessions === 5
    && value.metrics.r139BrowserCloseCompleted === 1 && value.metrics.r139ServerCloseCompleted === 1
    && value.metrics.r139OpenFixtureSockets === 0;
}
