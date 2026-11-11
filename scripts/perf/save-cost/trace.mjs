// Diagnostic loader only. Fail closed when an application anchor changes.
import { registerHooks } from 'node:module';
globalThis.__saveCostPhase = phase => globalThis.__saveCostObserver?.phase(phase);
globalThis.__saveCostScope = (phase, work) => {
  const observer = globalThis.__saveCostObserver;
  if (!observer) return work();
  const previous = observer.current;
  observer.phase(previous === 'load' ? 'load' : phase);
  try { return work(); } finally { observer.phase(previous); }
};
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/app/core/state.mjs') && !url.endsWith('/app/storage/store.mjs')) return result;
  let source = String(result.source).replaceAll('\r\n', '\n');
  const patch = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw Error('Missing/ambiguous save-cost anchor: ' + anchor);
    source = source.replace(anchor, replacement);
  };
  if (url.endsWith('/state.mjs')) {
    for (const name of ['validateState', 'validateOwnedState', 'validateResidentState', 'validateCommandGameplay']) {
      const declaration = `function ${name}(`;
      patch(declaration, `function ${name}(...args) { return globalThis.__saveCostScope('validate', () => ${name}Untraced(...args)); }\nfunction ${name}Untraced(`);
    }
  } else {
    for (const [anchor, phase] of [
      ['const next = applyStoredCommand(input.state, command,', 'apply'],
      ['inheritStateMetadata(input.state, next);', 'validate'],
      ["return persist(ready, 'command', input.archived,", 'publish'],
      ['const diskDocument = await serializedDiskState(validated,', 'encode'],
      ['const publication = await publishItemState(validated,', 'publish'],
      ['if (skipSnapshot) return;', 'reply'],
    ]) patch(anchor, `globalThis.__saveCostPhase('${phase}'); ` + anchor);
  }
  return { ...result, source };
} });
