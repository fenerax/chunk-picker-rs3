# Exact #128 tools package

`package.tar.gz` contains the unmodified 49-file tools package built by
`scripts/linux/tools-package.mjs` at public commit
`1cfd56046d1829e056a37d94abd0e102f585bdb4`. It has no contract version field.

- Tools identity: `79eb28369aa720d256d64ba088de6600cbc13522d81660bdaf9264c9632bc94c`
- Archive SHA-256: `c0907c9ef7b14e29a94400afdb88edceb3e75131af242568f43418f2a417bbb9`
- Original 49-file source-subset tar SHA-256:
  `5b14338aee88173fa91bf333353fad2ed9af2e13453995e717c782dc9009cfb5`

The source subset is the earlier package closure from that commit. Build it
with its own builder, then archive the output with GNU tar (`--sort=name
--mtime=@0 --owner=0 --group=0 --numeric-owner`) and `gzip -n`. Package source
bytes, file modes and manifest are unchanged. All contents are public source;
there are no saves, credentials or host configuration files.

The compressed fixture keeps the regression self-contained in shallow CI
checkouts. The integration test checks both archive digest and package identity
before using it. Do not regenerate it from current source: that would lose the
cross-version regression.
