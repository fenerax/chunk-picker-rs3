import { pickerOperationTest } from './helpers/picker-operations.mjs';

pickerOperationTest('degraded', 'reports a save-ready server with restart-required task health as running and degraded', { healthStatus: 'restart-required' });
