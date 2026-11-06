export { classifyTest, selectTests, testRunPolicy, quickTests, soloTests, openF2PTests,
  differentialTests, engineDifferentialTests, createTestSelection, readTestSelection, discoverTests, reviewedFixedPortTests } from './test-discovery.mjs';

export const fullConcurrency = 3;
export const concurrencyFor = (suite, env = process.env) => {
  const value = Number(env.RS3_TEST_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 8 ? value : suite === 'full' ? fullConcurrency : 2;
};
