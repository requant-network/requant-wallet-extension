import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { run } from "../pkg-browser/requant_browser_core.js";
import { Engine } from "../src/engine.mjs";
import { FullState } from "../src/full-state.mjs";
import { core, Storage, fixture, password, mockNode } from "./helpers.mjs";
await init({
  module_or_path: await readFile(
    new URL("../pkg-browser/requant_browser_core_bg.wasm", import.meta.url),
  ),
});
const fullCore = (op, args) => {
  try {
    return JSON.parse(run(op, JSON.stringify(args)));
  } catch (e) {
    throw new Error(String(e));
  }
};
function setup() {
  const engine = new Engine({
    local: new Storage(),
    session: new Storage(),
    core,
    fullCore,
    node: mockNode(core),
  });
  engine.fullState = new FullState(engine, fullCore);
  return engine;
}
test("existing extension encrypted key survives migration, and stale writers cannot overwrite it", async () => {
  const engine = setup();
  await engine.add({
    name: "Existing unfunded key",
    encrypted: fixture.encrypted,
    password,
  });
  const state = await engine.fullState.load(),
    rows = JSON.parse(state.data["requant.web.v1"]);
  assert.equal(rows[0].meta.address, fixture.metadata.address);
  assert(!JSON.stringify(state).includes(password));
  await engine.fullState.save(
    state.revision,
    "requant.web.v1",
    JSON.stringify(rows),
  );
  assert.equal((await engine.state()).unlocked, false);
  await engine.unlock({ password });
  assert.equal((await engine.state()).unlocked, true);
  await assert.rejects(
    engine.fullState.save(state.revision, "requant.web.v1", "[]"),
    /another window/,
  );
  assert.equal((await engine.state()).wallets.length, 1);
});
test("HD wallets use the same encrypted format and never expose their file to provider state", async () => {
  const engine = setup(),
    created = fullCore("create", { password, count: 25 });
  const row = {
    id: "hd-test",
    name: "Unfunded HD fixture",
    file: created.file,
    meta: created.meta,
    backedUp: true,
  };
  await engine.fullState.save(0, "requant.web.v1", JSON.stringify([row]));
  await engine.unlock({ password });
  const state = await engine.state();
  assert.equal(state.unlocked, true);
  assert(!JSON.stringify(state).includes("requant-seed"));
  assert.equal(state.wallets[0].address, created.meta.address);
  assert(!JSON.stringify(await engine.sessions()).includes(password));
  const saved = await engine.backup({ password });
  assert.equal(saved.encrypted, created.file);
  await engine.changePassword({ password, nextPassword: password + "-new" });
  assert.equal((await engine.state()).unlocked, false);
  await assert.rejects(engine.unlock({ password }));
  await engine.unlock({ password: password + "-new" });
  const current = await engine.fullState.load();
  assert.equal(JSON.parse(current.data["requant.web.v1"])[0].backedUp, false);
});
test("watch-only files cannot unlock website signing and invalid metadata never replaces a wallet", async () => {
  const engine = setup(),
    created = fullCore("create", { password });
  const watch = fullCore("watch", { file: created.file }),
    meta = fullCore("metadata", { file: watch.file });
  const row = {
    id: "watch",
    name: "Unfunded watch-only",
    file: watch.file,
    meta,
    backedUp: true,
  };
  await engine.fullState.save(0, "requant.web.v1", JSON.stringify([row]));
  await assert.rejects(engine.unlock({ password: "" }), /Watch-only/);
  const state = await engine.fullState.load();
  row.meta = { ...meta, address: "fake" };
  await assert.rejects(
    engine.fullState.save(
      state.revision,
      "requant.web.v1",
      JSON.stringify([row]),
    ),
    /metadata/,
  );
  assert.equal((await engine.fullState.load()).revision, state.revision);
});
const hdFixture = JSON.parse(
  await readFile(
    new URL("../target/full-test-fixture.json", import.meta.url),
    "utf8",
  ),
);
test("HD provider payment validates parents, binds approval, and never broadcasts spent inputs", async () => {
  const engine = setup(),
    meta = fullCore("metadata", { file: hdFixture.file });
  const row = {
    id: "hd-site-test",
    name: "Unfunded provider fixture",
    file: hdFixture.file,
    meta,
    backedUp: true,
  };
  await engine.fullState.save(0, "requant.web.v1", JSON.stringify([row]));
  await engine.unlock({ password: hdFixture.password });
  const origin = "https://example.test";
  await engine.grantOrigin(origin);
  let spent = false,
    broadcasts = 0;
  const original = JSON.parse(hdFixture.request.coins[0].raw).result.map(
    (c) => ({ ...c, owner: hdFixture.request.coins[0].owner }),
  );
  engine.node = {
    info: async () => ({ tip: "a".repeat(64), height: 10 }),
    rpc: async (method, params) => {
      if (method === "utxos")
        return {
          raw: JSON.stringify({ error: null, result: spent ? [] : original }),
          result: original,
        };
      if (method === "history")
        return { raw: '{"error":null,"result":[]}', result: [] };
      if (method === "estimatefee") return { result: { feerate: 8 } };
      if (method === "gettx")
        return { raw: hdFixture.request.parents[params[0]], result: {} };
      if (method === "sendtx") {
        broadcasts++;
        throw new Error("Test must not broadcast");
      }
      throw new Error("Unexpected method");
    },
  };
  const sender = {
    frameId: 0,
    url: origin + "/app",
    origin,
    tab: { id: 4 },
    documentId: "test-doc",
  };
  const pending = await engine.provider(
    {
      action: "request",
      method: "requant_sendTransaction",
      params: {
        recipient: hdFixture.request.payments[0].address,
        amount: "1",
        fee: "0.0001",
      },
    },
    sender,
  );
  const plan = await engine.plan({
    requestId: pending.id,
    recipient: "injected",
    amount: "999",
  });
  assert.equal(plan.recipient, hdFixture.request.payments[0].address);
  assert.equal(plan.amount, "1.00000000");
  assert(plan.fee !== "0.00000000");
  spent = true;
  await assert.rejects(
    engine.send({ id: plan.id, password: hdFixture.password }),
    /coin changed/,
  );
  assert.equal(broadcasts, 0);
  await engine.lock();
  await assert.rejects(
    engine.send({ id: plan.id, password: hdFixture.password }),
    /locked|expired/,
  );
});
