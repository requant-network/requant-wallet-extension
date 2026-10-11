# Requant Wallet Extension

A private Requant testnet wallet for **Chrome, Edge and Brave**, with an English
interface in the Requant light identity. This is an early testnet release.
Test RQT has no monetary value. This extension has not had an independent security audit.

## Install

1. Download `Requant-Wallet-Extension_0.2.1_chromium-testnet.zip` from this repository's Releases or [requant.network](https://requant.network/docs/wallet#download-wallet).
2. Extract the ZIP to a permanent folder. Do not move or delete the folder while using the extension.
3. Open `chrome://extensions` (Chrome), `edge://extensions` (Edge), or `brave://extensions` (Brave).
4. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Pin **Requant Wallet — Testnet** in the browser toolbar.
6. Create a wallet and save its encrypted backup, or restore a backup from the Requant app.

No Chrome Web Store submission has been made. Firefox, Safari and mobile browsers
are outside this first version. The ZIP is the same on Windows, macOS and Linux.

To update an existing unpacked installation, extract the new ZIP into the same
permanent folder, replacing its files, then click **Reload** on its card on the
browser's Extensions page. Keep the existing installation and extension ID;
removing it would remove its local wallet storage.

Unlocking a wallet decrypts it locally; **Connected** means the extension has also
received verified data from the testnet node. Version 0.2.1 retries failed node
requests after five seconds and refreshes successful snapshots every thirty
seconds while the unlocked popup or wallet tab is open. Clicking the connection
status still refreshes immediately. These checks do not extend the idle lock.

## What works

- Local key generation and Argon2id/XChaCha20-Poly1305 encryption.
- Restore encrypted Requant `.key` backups from the desktop/mobile app; export compatible backups.
- Multiple wallets, password unlock, five-minute idle lock, password changes.
- Live verified testnet status, exact RQT balances, history, receiving address and QR.
- Confirmed-UTXO transfers with a full recipient/fee/total review and password confirmation.
- Rechecks of unspent outputs and their source transaction hashes, values and owners before local Ed25519 signing.
- A persistent broadcast record written before network submission; explicit pending/rejected/unknown results.
- Per-site browser permissions, explicit connection approvals, transaction approvals and disconnection.
- A Requant-specific `window.requant` provider. This wallet does not implement Ethereum RPC.

Passwords and decrypted private keys are never persisted or sent to the network.
Only the encrypted key, public wallet metadata, connected origins and signed broadcast
records are in `chrome.storage.local`. It is restricted to trusted extension contexts.
Unlock authorization and approval queues use trusted-only `chrome.storage.session`;
browser restart locks the wallets. Signing decrypts a key locally inside Rust/WASM
and requires the password again. JavaScript receives encrypted backups and signed
transactions, never the raw secret key. WASM memory is zeroed for temporary secret
buffers, but browser memory and password input buffers are not an audited secure enclave.

The only node endpoint is `https://requant.network/wallet-api/v1/rpc`. The client
checks the pinned testnet genesis. Monetary RPC numbers are decoded inside Rust
and returned as strings, avoiding JavaScript Number precision loss. Node-supplied
balances and confirmations still rely on the configured node; this is not an SPV client.

New wallets must save a backup before sending. A password change requires a fresh
backup; existing backup files keep their old passwords. Removing the extension or
clearing browser data loses local wallets, so preserve your backup and password.
Creation, restore and backup screens open in a full extension tab so a browser file
dialog cannot close the popup and interrupt recovery or backup confirmation.

## Connect a website

Open the HTTPS site in a browser tab, open the wallet, and choose **Connect** →
**Connect this website**. Approve access for that one site. Reload the page if needed.
The selected public address is shared with the site; every transfer requires a new
review and password. Revoke connections in **Settings → Connected websites**.

See [provider API](docs/PROVIDER.md) and [security model](docs/SECURITY.md).
Release verification and remaining browser checks are recorded in [validation](docs/VALIDATION.md).

## Development

Requirements: Node 24, Rust 1.99.0 with `wasm32-unknown-unknown`, and the
`wasm-bindgen-cli` version pinned in `crates/extension-core/Cargo.toml` (0.2.129).

```sh
npm ci
cargo install wasm-bindgen-cli --version 0.2.129 --locked
cargo test --locked -p requant-extension-core
npm run build
npm test
npm run package
```

`dist/` is the unpacked production extension. `artifacts/` contains the install ZIP
and checksums. GitHub Actions builds and tests the same bundle. Core tests generate
an explicitly public, unfunded test fixture under ignored `target/`; integration
tests mock the node and never submit a real transaction.

For visual development: `npm run dev`, then open
`http://127.0.0.1:3322/popup.html?preview`. This is labeled **DESIGN PREVIEW**,
uses an unfunded fixture, and cannot create keys, export backups or send transactions.
The preview is excluded from the production extension by the build.

Pinned source provenance is in [vendor/PROVENANCE.md](vendor/PROVENANCE.md).

## Full wallet workspace / 0.4.0

Open full wallet from the popup to use the shared Signal interface: 24-word creation/restoration, encrypted/watch-only files, legacy key import, multiple receive/change addresses and count/deposit exports, coins/history/transaction detail, multiple recipients, max/consolidation and offline prepare/sign/broadcast. The full wallet and popup share trusted Chrome storage; existing legacy keys are preserved. Website accounts remain bound to their wallet and original tab/document. HD website payments estimate a fee and enforce the website's requested `fee` as a maximum; the actual fee is reviewed before signing. Watch-only wallets cannot unlock website signing. Desktop/mobile update behavior is documented in the wallet repository; ZIP extensions require manual replacement and Reload.

## Protocol tools / 0.5.0

The full workspace includes verified testnet BTC/Lightning/TRON-USDT swaps, one-way payment channels and signed package relay. It shares portable core 0.10.0 and Signal / IBM Plex Sans with web, desktop and Android. Open the full wallet from the popup to use these flows. Every site connection and provider payment still requires its own origin-bound approval; websites cannot access protocol storage or swap secrets.
