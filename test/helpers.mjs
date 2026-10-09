import { readFile } from "node:fs/promises";
import init, { invoke } from "../pkg/requant_extension_core.js";
import { validateRequest } from "./gateway-contract.mjs";
export const fixture = JSON.parse(
  (
    await readFile(
      new URL("../target/test-fixture.json", import.meta.url),
      "utf8",
    )
  ).replace(/"value":(\d+)/g, '"value":"$1"'),
);
await init({
  module_or_path: await readFile(
    new URL("../pkg/requant_extension_core_bg.wasm", import.meta.url),
  ),
});
export const core = (op, args) => {
  try {
    return JSON.parse(invoke(op, JSON.stringify(args)));
  } catch (e) {
    throw new Error(String(e));
  }
};
export const password = "test-only-no-funds-password";
export const reply = (result) => JSON.stringify({ result, error: null });
export const coinsRaw = (overrides = {}) =>
  JSON.stringify({
    result: [{ ...fixture.coin, ...overrides, value: 0 }],
    error: null,
  }).replace('"value":0', `"value":${overrides.value ?? fixture.coin.value}`);
export class Storage {
  data = {};
  async get(key) {
    return structuredClone({ [key]: this.data[key] });
  }
  async set(value) {
    Object.assign(this.data, structuredClone(value));
  }
  async setAccessLevel(value) {
    this.access = value.accessLevel;
  }
}
export function mockNode(core) {
  const node = {
    broadcasts: 0,
    disconnected: false,
    spent: false,
    fail: false,
    submitted: new Map(),
    async rpc(method, params = []) {
      validateRequest({ method, params });
      let raw;
      if (method === "getinfo")
        raw = reply({
          network: "test",
          height: 10,
          tip: "a".repeat(64),
          peers: 6,
        });
      else if (method === "getblock") raw = reply({ id: fixture.genesis });
      else if (method === "utxos") raw = node.spent ? reply([]) : coinsRaw();
      else if (method === "history") raw = reply([]);
      else if (method === "gettx") {
        if (params[0] === fixture.coin.txid)
          raw = reply({ hex: fixture.parentHex });
        else if (node.submitted.has(params[0]))
          raw = reply({ hex: node.submitted.get(params[0]) });
        else throw new Error("The node rejected this request.");
      } else if (method === "sendtx") {
        node.broadcasts++;
        if (node.disconnected)
          throw new Error("Node connection is unavailable.");
        if (node.fail) throw new Error("The node rejected this request.");
        raw = reply(node.ack);
        node.submitted.set(node.ack, params[0]);
      } else throw new Error("Unexpected RPC method " + method);
      return { raw, result: core("rpc", { raw }) };
    },
    async info() {
      return core("info", {
        raw: (await node.rpc("getinfo")).raw,
        genesis: (await node.rpc("getblock", [0])).raw,
      });
    },
    async snapshot(owner = fixture.metadata.owner) {
      return {
        ...core("snapshot", {
          coinsRaw: (await node.rpc("utxos", [owner])).raw,
          historyRaw: reply([]),
        }),
        info: await node.info(),
        observedAt: Date.now(),
      };
    },
    async parents(review) {
      return Object.fromEntries(
        await Promise.all(
          review.inputs.map(async (c) => [
            c.txid,
            (await node.rpc("gettx", [c.txid])).raw,
          ]),
        ),
      );
    },
  };
  return node;
}
