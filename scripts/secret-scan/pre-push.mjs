// Git pre-push hook (.githooks/pre-push): scans what a push would send, with
// the private-value corpus, and refuses the push on any finding or on a
// commit whose author or committer is not a GitHub noreply address.
// Enable once per clone: git config core.hooksPath .githooks
// The corpus is .local/export-gate, or the folder SECRET_SCAN_CORPUS names.
import { readFileSync } from 'node:fs';
import { commitEntries, scanEntries, treeEntries } from './scan.mjs';
import { defaultCorpusDir, loadCorpus } from './fingerprints.mjs';
import { attributionRefusals } from './noreply.mjs';

const zero = /^0+$/;
const [remote = 'origin'] = process.argv.slice(2);
try {
  const corpus = await loadCorpus(process.env.SECRET_SCAN_CORPUS || defaultCorpusDir);
  const repo = process.cwd();
  let refused = 0;
  // Git writes one line per ref: <local ref> <local sha> <remote ref> <remote sha>.
  for (const row of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
    const [localRef, localSha, , remoteSha] = row.trim().split(' ');
    if (zero.test(localSha)) continue; // deleting a remote ref sends nothing
    // A new remote ref sends every commit the remote does not have yet.
    const range = zero.test(remoteSha) ? [localSha, '--not', `--remotes=${remote}`] : [`${remoteSha}..${localSha}`];
    const { commits, entries } = commitEntries(repo, range);
    const result = scanEntries([...treeEntries(repo, localSha), ...entries], { corpus });
    const attribution = attributionRefusals(repo, commits);
    for (const { category, path, line } of result.findings) console.error(`${category} ${path}:${line}`);
    for (const { commit, author, committer } of attribution)
      console.error(`attribution ${commit.slice(0, 12)}: ${[author ? '' : 'author', committer ? '' : 'committer'].filter(Boolean).join(' and ')} not a GitHub noreply address`);
    console.error(`${localRef}: ${commits.length} new commits, ${result.status}`);
    refused += result.findings.length + attribution.length;
  }
  if (refused) console.error('Push refused by the secret scan.');
  process.exitCode = refused ? 1 : 0;
} catch (error) {
  console.error(`Push refused: blocked, not clean (${error.category ?? 'scan-failed'})`);
  process.exitCode = 1;
}
