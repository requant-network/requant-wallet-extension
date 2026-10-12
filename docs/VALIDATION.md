# Testnet validation

## Version 0.2.1 — connection refresh

- 17 JavaScript/WASM tests pass, including regression checks for recovery after
  an initial node failure, deduplicated refreshes, synchronous request failures,
  and cancellation of stale results after locking, wallet changes or popup closure.
- TypeScript checks and the production extension build pass.
- The production WASM and NodeClient were checked against the live HTTPS gateway
  using an empty public owner and the published development-fund and faucet
  addresses. Non-empty history (100 and 3 entries), balances, network and genesis
  were read successfully. No private key was read and no transaction was sent.
- The user's installed extension could not be inspected because browser access to
  its current page was denied by the automation policy. The initial installed
  error and an end-to-end reload still require confirmation in that browser.

The fix addresses a verified UI bug: a failed first snapshot stayed Offline until
a manual refresh or another unlock. It does not establish which initial request
failed in the user's existing installation.

## Version 0.1.0 baseline

Automated checks:

- 4 native Rust tests: encrypted backup compatibility and password changes,
  exact uint64 monetary values, genesis rejection, input ownership/value/spent
  validation and signatures bound to the testnet chain domain. One test generates
  the public unfunded fixture used by the integration tests.
- 13 JavaScript/WASM tests: actual compiled WASM secure key generation, password-change/backup rules, bundled service-worker routing,
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
need manual checks. An internal security review is planned; these tests do not
complete that review. No browser-store submission, Firefox build, real user key
import or real funded transfer was performed by these tests.

Before public distribution, verify install, create/backup, restore, unlock/idle lock,
QR/copy, connect/disconnect, navigation invalidation and test-only transfer review
in each supported browser. Test broadcasting only with disposable testnet wallets.
