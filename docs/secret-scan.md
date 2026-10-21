# Secret scan

`scripts/secret-scan` checks what goes into this repository for credentials and
personal values. It replaces the old public-export candidate builder: there is
one public repository now, so the scan runs on its commits and pushes instead
of on an exported copy. The scan never prints a value it finds, only the
category, path and line. A file name that holds a finding prints as
`[redacted-path]`.

## What blocks

| Category | Examples |
| --- | --- |
| `private-fingerprint` | Any value in the local private-value corpus, in plain, case-folded, decomposed, escaped or file-name form |
| `token` | Invite paths, key fragments in links, token query values, password and secret assignments, GitHub tokens, long random strings |
| `account-map-binding` | RSN, account, member and map id fields with real-looking values; RuneMetrics and hiscore profile links |
| `personal-default` | Personal names and owner labels in defaults |
| `service-binding` | Firebase hosts and keys, and other hosted-service credentials |
| `network-identifier` | Tailnet hosts, LAN and mDNS hosts, Windows computer names, MAC addresses, private and tailnet IP addresses, e-mail addresses, unreviewed URLs |
| `machine-path` | User profile paths other than the generic `C:/Users/User`, home directories, UNC shares |

Test values pass when they say so: a value with a marker word (`fixture`,
`invented`, `example`, `synthetic`, `placeholder` and the like), a template
such as `${token}`, or a placeholder listed in `reviewed.json`.

## Commands

Scan the files at a commit and the changes in a commit range:

```bash
node scripts/secret-scan/scan.mjs --tree HEAD --commits origin/main..HEAD
```

The private-value corpus lives in `.local/export-gate` (`key` and
`corpus.json`); `--corpus-dir` picks another folder. Without a corpus the scan
refuses to run. `--without-corpus` runs the pattern checks alone, which is what
GitHub Actions does, since the corpus never leaves the release PC.

`--commits` also checks each commit's message, and that its author and
committer are GitHub noreply addresses.

Exit codes: 0 clean, 1 findings, 2 the scan could not run.

## The pre-push hook

Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-push` scans every file at each pushed commit plus every commit
the remote lacks, with the corpus, and refuses the push on any finding, any
non-noreply commit, or a missing corpus. `SECRET_SCAN_CORPUS` points it at a
corpus outside `.local/export-gate`.

## Adding private values

```bash
node scripts/secret-scan/corpus-add.mjs --file values.txt
```

Values come one per line from `--file` or standard input. `--save` reads the
member names and ids from a disposable copy of a save instead, plus the literal
ids and labels in `app/legacy-game-defaults.mjs`; it never looks for a save by
itself, so never point it at live storage. After adding, each value must block
in every form, or the command fails. Values are only ever held in memory; the
corpus stores HMAC digests.

## Reviewed exceptions

`scripts/secret-scan/reviewed.json` holds three lists, each row with a reason:

- `hosts`: public sites whose URLs are fine to link, such as the RuneScape Wiki.
- `placeholders`: committed test values that are not personal, such as `qxa`.
- `lines`: one exact line, by path, category and the SHA-256 of its bytes
  (without the line ending). Changing the line drops the exception, so the scan
  sees the new line.

Add a line exception only after checking that the value is public, invented or
not a value at all, and say why in the reason.

## In CI

The `secrets` job in `.github/workflows/test.yml` runs
`--without-corpus --tree <head> --commits <range>` on every push and pull
request. The range is the push's or pull request's new commits; for a new
branch it is what the default branch lacks.

## What is left of the old exporter

`scripts/public-export` keeps only what the release pipeline on the release PC
still loads: `scan.mjs`, `fingerprints.mjs` and `common.mjs`, the reviewed
exception and provenance files, and `allowlist.json` with its `templates`, which
`scripts/build-private-companion.mjs` and the private drift check read. The
release kits run their own frozen copy of that scanner. Moving the pipeline onto
`scripts/secret-scan` is a separate change.
