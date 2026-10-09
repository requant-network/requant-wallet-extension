import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const main = await readFile(
  new URL("../dist/provider.js", import.meta.url),
  "utf8",
);
const bridge = await readFile(
  new URL("../dist/bridge.js", import.meta.url),
  "utf8",
);
test("bundled page provider and isolated bridge round-trip approval and preserve rejection codes", async () => {
  const listeners = [],
    location = { origin: "https://example.test" };
  let polls = 0;
  const window = {
    addEventListener: (event, fn) => {
      if (event === "message") listeners.push(fn);
    },
    dispatchEvent: () => {},
    postMessage(data, origin) {
      assert.equal(origin, location.origin);
      queueMicrotask(() =>
        listeners.forEach((fn) => fn({ source: window, origin, data })),
      );
    },
  };
  const chrome = {
    runtime: {
      sendMessage: async (m) => {
        if (m.action === "poll") {
          polls++;
          return {
            ok: true,
            result: { done: true, result: ["trq1-public-test-address"] },
          };
        }
        if (m.method === "requant_requestAccounts")
          return { ok: true, result: { done: false, id: "approval-1" } };
        return {
          ok: false,
          error: { code: 4200, message: "Unsupported method" },
        };
      },
    },
  };
  const context = vm.createContext({
    window,
    location,
    crypto,
    chrome,
    Event,
    setTimeout,
    clearTimeout,
    Date,
    Map,
    Set,
    Error,
    Promise,
  });
  vm.runInContext(main, context);
  vm.runInContext(bridge, context);
  const accounts = await window.requant.request({
    method: "requant_requestAccounts",
  });
  assert.equal(accounts[0], "trq1-public-test-address");
  assert.equal(polls, 1);
  await assert.rejects(
    window.requant.request({ method: "eth_sendTransaction" }),
    (e) => e.code === 4200,
  );
  assert.equal(window.ethereum, undefined);
  assert.equal(window.requant.isRequant, true);
  const old = window.requant;
  vm.runInContext(main, context);
  assert.equal(window.requant, old);
});
