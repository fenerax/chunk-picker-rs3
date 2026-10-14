import { selectedDataset } from '../dataset-runtime.mjs';

export function datasetStatusText(status = selectedDataset.status()) {
  const label = value => typeof value === 'string' && /^[a-zA-Z0-9._+-]{1,80}$/.test(value) ? value : 'unknown';
  const summary = `Game data: ${label(status.id)} · ${label(status.version)} · ${label(status.health)}`;
  if (!status.coverage || typeof status.coverage !== 'object') return summary;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
  const names = { wikiPages: 'Wiki pages', depositBoxes: 'deposit boxes', routes: 'conditional routes' };
  const coverage = ['cells', 'connections', 'sources', 'tasks', 'wikiPages',
    ...['shops', 'banks', 'depositBoxes', 'routes'].filter(key => Number.isSafeInteger(status.coverage[key]))]
    .map(key => `${count(status.coverage[key])} ${names[key] ?? key}`).join(', ');
  const omitted = Array.isArray(status.coverage.omitted) ? status.coverage.omitted
    .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).join('; ') : '';
  return `${summary}. Coverage: ${coverage}.${omitted ? ` Omitted: ${omitted}.` : ''}`;
}
