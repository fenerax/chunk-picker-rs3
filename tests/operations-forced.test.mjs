import { pickerOperationTest } from './helpers/picker-operations.mjs';

pickerOperationTest('forced', 'bounds shutdown of an uncooperative owned process and reports forced stop', { ignoreShutdown: true });
