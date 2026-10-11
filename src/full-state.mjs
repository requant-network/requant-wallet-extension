const KEYS = [
  "requant.web.v1",
  "requant.web.outbox.v1",
  "requant.protocols.v1",
];
export class FullState {
  constructor(engine, core) {
    this.engine = engine;
    this.core = core;
  }
  row(w) {
    const file =
      w.hdFile ??
      JSON.stringify({
        requant_legacy: 1,
        network: "test",
        encrypted: w.encrypted,
        owner: w.owner,
      });
    return {
      id: w.id,
      name: w.name,
      file,
      meta: this.core("metadata", { file }),
      backedUp: w.backedUp,
      scanIncomplete: w.scanIncomplete ?? false,
    };
  }
  async load() {
    const db = await this.engine.db(),
      saved = (await this.engine.local.get("fullState")).fullState;
    return (
      saved ?? {
        revision: 0,
        data: {
          "requant.web.v1": JSON.stringify(db.wallets.map((w) => this.row(w))),
          "requant.web.outbox.v1": JSON.stringify(
            db.outbox.map((t) => ({
              ...t,
              status:
                t.status === "pending" ? "Pending" : "Broadcast status unknown",
            })),
          ),
        },
      }
    );
  }
  async save(revision, key, value) {
    if (
      !KEYS.includes(key) ||
      typeof value !== "string" ||
      value.length > 64 * 1024 * 1024
    )
      throw new Error("Unsupported wallet storage.");
    const state = await this.load();
    if (state.revision !== revision)
      throw new Error(
        "Wallet changed in another window. Reopen before continuing.",
      );
    const db = await this.engine.db();
    if (key === KEYS[0]) {
      const rows = JSON.parse(value);
      if (!Array.isArray(rows) || rows.length > 20)
        throw new Error("Wallet limit exceeded.");
      const ids = new Set(),
        addresses = new Set();
      db.wallets = rows.map((r) => {
        const meta = this.core("metadata", { file: r.file });
        if (
          JSON.stringify(meta) !== JSON.stringify(r.meta) ||
          typeof r.name !== "string" ||
          r.name.length > 40 ||
          typeof r.id !== "string" ||
          ids.has(r.id) ||
          addresses.has(meta.address)
        )
          throw new Error("Invalid wallet metadata.");
        ids.add(r.id);
        addresses.add(meta.address);
        const old = db.wallets.find((w) => w.id === r.id);
        if (old && old.address !== meta.address)
          throw new Error("Wallet identity cannot change.");
        const j = JSON.parse(r.file);
        return {
          id: r.id,
          name: r.name,
          address: meta.address,
          owner: meta.addresses[0].owner,
          publicKey: old?.publicKey,
          backedUp: r.backedUp === true,
          scanIncomplete: r.scanIncomplete === true,
          ...(meta.legacy ? { encrypted: j.encrypted } : { hdFile: r.file }),
        };
      });
      if (!db.wallets.some((w) => w.id === db.selected))
        db.selected = db.wallets[0]?.id ?? null;
      // A file/password change invalidates reviews and every unlocked provider session.
      await this.engine.lock();
    } else if (key === KEYS[2]) {
      this.core("protocolStore", { data: value, previous: state.data[key] });
    } else {
      const rows = JSON.parse(value);
      if (!Array.isArray(rows) || rows.length > 100)
        throw new Error("Invalid signed transaction outbox.");
      db.outbox = rows.map((r) => {
        if (
          !/^[a-f0-9]{64}$/.test(r.txid) ||
          !/^([a-f0-9]{2})+$/.test(r.hex) ||
          r.hex.length > 200000
        )
          throw new Error("Invalid signed transaction.");
        return { ...r, status: r.status === "Pending" ? "pending" : "unknown" };
      });
    }
    state.revision++;
    state.data[key] = value;
    await this.engine.local.set({ db, fullState: state });
    return state.revision;
  }
  async sync(db) {
    const previous = (await this.engine.local.get("fullState")).fullState;
    if (!previous) return;
    const wallets = JSON.stringify(db.wallets.map((w) => this.row(w)));
    const outbox = JSON.stringify(
      db.outbox.map((t) => ({
        ...t,
        status: t.status === "pending" ? "Pending" : "Broadcast status unknown",
      })),
    );
    if (previous.data[KEYS[0]] === wallets && previous.data[KEYS[1]] === outbox)
      return;
    const next = {
      revision: previous.revision + 1,
      data: { ...previous.data, [KEYS[0]]: wallets, [KEYS[1]]: outbox },
    };
    await this.engine.local.set({ fullState: next });
  }
}
