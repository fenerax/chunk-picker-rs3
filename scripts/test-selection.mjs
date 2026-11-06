export { classifyTest, selectTests, testRunPolicy, quickTests, soloTests, openF2PTests,
  differentialTests, engineDifferentialTests, createTestSelection, readTestSelection, discoverTests, reviewedFixedPortTests } from './test-discovery.mjs';

// Full runs start at two and may grow to this cap after memory admission.
// Earlier concurrency trials: docs/test-speed.md. The override is a cap.
export const fullConcurrency = 6;
export const concurrencyFor = (suite, env = process.env) => {
  const chosen = Number(env.RS3_TEST_CONCURRENCY);
  return Number.isInteger(chosen) && chosen >= 1 && chosen <= 6 ? chosen : suite === 'full' ? fullConcurrency : ['differential', 'engine-differential'].includes(suite) ? 1 : 2;
};
export const adaptiveOptionsFor = (suite, env = process.env) => {
  const cap = concurrencyFor(suite, env);
  return { minConcurrency: Math.min(2, cap), maxConcurrency: cap };
};
