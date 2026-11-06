import { readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkTestPorts } from './test-port-check.mjs';
import { createTestSelection, isTestEntryFile, reviewedFixedPortTests } from './test-classification.mjs';
export { createTestSelection, isTestEntryFile, reviewedFixedPortTests } from './test-classification.mjs';

const testDirectory = new URL('../tests/', import.meta.url);
const fileAt = (directory, name) => directory instanceof URL ? new URL(name, directory) : path.join(directory, name);
// Synchronous exports retain the runner API; they are derived from this tree's
// files, including optional header tags, rather than a registration inventory.
const current = createTestSelection(new Map(readdirSync(testDirectory).filter(isTestEntryFile)
  .map(name => [name, readFileSync(new URL(name, testDirectory), 'utf8')])));
export const { classifyTest, selectTests, testRunPolicy, quickTests, soloTests, openF2PTests,
  differentialTests, engineDifferentialTests } = current;

export async function discoverTestEntries(directory = testDirectory) {
  return (await readdir(directory)).filter(isTestEntryFile);
}

export async function readTestSelection(directory = testDirectory) {
  const names = await discoverTestEntries(directory);
  return createTestSelection(new Map(await Promise.all(names.map(async name => [name, await readFile(fileAt(directory, name), 'utf8')]))));
}

export async function discoverTests(directory = testDirectory, suite = 'quick') {
  const names = await discoverTestEntries(directory);
  const selection = await readTestSelection(directory);
  const selected = selection.selectTests(names, suite);
  // Quick also audits full-only files so a port collision cannot hide there.
  await checkTestPorts(directory, names.filter(name => !reviewedFixedPortTests.has(name)));
  return selected;
}
