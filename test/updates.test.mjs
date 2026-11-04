import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionUpdates, newer } from "../src/updates.mjs";
function fixture(installType = "development") {
  const data = {};
  let reloads = 0;
  const browser = {
    management: { getSelf: async () => ({ installType }) },
    runtime: {
      getManifest: () => ({ version: "0.3.0" }),
      reload: () => {
        reloads++;
      },
      getContexts: async () => [],
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: data[key] }),
        set: async (values) => Object.assign(data, values),
      },
    },
  };
  return { browser, data, reloads: () => reloads };
}
const bytes = new TextEncoder().encode("reviewed extension ZIP fixture");
const digest = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (b) => b.toString(16).padStart(2, "0"),
).join("");
function signed(version = "0.3.1") {
  return {
    manifest: JSON.stringify({
      schema: 1,
      purpose: "requant-release-v1",
      product: "extension",
      network: "test",
      version,
      min_client: "0.3.0",
      source_commit: "ab".repeat(20),
      files: [
        {
          path: `Requant-Wallet-Extension_${version}_chromium-testnet.zip`,
          sha256: digest,
          bytes: bytes.length,
        },
      ],
    }),
    signature: "trusted fixture",
  };
}
// Cryptographic signature tests live in browser-core; this checks the installed verifier boundary.
async function verify(input) {
  assert.equal(input.signature, "trusted fixture");
  const m = JSON.parse(input.manifest);
  if (newer(input.floor, m.version)) throw new Error("rollback");
  return m;
}
test("public feed requires installed signature verification and rejects rollback", async () => {
  const f = fixture();
  let payload = signed(),
    calls = 0;
  const updates = new ExtensionUpdates(
    f.browser,
    async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://requant.network/updates/wallet/extension.json",
      );
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(payload));
    },
    verify,
  );
  assert.equal((await updates.check()).available, true);
  await updates.check();
  assert.equal(calls, 1);
  payload = { ...signed("0.3.2"), signature: "forged" };
  assert.match((await updates.check(true)).error, /unavailable/);
  assert.equal((await updates.status()).version, "0.3.1");
  payload = signed("0.3.0");
  await updates.check(true);
  assert.equal((await updates.status()).version, "0.3.1");
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("<script>", "0.3.0"), false);
});
test("unsigned server metadata and cached offers are never trusted", async () => {
  const f = fixture();
  f.data.requantUpdates = {
    version: "99.0.0",
    url: "https://evil.test/a.zip",
    checkedAt: 1,
  };
  const updates = new ExtensionUpdates(
    f.browser,
    async () => new Response(JSON.stringify({ version: "99.0.0" })),
  );
  assert.equal((await updates.status()).available, false);
  assert.equal((await updates.check(true)).available, false);
});
test("download serves only ZIP bytes matching the signed hash and size", async () => {
  const f = fixture();
  f.data.requantUpdates = { signed: signed() };
  let damaged = false;
  const updates = new ExtensionUpdates(
    f.browser,
    async (url, options) => {
      assert.match(url, /Requant-Wallet-Extension_0.3.1_chromium-testnet.zip$/);
      assert.equal(options.redirect, "error");
      return new Response(damaged ? new Uint8Array(bytes.length) : bytes);
    },
    verify,
  );
  assert.equal(
    (await updates.download()).base64,
    btoa(String.fromCharCode(...bytes)),
  );
  damaged = true;
  await assert.rejects(() => updates.download(), /hash verification/);
});
test("browser updates never reload unpacked wallets, active signing sessions or pending website approvals", async () => {
  for (const installType of ["development", "normal"]) {
    const f = fixture(installType);
    const updates = new ExtensionUpdates(f.browser);
    await updates.browserAvailable({ version: "0.3.1" });
    let locked = 0;
    const state = { unlocked: true, requests: [] };
    const engine = {
      state: async () => state,
      interruptLock() {},
      lock: async () => {
        locked++;
      },
    };
    assert.equal(await updates.apply(engine), false);
    state.unlocked = false;
    state.requests = [{}];
    assert.equal(await updates.apply(engine), false);
    state.requests = [];
    assert.equal(await updates.apply(engine), installType === "normal");
    assert.equal(f.reloads(), installType === "normal" ? 1 : 0);
    assert.equal(locked, installType === "normal" ? 1 : 0);
  }
});
test("explicit installation waits for other wallet pages to close", async () => {
  const f = fixture("normal"),
    updates = new ExtensionUpdates(f.browser);
  await updates.browserAvailable({ version: "0.3.1" });
  let locked = 0;
  const engine = {
    state: async () => ({ unlocked: true, requests: [] }),
    interruptLock() {},
    lock: async () => {
      locked++;
    },
  };
  f.browser.runtime.getContexts = async () => [{}, {}];
  assert.equal(await updates.apply(engine, true), false);
  assert.equal(locked, 0);
  f.browser.runtime.getContexts = async () => [{}];
  assert.equal(await updates.apply(engine, true), true);
  assert.equal(locked, 1);
});
