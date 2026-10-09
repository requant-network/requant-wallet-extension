import test from "node:test";
import assert from "node:assert/strict";
import {
  Engine,
  LOCK_MS,
  REVIEW_MS,
  trustedSite,
  transactionParams,
  NodeClient,
} from "../src/engine.mjs";
import {
  fixture,
  core,
  password,
  Storage,
  mockNode,
  coinsRaw,
  reply,
} from "./helpers.mjs";
async function setup() {
  let now = 1000,
    valid = true;
  const local = new Storage(),
    session = new Storage(),
    node = mockNode(core),
    opened = [];
  const engine = new Engine({
    local,
    session,
    core,
    node,
    now: () => now,
    openApproval: async (id) => opened.push(id),
    validateDocument: async () => valid,
  });
  await engine.add({
    name: "Unfunded test fixture",
    encrypted: fixture.encrypted,
    password,
  });
  return {
    engine,
    local,
    session,
    node,
    opened,
    advance: (ms) => {
      now += ms;
    },
    navigate: () => {
      valid = false;
    },
  };
}
const sender = {
  frameId: 0,
  url: "https://example.test/app",
  origin: "https://example.test",
  tab: { id: 4 },
  documentId: "doc-1",
};
test("WASM restore interoperates with native backup; encrypted-only storage and five-minute lock", async () => {
  const { engine, local, session, advance } = await setup();
  const s = await engine.state();
  assert.equal(s.wallets[0].address, fixture.metadata.address);
  assert.equal(s.unlocked, true);
  assert.equal("encrypted" in s.wallets[0], false);
  assert(!JSON.stringify(local.data).includes(password));
  assert(!JSON.stringify(session.data).includes(password));
  const snapshot = await engine.snapshot();
  assert.equal(snapshot.spendable, "90071992.54740993");
  advance(LOCK_MS + 1);
  assert.equal((await engine.state()).unlocked, false);
  await assert.rejects(engine.snapshot(), /locked/);
  await assert.rejects(engine.unlock({ password: "wrong" }), /Wrong/);
  await engine.unlock({ password });
  assert.equal((await engine.state()).unlocked, true);
  await assert.rejects(
    engine.add({ name: "duplicate", encrypted: fixture.encrypted, password }),
    /already imported/,
  );
});
test("website approval binds top-level origin, tab and document; connected accounts require unlock", async () => {
  const { engine, opened, navigate } = await setup();
  await assert.rejects(
    engine.provider(
      { action: "request", method: "requant_requestAccounts" },
      { ...sender, frameId: 1 },
    ),
    /top-level/,
  );
  assert.deepEqual(
    (
      await engine.provider(
        { action: "request", method: "requant_accounts" },
        sender,
      )
    ).result,
    [],
  );
  const pending = await engine.provider(
    { action: "request", method: "requant_requestAccounts" },
    sender,
  );
  assert.equal(opened[0], pending.id);
  await assert.rejects(
    engine.provider(
      { action: "poll", id: pending.id },
      { ...sender, documentId: "doc-2" },
    ),
    /Unknown/,
  );
  await assert.rejects(
    engine.provider(
      { action: "poll", id: pending.id },
      { ...sender, url: "https://evil.test", origin: "https://evil.test" },
    ),
    /Unknown/,
  );
  await engine.approve({ id: pending.id });
  assert.deepEqual(
    (await engine.provider({ action: "poll", id: pending.id }, sender)).result,
    [fixture.metadata.address],
  );
  assert.deepEqual(
    (
      await engine.provider(
        { action: "request", method: "requant_accounts" },
        sender,
      )
    ).result,
    [fixture.metadata.address],
  );
  await engine.lock();
  assert.deepEqual(
    (
      await engine.provider(
        { action: "request", method: "requant_accounts" },
        sender,
      )
    ).result,
    [],
  );
  await engine.unlock({ password });
  await engine.revoke({ origin: sender.origin });
  assert.deepEqual(
    (
      await engine.provider(
        { action: "request", method: "requant_accounts" },
        sender,
      )
    ).result,
    [],
  );
  const changed = await engine.provider(
    { action: "request", method: "requant_requestAccounts" },
    sender,
  );
  navigate();
  await assert.rejects(engine.approve({ id: changed.id }), /page changed/);
});
test("review expires; spent outputs never reach broadcast; local signed result persists unknown before send", async () => {
  const { engine, node, local, advance } = await setup();
  const p = await engine.plan({
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  advance(REVIEW_MS + 1);
  await assert.rejects(engine.send({ id: p.id, password }), /expired/);
  assert.equal(node.broadcasts, 0);
  const spent = await engine.plan({
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  node.spent = true;
  await assert.rejects(
    engine.send({ id: spent.id, password }),
    /changed or were spent/,
  );
  assert.equal(node.broadcasts, 0);
  node.spent = false;
  const unknown = await engine.plan({
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  node.disconnected = true;
  const r = await engine.send({ id: unknown.id, password });
  assert.equal(r.status, "unknown");
  assert.equal(node.broadcasts, 1);
  assert.equal(local.data.db.outbox[0].status, "unknown");
  await assert.rejects(engine.send({ id: unknown.id, password }), /expired/);
  assert.equal(node.broadcasts, 1);
  assert(!JSON.stringify(local.data).includes(password));
  assert.equal("hex" in (await engine.state()).outbox[0], false);
});
test("website transfer is immutable, explicitly reviewed, rejected and revoked safely", async () => {
  const { engine, node } = await setup();
  await engine.grantOrigin(sender.origin);
  const pending = await engine.provider(
    {
      action: "request",
      method: "requant_sendTransaction",
      params: { recipient: fixture.recipient, amount: "1", fee: "0.0001" },
    },
    sender,
  );
  const p = await engine.plan({
    requestId: pending.id,
    recipient: fixture.metadata.address,
    amount: "999",
    fee: "4",
  });
  assert.equal(p.recipient, fixture.recipient);
  assert.equal(p.amount, "1.00000000");
  await engine.revoke({ origin: sender.origin });
  await assert.rejects(engine.send({ id: p.id, password }), /expired/);
  assert.equal(node.broadcasts, 0);
  await engine.grantOrigin(sender.origin);
  const rejected = await engine.provider(
    { action: "request", method: "requant_requestAccounts" },
    { ...sender, url: "https://second.test", origin: "https://second.test" },
  );
  await engine.reject({ id: rejected.id });
  assert.equal(
    (
      await engine.provider(
        { action: "poll", id: rejected.id },
        {
          ...sender,
          url: "https://second.test",
          origin: "https://second.test",
        },
      )
    ).error.code,
    4001,
  );
});
test("successful signedsendtx accepts exact acknowledgement; rejected results remain explicit", async () => {
  const { engine, node, session } = await setup();
  const p = await engine.plan({
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  const saved = session.data.session.plans[p.id];
  const signed = core("sign", {
    sealed: saved.sealed,
    owner: fixture.metadata.owner,
    parents: { [fixture.coin.txid]: reply({ hex: fixture.parentHex }) },
    freshRaw: coinsRaw(),
    encrypted: fixture.encrypted,
    password,
  });
  node.ack = signed.txid;
  const r = await engine.send({ id: p.id, password });
  assert.equal(r.status, "pending");
  assert.equal(r.txid, signed.txid);
  const p2 = await engine.plan({
    recipient: fixture.recipient,
    amount: "2",
    fee: "0.0001",
  });
  node.fail = true;
  assert.equal((await engine.send({ id: p2.id, password })).status, "rejected");
});
test("provider shape validation rejects HTTP, iframe impersonation and Number amounts", () => {
  assert.throws(
    () => trustedSite({ ...sender, url: "http://example.test" }),
    /HTTPS/,
  );
  assert.throws(
    () => trustedSite({ ...sender, origin: "https://evil.test" }),
    /mismatch/,
  );
  assert.throws(
    () => transactionParams({ recipient: fixture.recipient, amount: 1 }),
    /decimal string/,
  );
  assert.throws(
    () =>
      transactionParams({
        recipient: fixture.recipient,
        amount: "1",
        data: "anything",
      }),
    /Invalid/,
  );
});
test("NodeClient retains raw uint64 values and guards testnet genesis", async () => {
  const node = new NodeClient(core, async (_url, options) => {
    const { method } = JSON.parse(options.body);
    return new Response(
      method === "getinfo"
        ? reply({ network: "test", height: 1, tip: "a".repeat(64), peers: 2 })
        : method === "getblock"
          ? reply({ id: fixture.genesis })
          : method === "utxos"
            ? coinsRaw()
            : reply([]),
    );
  });
  assert.equal(
    (await node.snapshot(fixture.metadata.owner)).spendable,
    "90071992.54740993",
  );
  const wrong = new NodeClient(
    core,
    async () => new Response(reply({ id: "wrong" })),
  );
  await assert.rejects(wrong.info(), /testnet/);
});
test("a lock request interrupts an in-flight pre-sign network check", async () => {
  const { engine, node } = await setup();
  const p = await engine.plan({
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  const original = node.parents;
  let resume, entered;
  const arrived = new Promise((resolve) => {
    entered = resolve;
  });
  node.parents = async (r) => {
    entered();
    await new Promise((resolve) => {
      resume = resolve;
    });
    return original(r);
  };
  const sending = engine.send({ id: p.id, password });
  await arrived;
  engine.interruptLock();
  resume();
  await assert.rejects(sending, /locked/);
  assert.equal(node.broadcasts, 0);
  await engine.lock();
  await engine.unlock({ password });
  assert.equal((await engine.state()).unlocked, true);
});
