import { pickerOperationTest } from './helpers/picker-operations.mjs';

pickerOperationTest('slow', 'records slow startup immediately, refuses competitors, recovers missing ownership, and stops starting children', { waitForReadySignal: true });
