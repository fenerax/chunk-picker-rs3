#!/bin/sh
set -eu
# Pending: run only in the separately authorized Docker hard-resource envelope.
exec /runtime/node /harness/run-frozen-browser.mjs \
  --source /source --scratch /scratch --deps /deps \
  --source-lock /scratch/source-lock.json \
  --expected-source-pin 6f22fefa782747790e2eaefa01e4e5ea7b557323 \
  --member explorer-1 --group false --chunk 12850 --startup immediate \
  --out /scratch/case-result.json
