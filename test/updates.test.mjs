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
const row = {
  version: "0.3.1",
  url: "https://requant.network/downloads/wallet/v0.3.1-testnet/Requant-Wallet-Extension_0.3.1_chromium-testnet.zip",
  sha256: "ab".repeat(32),
  bytes: 100,
};
test("checks public feed without credentials, rejects foreign packages and compares versions numerically", async () => {
  const f = fixture();
  let invalid = false,
    calls = 0;
  const updates = new ExtensionUpdates(f.browser, async (url, options) => {
    calls++;
    assert.equal(url, "https://requant.network/updates/wallet/extension.json");
    assert.equal(options.credentials, "omit");
    return new Response(
      JSON.stringify({
        ...row,
        url: invalid ? "https://example.test/app.zip" : row.url,
      }),
    );
  });
  assert.equal((await updates.check()).available, true);
  await updates.check();
  assert.equal(calls, 1);
  invalid = true;
  const status = await updates.check(true);
  assert.match(status.error, /unavailable/);
  assert.equal(status.url, row.url);
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("0.2.9", "0.3.0"), false);
  assert.equal(newer("<script>", "0.3.0"), false);
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
