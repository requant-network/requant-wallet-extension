# Pinned source

`consensus/` and `tnet/` are unmodified Apache-2.0 sources from
https://github.com/danifest751/requant at `aad4772`.

`crates/extension-core/src/crypto.rs` and `transfer.rs` are copied unchanged from
https://github.com/Xaint00ship/requant-wallet at
`1ba9aebe1b41a52188d4865b5c99eaa18d6b4b6d`.
The extension uses the same Argon2id/XChaCha20-Poly1305 encrypted key-file format,
Ed25519 signatures, testnet addresses, chain domain and transaction serialization.

See `LICENSE` for the consensus source license. New application source is private.
