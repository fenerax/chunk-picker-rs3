import { starterValues } from '../../app/open-starter-data.mjs';

// Public datasets omit the parked feature. Supply only synthetic rule rows,
// before dataset-runtime clones its inputs, to exercise the real resolver/UI.
const key = 'app/core/death-settings.mjs#deathSettingDefinitions';
starterValues[`${key}:contract`] = [
  { id: 'deathThresholdHours', type: 'number', default: 1000, min: 0, max: 1e9 },
  { id: 'defaultSecondsPerKill', type: 'number', default: 60, min: 0, max: 86400 },
  { id: 'monsterSecondsPerKill', type: 'object', default: {} },
  { id: 'showDeathChunks', type: 'boolean', default: true },
];
starterValues[`${key}:presentation`] = [
  { id: 'deathThresholdHours', label: 'Warning threshold', description: 'Warn when a task takes longer than this.' },
  { id: 'defaultSecondsPerKill', label: 'Seconds per kill (placeholder)', description: 'A starting guess until you time yourself.' },
  { id: 'monsterSecondsPerKill', label: 'Monster kill times', description: 'Use exact monster names.' },
  { id: 'showDeathChunks', label: 'Show time warnings', description: 'Show advisory warnings.' },
];
