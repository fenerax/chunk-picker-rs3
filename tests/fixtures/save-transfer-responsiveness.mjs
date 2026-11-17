import { exerciseTransfer } from '../helpers/save-transfer-responsiveness.mjs';
const cleanup = [];
try {
  await exerciseTransfer({ after: action => cleanup.push(action), diagnostic: value => console.log(value) }, process.argv[2] === 'true');
} finally {
  for (const action of cleanup.reverse()) await action();
}
