# Requant Wallet Extension

- Public UI and documentation are English. Keep credentials and private user data outside the repository.
- Use the approved Requant ivory, graphite and orange identity and the authoritative SVG mark.
- This is the Requant testnet, not an Ethereum wallet. Expose `window.requant`, never `window.ethereum`.
- Sign locally using the pinned consensus rules. Never transmit a password, key or encrypted backup.
- Support the pinned upstream wallet 0.10.0 encrypted HD/24-word recovery format, watch-only files and legacy encrypted key files. Preserve existing encrypted backups.
- Keep secrets, browser profiles, test backups and release artifacts outside Git.
- Amounts are exact uint64 atoms with eight RQT decimals. Never parse RPC monetary values through JavaScript Number.
- Validate genesis, recipient, selected fresh UTXOs and complete source transaction bytes before signing.
- Every website connection and transaction requires an explicit user approval. Bind requests to their browser-supplied top-frame origin and document.
- Use CodeGraph for structural exploration. Tests use public unfunded fixtures and mocked broadcasts, never real user wallets.
- Do not claim an audit, mainnet support, commercial signing or Web Store publication without evidence.
