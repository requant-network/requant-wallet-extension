import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotRefresh } from "../src/snapshot-refresh.mjs";

function timers() {
  const pending = new Map();
  let next = 0;
  return {
    pending,
    setTimer(callback, delay) {
      const id = ++next;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    fire() {
      const [id, timer] = pending.entries().next().value;
      pending.delete(id);
      timer.callback();
    },
  };
}

test("a failed initial connection retries and replaces Offline with fresh verified data", async () => {
  const clock = timers();
  let attempts = 0;
  let error = "";
  let snapshot;
  const controller = createSnapshotRefresh({
    ...clock,
    load: async () => {
      if (++attempts === 1) throw new Error("Node connection is unavailable.");
      return { spendable: "0.00000000", observedAt: 2 };
    },
    onError: (e) => {
      error = e.message;
    },
    onSnapshot: (s) => {
      snapshot = s;
      error = "";
    },
  });
  await controller.refresh();
  assert.match(error, /unavailable/);
  assert.equal([...clock.pending.values()][0].delay, 5000);
  clock.fire();
  await controller.refresh();
  assert.equal(attempts, 2);
  assert.equal(error, "");
  assert.equal(snapshot.spendable, "0.00000000");
  assert.equal([...clock.pending.values()][0].delay, 30000);
  controller.dispose();
  assert.equal(clock.pending.size, 0);
});

test("overlapping manual and scheduled refreshes share a single node request", async () => {
  const clock = timers();
  let finish;
  let requests = 0;
  let snapshots = 0;
  const controller = createSnapshotRefresh({
    ...clock,
    load: () => {
      requests++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    onSnapshot: () => snapshots++,
    onError: assert.fail,
  });
  const first = controller.refresh();
  await Promise.resolve();
  assert.equal(controller.refresh(), first);
  finish({ spendable: "0.00000000" });
  await first;
  assert.equal(requests, 1);
  assert.equal(snapshots, 1);
  assert.equal(clock.pending.size, 1);
  controller.dispose();
});

test("locking, switching wallets or closing the popup ignores in-flight results", async () => {
  for (const fail of [false, true]) {
    const clock = timers();
    let complete;
    const controller = createSnapshotRefresh({
      ...clock,
      load: () =>
        new Promise((resolve, reject) => {
          complete = fail ? reject : resolve;
        }),
      onSnapshot: () => assert.fail("Stale wallet data must not update the UI"),
      onError: () => assert.fail("Stale errors must not update the UI"),
    });
    const request = controller.refresh();
    await Promise.resolve();
    controller.dispose();
    complete(
      fail ? new Error("Old wallet request") : { spendable: "1.00000000" },
    );
    await request;
    await controller.refresh();
    assert.equal(clock.pending.size, 0);
  }
});

test("a synchronous failure also retries, and a later outage keeps the last snapshot", async () => {
  const clock = timers();
  let connected = true;
  let snapshot;
  const controller = createSnapshotRefresh({
    ...clock,
    load: () => {
      if (!connected) throw new Error("Offline");
      return { spendable: "0.00000000" };
    },
    onSnapshot: (s) => {
      snapshot = s;
    },
    onError: () => {},
  });
  await controller.refresh();
  connected = false;
  await controller.refresh();
  assert.equal(snapshot.spendable, "0.00000000");
  assert.equal([...clock.pending.values()][0].delay, 5000);
  connected = true;
  await controller.refresh();
  assert.equal([...clock.pending.values()][0].delay, 30000);
  controller.dispose();
});
