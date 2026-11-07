Frozen, unmodified bridge-core files from 8ae68b1. PROVENANCE.json records their SHA-256 hashes. The modules have no runtime imports beyond Node built-ins unless a default game label is requested; these tests always supply a synthetic label. They write only inside the fixture directory supplied by the test.

The fixture helper replaces the promise timer with a scoped controlled clock while these modules run. The Windows rename backoff is tested with a synthetic busy rename and records its requested delay without sleeping. Both the timer binding and simulated platform are restored after the case; the archived source and provenance hashes stay unchanged.

helpers.mjs runs the real requestContext, checkRequestOrigin and invite-store authentication functions. Its small status probe applies authentication, viewer-write rejection and Origin checks in the order used by POST routes. The full router comparison is core-integration.mjs, run separately against a disposable patched core export by Verify-Frontdoor.mjs --source ... --core .... It never imports the installed picker.

All addresses, credentials, sessions and public hostnames in these fixtures are synthetic. Default tests use os.tmpdir()/rs3-live-swap-tests unless RS3_LIVE_SWAP_TEST_ROOT selects an isolated directory.
