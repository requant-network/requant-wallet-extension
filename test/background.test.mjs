import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, password, Storage, core, mockNode } from "./helpers.mjs";
const local = new Storage(),
  session = new Storage(),
  node = mockNode(core),
  url = "chrome-extension://test-extension/";
let onMessage;
const registrations = new Map();
let currentDocument = "doc-1";
const currentOrigin = "https://example.test";
globalThis.chrome = {
  runtime: {
    id: "test-extension",
    getURL: (path) => url + path,
    onMessage: {
      addListener: (fn) => {
        onMessage = fn;
      },
    },
  },
  storage: { local, session },
  alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
  windows: {
    create: async () => ({ id: 1 }),
    onRemoved: { addListener: () => {} },
  },
  tabs: { get: async () => ({ url: currentOrigin + "/app" }) },
  permissions: { contains: async () => true, remove: async () => true },
  scripting: {
    executeScript: async () => [
      { result: currentOrigin, documentId: currentDocument },
    ],
    getRegisteredContentScripts: async () => [...registrations.values()],
    unregisterContentScripts: async ({ ids }) =>
      ids.forEach((id) => registrations.delete(id)),
    registerContentScripts: async (scripts) =>
      scripts.forEach((x) => registrations.set(x.id, x)),
  },
};
globalThis.fetch = async (target, options) => {
  if (target === url + "requant_extension_core_bg.wasm")
    return new Response(
      await readFile(
        new URL("../dist/requant_extension_core_bg.wasm", import.meta.url),
      ),
      { headers: { "Content-Type": "application/wasm" } },
    );
  assert.equal(target, "https://requant.network/wallet-api/v1/rpc");
  assert.equal(options.credentials, "omit");
  const { method, params } = JSON.parse(options.body);
  const r = await node.rpc(method, params);
  return new Response(r.raw);
};
await import("../dist/background.js");
const ui = { id: "test-extension", url: url + "popup.html" };
const site = {
  id: "test-extension",
  url: currentOrigin + "/app",
  origin: currentOrigin,
  tab: { id: 4 },
  frameId: 0,
  documentId: "doc-1",
};
function message(action, args = {}, sender = ui, channel = "requant-ui") {
  return new Promise((resolve) => {
    assert.equal(onMessage({ channel, action, args }, sender, resolve), true);
  });
}
function provider(payload, sender = site) {
  return new Promise((resolve) =>
    onMessage({ channel: "requant-provider", ...payload }, sender, resolve),
  );
}
test("bundled MV3 worker protects storage, handles wallet UI and rejects forged internal commands", async () => {
  assert.equal(
    (
      await message("add", {
        name: "Browser fixture",
        encrypted: fixture.encrypted,
        password,
      })
    ).ok,
    true,
  );
  assert.equal(local.access, "TRUSTED_CONTEXTS");
  assert.equal(session.access, "TRUSTED_CONTEXTS");
  const state = await message("state");
  assert.equal(state.result.wallets[0].address, fixture.metadata.address);
  const forbidden = await message("backup", { password }, site);
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.error.message, /Unauthorized/);
  assert.equal(
    (await message("snapshot")).result.spendable,
    "90071992.54740993",
  );
  await message("enableSite", { origin: currentOrigin, tabId: 4 });
  assert.equal(registrations.size, 2);
  assert.equal(
    (await provider({ action: "request", method: "requant_accounts" })).result
      .result[0],
    fixture.metadata.address,
  );
  const pending = await provider({
    action: "request",
    method: "requant_sendTransaction",
    params: { recipient: fixture.recipient, amount: "1" },
  });
  assert.equal(pending.ok, true);
  currentDocument = "different-document";
  const stale = await message("plan", { requestId: pending.result.id });
  assert.equal(stale.ok, false);
  assert.match(stale.error.message, /page changed/);
  await message("revoke", { origin: currentOrigin });
  assert.equal(registrations.size, 0);
  assert.deepEqual(
    (await provider({ action: "request", method: "requant_accounts" })).result
      .result,
    [],
  );
});
