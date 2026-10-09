# Version 0.1.0 testnet validation

Automated checks:

- 4 native Rust tests: encrypted backup compatibility and password changes,
  exact uint64 monetary values, genesis rejection, input ownership/value/spent
  validation and signatures bound to the testnet chain domain. One test generates
  the public unfunded fixture used by the integration tests.
- 12 JavaScript/WASM tests: actual compiled WASM, bundled service-worker routing,
  trusted-only storage, forged internal commands, per-origin/document approvals,
  navigation invalidation, lock interruption before signing, immutable website
  requests, stale reviews and spent inputs, backup/onboarding tab persistence,
  exact acceptance/rejection/unknown broadcast outcomes, and bundled provider/bridge
  request/response behavior and the pinned public gateway method contract.
- TypeScript production build, Rust Clippy with warnings denied, and npm dependency audit.
- A read-only check against the live requant.network testnet gateway using the
  public unfunded fixture: network/genesis match, valid status, zero balance and
  empty history. No real transaction was broadcast.
- Visual inspection of the labeled design preview in a Chromium-based browser:
  light identity, fixed-height popup, wallet overview, QR, complete address and
  copying control. Preview fixtures are excluded from the production bundle.

The service-worker and extension API integration tests run with a modeled Chrome
API environment and the actual built scripts. Native installation via Load unpacked,
browser permission dialogs, and end-to-end wallet use in Chrome, Edge and Brave still
need manual checks. No browser-store submission, Firefox build, independent audit,
real user key import or real funded transfer was performed by these tests.

Before public distribution, verify install, create/backup, restore, unlock/idle lock,
QR/copy, connect/disconnect, navigation invalidation and test-only transfer review
in each supported browser. Test broadcasting only with disposable testnet wallets.
