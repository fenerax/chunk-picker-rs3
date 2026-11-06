// Existing non-default policies, migrated mechanically from main at 5136652.
// Full/shared/inherited-dataset is the filename convention. Do not register new
// tests here: use an optional first-line @test tag in the test itself.
// Grouping identical exceptions avoids hundreds of mechanical test-file edits.
export const existingTestExceptions = [
  ['quick', `
    accessibility-focus account-panel account-reclaim accounts-storage action-acknowledgements action-receipts
    activity-filters activity-readiness admin-menu advanced-preference ancient-effigies area-check-controller
    area-check-selection area-check-target-rules area-check-tasks area-check art-fallbacks
    automatic-rule-defaults backlog-reason backlog-search backlog-tools backup-transfer banking-display
    banking-interiors banking-plan banking-preferences banking-rates banking-travel bis-compare bis-controls
    boss-gates-view browser-module-graph browser-screen-harness-contract calculation-feedback cdp-scratch-port
    checked-batches chunk-colour-picker chunk-colours-drawing chunk-colours-state chunk-long-press chunk-notes
    chunk-tabs ci-cache-inputs-pack ci-coverage-gate ci-coverage-inputs ci-coverage-reporter ci-file-ledger
    ci-gallery ci-release-rehearsal ci-test-telemetry-failures collection-boundaries combat-level command-state
    companion-check completed-model completed-range-preference completed-range completion-truth-table
    copy-list-control copy-list-model copy-lists-view core-overlay-guard custom-tasks-state cutover-live
    dataset-bootstrap dataset-features dataset-json-check dataset-packs dataset-parity-clock dataset-profile
    death-settings definition-overlays definition-pipeline design-tokens divination-training docs-menu-paths
    duo-backlog duo-task-lists feedback-storage feedback-web finish-line-model finish-line-state
    finish-line-view fishing-display fishing-planner gallery game-coords game-defaults game-plugin-achievements
    game-plugin-coords game-plugin-items game-plugin-state game-plugin-status game-plugin-tasks game-plugin-web
    game-profile gameplay-fingerprint gathering-processing group-goals-view group-goals helper-custom-tasks
    helper-model helper-training history-dialog history-pagination-storage history-reader history-text
    http-response idle-memory instant-screens journal-state json-duplicates json-stream light-facts
    linux-lock-publication linux-lock-recovery linux-multi-picker linux-operator-maintenance linux-operator
    linux-recovery-paths linux-service-crash live-base-compatibility live-base-drift live-payload-rules
    live-swap-client live-swap-storage live-timings-server live-timings manual-checks map-activity-layer-model
    map-activity-layer-renderer map-activity-layers map-availability map-capture map-control-discovery
    map-display-panel map-display-sizes map-pin-filters map-place-labels map-search-layer
    map-task-count-obstacles map-task-count-renderer map-task-counts map-task-locations map-tools
    members-start-bank-names members-start-command members-start-pools members-start-web
    migration-equivalent-rows mining-preferences multisticker-picker obligation-cache obtained-equipment
    online-snapshot open-f2p-equipment open-f2p-fetch open-f2p-wiki-fixes open-f2p open-starter operator-cutover
    overlay-client overlay-model overlay-panel owned-child-processes pack-public-scrub pack-publish
    partner-supply-engine partner-supply-model partner-supply-view perf-private-guards phone-layout
    picker-browser-session picker-footprint place-label-data placeholder-art planning platform-api
    plugin-achievements plugin-reads pool-ranking-client postmerge-retry-policy prepared-collection
    private-addon-build private-addon private-drift private-frontdoor-equivalence private-frontdoor-http
    private-frontdoor-lanes private-live-swap process-profiles process-worker-transport profile-model
    profile-stack-writer profile-view progress-sources public-request public-shadow q2-ci q2-diff-engine
    quest-map-controls quest-map-model quest-requirements-corrections quick-release receipt-quarantine
    registry-lock registry release-run-ci-powershell release-run-ci release-vps-additions request-failures
    retained-item-icons retry-policy review-task-icons reviewed-service-variants reviewed-supplies
    roll-boundaries roll-stats-dialog roll-stats-storage roll-stats rs-wiki-client rule-explanations
    rule-parent-inheritance rule-reviews-server rules-panel rules-review-preview rules-review runemetrics-state
    sandbox-client sandbox save-address save-copy save-transfer-server save-transfer screens-model
    screenshot-mode search-place-ranking search secret-scan-pack-patterns secret-scan-pack-reviewed secret-scan
    security-json server-memory-sharing server-scale-fixture session-residency settings-panel settings
    setup-guide signin-provider slayer-assignments startup-retry startup-warmup state sticker-flyout
    storage-durability storage-publication stream-safe task-blocker-guidance task-filters-view task-filters
    task-hover task-how-server task-how-ui task-how task-icon-painter task-provenance task-rule-explanations
    task-why-chain task-why teleport-returns terrain-viewport test-run-policy test-selection-contract
    test-selection tick-active-tasks-server tick-active-tasks-view tick-active-tasks time-estimates
    timegated-port-skills tooling-certificate tooling-contracts tooling-smoke top-bar-buttons training-data
    travel-reward-gates undo-safety unknown-drop-warnings usage-client usage-storage warm-candidate warm-store
    warmstart-scheduler watchdog-core woodcutting-preferences xp-choices-model xp-choices-state xp-choices-web
    y03-fuzz-ci
  `],
  ['solo', `
    activity area-check-server.private art-pack-server automatic-travel-integration backup-import-server
    cache-comparison cache-island-policy cache-resources-catalogue cache-resources-expanded-application
    cache-resources-retained-access command-performance dataset-startup death-worker divination-integration
    engine.private equipment-corrections equipment-permanence-worker gallery-server helper-server
    house-storage-server identity-records identity-startup identity idle-memory-server.private
    interiors-v2-catalogue interiors-v2-server journal-server.private map-info-server npcs-and-shops-application
    obtained-equipment-server original-data-update original-sync-server parity-progress-aliases
    prediction-output.private prediction-server.private preview-archaeology preview-equipment-corrections
    preview-resource-contents retained-unsupported-corrections runemetrics-server save-transfer-publication
    save-transfer-response-bounds save-transfer-responsiveness save-transfer-wide-hook scheduling-server.private
    server-reliability.private server skill-guides-runtime tasks terrain-assets-server training-server.private
    transport-access worker-timings.private
  `],
  ['dataset=open-f2p', `
    area-check-server area-check-worker backup-watchdog-server calculator-bundle-worker chunk-colours-server
    duo-focus-browser duo-server game-plugin-shutdown group-goals-server history-pagination-server
    idle-memory-server invites-server journal-server map-activity-layer-server migration-scale migration
    overlay-routes perf-stack-server play-server plugin-reads-server pool-ranking-server prediction-output
    prediction-server preview-metadata-corrections process-worker progress-providers public-ingress-server
    restore-picker.private roll-pool-worker roll-stats-server sandbox-server scheduling-server
    server-reliability short-height-browser signin-server skill-guides-preview storage-reliability
    task-claim-server task-ui-server unlock-reuse usage-server viewer-permissions warm-restart-server
    warmstart-server web-browser worker-timings xp-choices-server
  `],
  ['quick dataset=open-f2p', `
    calculator-bundle completion-codec eligibility-reuse engine-cache-eligibility engine-cache-multi-picker
    engine-cache-snapshot engine-cache-worker final-projection-ab final-projection frontdoor-ingress
    game-plugin-mapping incremental-engine-profile live-swap-server multi-picker-capacity original-paste-server
    original-paste phase1-acceptance-crash phase1-acceptance picker-admission picker-audit-a picker-audit-b
    picker-audit-c1 picker-audit-c2 picker-calculator-cap picker-context picker-deletion-crash picker-deletion
    picker-fairness-isolation picker-jobs picker-limits-http picker-limits picker-owner-ui picker-routing-crash
    picker-routing profile-spans projection-measurements source-access-shadow worker-picker-keys
  `],
  ['solo dataset=open-f2p', `
    original-paste-responsiveness
  `],
  ['engine-differential', `
    q2-diff-engine-integration
  `],
  ['differential', `
    y03-fuzz-ci-integration
  `],
];
