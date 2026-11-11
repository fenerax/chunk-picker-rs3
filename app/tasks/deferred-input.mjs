// The provider holds the resident store, not a captured save or encoded payload.
// Resolve only after admission wins a calculator. Saves fence obsolete readers.
export function deferredTaskInput(store, inputKey, readSnapshot = () => store.getCalculationSnapshot()) {
  return { inputKey, taskInputKey: inputKey, load(revision) {
    if (store.getInfo().revision !== revision) throw Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 });
    const captured = readSnapshot();
    if (captured.revision !== revision || captured.taskInputKey !== inputKey) throw Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 });
    const owned = captured.owned;
    return { state: { revision, members: captured.members }, stateInput: {
      inputKey, taskInputKey: inputKey, ...(owned ? { owned } : { stateJSON: captured.stateJSON }),
    } };
  } };
}
