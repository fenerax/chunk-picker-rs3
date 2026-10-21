import { pickerOperationTest } from './helpers/picker-operations.mjs';

pickerOperationTest('graceful', 'waits for authenticated graceful shutdown and queued saves', { shutdownDelayMs: 750 });
