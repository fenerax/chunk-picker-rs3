// Commits reach the public repository only with GitHub noreply addresses, so
// no author or committer exposes a personal email. GitHub's own web merges
// commit as noreply@github.com.
import { execFileSync } from 'node:child_process';

export const noreplyAddress = email => /^(?:\d+\+)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?@users\.noreply\.github\.com$/i.test(email) || email === 'noreply@github.com';

/** Commits whose author or committer email is not a noreply address. Never returns the address. */
export function attributionRefusals(repo, commits) {
  const refused = [];
  for (const commit of commits) {
    const [author, committer] = execFileSync('git', ['--no-optional-locks', '-C', repo, 'show', '-s', '--format=%ae%n%ce', commit], { encoding: 'utf8', windowsHide: true }).trim().split('\n');
    const row = { commit, author: noreplyAddress(author ?? ''), committer: noreplyAddress(committer ?? '') };
    if (!row.author || !row.committer) refused.push(row);
  }
  return refused;
}
