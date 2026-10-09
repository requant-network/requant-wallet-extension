# Security model and release limits

- Rust/WASM implements the same pinned encrypted key-file, address and transaction
  rules as the Requant app. Only encrypted backups can be imported; no plaintext
  legacy key import is exposed.
- Passwords and decrypted keys are not cached in extension storage. New passwords
  require at least 10 characters. A signing request always requires a password.
- Vault and session storage are restricted with `TRUSTED_CONTEXTS` before messages
  are served. Website messages have a separate, narrow method allowlist; they cannot
  call internal wallet commands or export backups.
- Internal commands accept only the extension's own popup document. The popup is
  not web-accessible. Local scripts and WASM are bundled; remote code is prohibited.
- Optional HTTPS permissions are requested for individual origins through a user
  click. Only the configured node origin has an install-time host permission.
- Requests are bound to browser-supplied top-frame URL, origin, tab and document ID.
  The active top-frame document is checked again before approval and signing.
- RPC bodies are size limited, requests time out, redirects are rejected, and no
  browser cookies are sent to the node. Both network name and pinned genesis are checked.
- Monetary values are parsed as Rust uint64 integers. Duplicate/invalid outputs,
  amounts above the consensus maximum, unconfirmed and immature funds are excluded.
- Transfer reviews are stored privately with exact source outputs and expire. Source
  transactions are decoded and their signatures, hashes, output values and ownership
  checked. Fresh unspent outputs are checked immediately before signing.
- Signed bytes are recorded before broadcasting. Transport ambiguity is shown as
  unknown; there is no automatic retry. Exact bytes can be checked against `gettx`.

No independent audit has been performed. Browser or device compromise, malicious
extensions, keyloggers, corrupted browser storage and a dishonest configured node
remain risks. Storage encryption is only as strong as the password. The wallet
does not independently prove the full chain, balances or confirmations. Node-provided
history and maturity information are trusted after the network/genesis checks.

This release is testnet only. Chromium installation and the browser permission prompts
must be confirmed by the user. Web Store publication and Firefox support require
separate work. Tests use known public keys, test-only passwords and mocked broadcasts.
