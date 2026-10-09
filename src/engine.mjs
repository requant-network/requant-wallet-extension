export const API = "https://requant.network/wallet-api/v1/rpc";
export const LOCK_MS = 5 * 60_000;
export const REVIEW_MS = 120_000;
export const REQUEST_MS = 5 * 60_000;
const uuid = () => crypto.randomUUID();
export class WalletError extends Error {
  constructor(message, code = -32603) {
    super(message);
    this.code = code;
  }
}
export function siteOrigin(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new WalletError("Only HTTPS websites can connect.", 4100);
  return u.origin;
}
export function trustedSite(sender) {
  if (sender.frameId !== 0 || !sender.tab || !sender.documentId || !sender.url)
    throw new WalletError(
      "Only the current top-level website can connect.",
      4100,
    );
  const origin = siteOrigin(sender.url);
  if (sender.origin && sender.origin !== origin)
    throw new WalletError("Website origin mismatch.", 4100);
  return { origin, tabId: sender.tab.id, documentId: sender.documentId };
}
export function transactionParams(p) {
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).some((k) => !["recipient", "amount", "fee"].includes(k))
  )
    throw new WalletError("Invalid transaction parameters.", -32602);
  if (
    typeof p.recipient !== "string" ||
    p.recipient.length > 120 ||
    typeof p.amount !== "string" ||
    p.amount.length > 30 ||
    (p.fee !== undefined && (typeof p.fee !== "string" || p.fee.length > 30))
  )
    throw new WalletError(
      "Use a testnet recipient and decimal string amounts.",
      -32602,
    );
  return { recipient: p.recipient, amount: p.amount, fee: p.fee ?? "0.0001" };
}
export class NodeClient {
  constructor(core, fetcher = fetch) {
    this.core = core;
    this.fetcher = fetcher;
  }
  async rpc(method, params = []) {
    const r = await this.fetcher(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    }).catch(() => {
      throw new WalletError("Node connection is unavailable.");
    });
    if (!r.ok) throw new WalletError("Node connection is unavailable.");
    const reader = r.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024)
          throw new WalletError("Node response is too large.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { raw, result: this.core("rpc", { raw }) };
  }
  async info() {
    const [status, genesis] = await Promise.all([
      this.rpc("getinfo"),
      this.rpc("getblock", [0]),
    ]);
    return this.core("info", { raw: status.raw, genesis: genesis.raw });
  }
  async snapshot(owner) {
    for (let i = 0; i < 2; i++) {
      const info = await this.info();
      const [coins, history] = await Promise.all([
        this.rpc("utxos", [owner]),
        this.rpc("history", [owner, 100]),
      ]);
      if ((await this.info()).tip !== info.tip) continue;
      return {
        ...this.core("snapshot", {
          coinsRaw: coins.raw,
          historyRaw: history.raw,
        }),
        info,
        observedAt: Date.now(),
      };
    }
    throw new WalletError("The chain changed. Refresh your wallet.");
  }
  async parents(review) {
    const parents = {};
    for (const c of review.inputs)
      if (!parents[c.txid])
        parents[c.txid] = (await this.rpc("gettx", [c.txid])).raw;
    return parents;
  }
}
export class Engine {
  constructor({
    local,
    session,
    core,
    node,
    now = Date.now,
    openApproval = async () => {},
    validateDocument = async () => true,
  }) {
    Object.assign(this, {
      local,
      session,
      core,
      node,
      now,
      openApproval,
      validateDocument,
    });
    this.queue = Promise.resolve();
    this.lockGeneration = 0;
    this.forceLocked = false;
  }
  interruptLock() {
    this.lockGeneration++;
    this.forceLocked = true;
  }
  serial(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async db() {
    return (
      (await this.local.get("db")).db ?? {
        version: 1,
        wallets: [],
        selected: null,
        sites: {},
        outbox: [],
      }
    );
  }
  async save(db) {
    await this.local.set({ db });
  }
  async sessions() {
    return (
      (await this.session.get("session")).session ?? {
        unlocks: {},
        plans: {},
        requests: {},
      }
    );
  }
  async saveSession(s) {
    await this.session.set({ session: s });
  }
  wallet(db, id = db.selected) {
    const w = db.wallets.find((w) => w.id === id);
    if (!w) throw new WalletError("Select a wallet first.");
    return w;
  }
  authorized(s, id) {
    return !this.forceLocked && (s.unlocks[id] ?? 0) > this.now();
  }
  access(s, id) {
    if (!this.authorized(s, id))
      throw new WalletError("Wallet is locked. Unlock it to continue.", 4100);
  }
  public(w) {
    const { encrypted, ...safe } = w;
    return safe;
  }
  async sweep() {
    const s = await this.sessions();
    for (const [id, expires] of Object.entries(s.unlocks))
      if (expires <= this.now()) delete s.unlocks[id];
    for (const [id, p] of Object.entries(s.plans))
      if (
        p.created + REVIEW_MS <= this.now() ||
        !this.authorized(s, p.walletId)
      )
        delete s.plans[id];
    for (const [id, r] of Object.entries(s.requests))
      if (r.created + REQUEST_MS + 60_000 <= this.now()) delete s.requests[id];
    await this.saveSession(s);
  }
  async state() {
    await this.sweep();
    const db = await this.db(),
      s = await this.sessions();
    return {
      wallets: db.wallets.map((w) => this.public(w)),
      selected: db.selected,
      unlocked: this.authorized(s, db.selected),
      sites: db.sites,
      outbox: db.outbox
        .filter((b) => b.walletId === db.selected)
        .map(({ hex, ...safe }) => safe),
      requests: Object.values(s.requests)
        .filter((r) => !r.done && r.created + REQUEST_MS > this.now())
        .map((r) => ({
          id: r.id,
          origin: r.origin,
          type: r.type,
          params: r.params,
          created: r.created,
          walletId: r.walletId,
        })),
    };
  }
  async add({ name, password, encrypted }) {
    const generation = this.lockGeneration;
    if (typeof name !== "string" || !name.trim() || name.length > 40)
      throw new WalletError("Use a wallet name between 1 and 40 characters.");
    if (typeof password !== "string")
      throw new WalletError("Enter a wallet password.");
    const db = await this.db();
    if (db.wallets.length >= 20)
      throw new WalletError("This version supports up to 20 wallets.");
    const result = this.core(encrypted ? "restore" : "create", {
      password,
      ...(encrypted ? { encrypted } : {}),
    });
    if (db.wallets.some((w) => w.owner === result.meta.owner))
      throw new WalletError("This wallet is already imported.");
    const w = {
      id: uuid(),
      name: name.trim(),
      ...result.meta,
      encrypted: result.encrypted,
      backedUp: !!encrypted,
    };
    db.wallets.push(w);
    db.selected = w.id;
    await this.save(db);
    if (generation !== this.lockGeneration)
      throw new WalletError(
        "Wallet created but locked. Unlock it to continue.",
      );
    this.forceLocked = false;
    const s = await this.sessions();
    s.unlocks[w.id] = this.now() + LOCK_MS;
    await this.saveSession(s);
    return this.public(w);
  }
  async unlock({ password }) {
    const generation = this.lockGeneration;
    const db = await this.db(),
      w = this.wallet(db);
    const result = this.core("unlock", { encrypted: w.encrypted, password });
    if (
      result.meta.owner !== w.owner ||
      result.meta.address !== w.address ||
      result.meta.publicKey !== w.publicKey
    )
      throw new WalletError(
        "Wallet metadata does not match its encrypted key.",
      );
    const s = await this.sessions();
    if (generation !== this.lockGeneration)
      throw new WalletError("Wallet was locked. Unlock it again.");
    this.forceLocked = false;
    s.unlocks[w.id] = this.now() + LOCK_MS;
    await this.saveSession(s);
    return true;
  }
  async lock() {
    this.interruptLock();
    const s = await this.sessions();
    s.unlocks = {};
    s.plans = {};
    await this.saveSession(s);
    return true;
  }
  async touch() {
    const db = await this.db(),
      s = await this.sessions();
    this.access(s, db.selected);
    s.unlocks[db.selected] = this.now() + LOCK_MS;
    await this.saveSession(s);
    return true;
  }
  async select({ id }) {
    const db = await this.db();
    this.wallet(db, id);
    db.selected = id;
    await this.save(db);
    return true;
  }
  async backup({ password }) {
    const db = await this.db(),
      w = this.wallet(db),
      s = await this.sessions();
    this.access(s, w.id);
    const m = this.core("unlock", { encrypted: w.encrypted, password }).meta;
    if (m.owner !== w.owner) throw new WalletError("Wallet metadata mismatch.");
    return { id: w.id, encrypted: w.encrypted, address: w.address };
  }
  async markBackup({ id }) {
    const db = await this.db(),
      w = this.wallet(db, id),
      s = await this.sessions();
    this.access(s, w.id);
    w.backedUp = true;
    await this.save(db);
    return true;
  }
  async changePassword({ password, nextPassword }) {
    const db = await this.db(),
      w = this.wallet(db),
      s = await this.sessions();
    this.access(s, w.id);
    const r = this.core("changePassword", {
      encrypted: w.encrypted,
      password,
      nextPassword,
    });
    if (r.meta.owner !== w.owner)
      throw new WalletError("Wallet metadata mismatch.");
    w.encrypted = r.encrypted;
    w.backedUp = false;
    await this.save(db);
    await this.lock();
    return true;
  }
  async snapshot() {
    const db = await this.db(),
      s = await this.sessions(),
      w = this.wallet(db);
    this.access(s, w.id);
    const snapshot = await this.node.snapshot(w.owner);
    this.access(await this.sessions(), w.id);
    return snapshot;
  }
  async plan({ recipient, amount, fee, requestId }) {
    const db = await this.db(),
      s = await this.sessions();
    let w = this.wallet(db);
    if (requestId) {
      const r = await this.request(s, requestId);
      if (r.type !== "send") throw new WalletError("Invalid approval request.");
      w = this.wallet(db, r.walletId);
      ({ recipient, amount, fee } = r.params);
    }
    this.access(s, w.id);
    if (!w.backedUp)
      throw new WalletError("Save an encrypted backup before sending.");
    const info = await this.node.info(),
      c = await this.node.rpc("utxos", [w.owner]);
    const plan = this.core("plan", { coinsRaw: c.raw, recipient, amount, fee });
    const parents = await this.node.parents(plan.review);
    this.core("verifyParents", {
      sealed: plan.sealed,
      owner: w.owner,
      parents,
    });
    if ((await this.node.info()).tip !== info.tip)
      throw new WalletError("The chain changed. Review the transfer again.");
    const fresh = await this.sessions();
    this.access(fresh, w.id);
    if (requestId) await this.request(fresh, requestId);
    const id = uuid();
    fresh.plans[id] = {
      ...plan,
      id,
      walletId: w.id,
      created: this.now(),
      requestId,
    };
    await this.saveSession(fresh);
    return { id, ...plan.review, address: w.address, walletName: w.name };
  }
  async send({ id, password }) {
    let s = await this.sessions();
    const p = s.plans[id];
    if (!p || p.created + REVIEW_MS <= this.now())
      throw new WalletError("Transfer review expired. Review it again.");
    this.access(s, p.walletId);
    if (p.requestId) await this.request(s, p.requestId);
    const db = await this.db(),
      w = this.wallet(db, p.walletId);
    if (!w.backedUp)
      throw new WalletError("Save an encrypted backup before sending.");
    const info = await this.node.info(),
      fresh = await this.node.rpc("utxos", [w.owner]),
      parents = await this.node.parents(p.review);
    if ((await this.node.info()).tip !== info.tip)
      throw new WalletError("The chain changed. Review the transfer again.");
    s = await this.sessions();
    this.access(s, w.id);
    if (p.created + REVIEW_MS <= this.now() || !s.plans[id])
      throw new WalletError("Transfer review expired.");
    if (p.requestId) await this.request(s, p.requestId);
    const signed = this.core("sign", {
      sealed: p.sealed,
      owner: w.owner,
      parents,
      freshRaw: fresh.raw,
      encrypted: w.encrypted,
      password,
    });
    const entry = {
      ...signed,
      walletId: w.id,
      status: "unknown",
      created: this.now(),
    };
    db.outbox.push(entry);
    db.outbox = db.outbox.slice(-100);
    await this.save(db);
    delete s.plans[id];
    await this.saveSession(s);
    let accepted = false,
      rejected = false;
    try {
      accepted =
        (await this.node.rpc("sendtx", [signed.hex])).result === signed.txid;
    } catch (e) {
      rejected = e.message === "The node rejected this request.";
    }
    if (!accepted)
      try {
        accepted =
          (await this.node.rpc("gettx", [signed.txid])).result.hex ===
          signed.hex;
      } catch {}
    entry.status = accepted ? "pending" : rejected ? "rejected" : "unknown";
    await this.save(db);
    const result = {
      txid: signed.txid,
      status: entry.status,
      message: accepted
        ? "Transfer submitted. Waiting for confirmation."
        : rejected
          ? "The node rejected this transfer. Refresh and review before trying again."
          : "Broadcast result is unknown. Check this transaction before sending again.",
    };
    if (p.requestId) {
      s = await this.sessions();
      const r = s.requests[p.requestId];
      if (r) {
        r.done = true;
        r.result = result;
        await this.saveSession(s);
      }
    }
    return result;
  }
  async checkBroadcast({ txid }) {
    const db = await this.db(),
      s = await this.sessions();
    this.access(s, db.selected);
    const entry = db.outbox.find(
      (b) => b.txid === txid && b.walletId === db.selected,
    );
    if (!entry) throw new WalletError("Unknown local transaction.");
    const found = await this.node.rpc("gettx", [txid]);
    if (found.result.hex !== entry.hex)
      throw new WalletError("The node returned different transaction bytes.");
    entry.status = "pending";
    await this.save(db);
    return true;
  }
  async grantOrigin(origin) {
    const db = await this.db(),
      s = await this.sessions(),
      w = this.wallet(db);
    this.access(s, w.id);
    db.sites[origin] = { walletId: w.id };
    await this.save(db);
    return w.address;
  }
  async revoke({ origin }) {
    const db = await this.db();
    delete db.sites[origin];
    await this.save(db);
    const s = await this.sessions();
    for (const r of Object.values(s.requests))
      if (r.origin === origin && !r.done) {
        r.done = true;
        r.error = { code: 4100, message: "Website disconnected." };
      }
    for (const [id, p] of Object.entries(s.plans))
      if (p.requestId && s.requests[p.requestId]?.origin === origin)
        delete s.plans[id];
    await this.saveSession(s);
    return true;
  }
  async request(s, id) {
    const r = s.requests[id];
    if (
      !r ||
      r.done ||
      r.created + REQUEST_MS <= this.now() ||
      !(await this.validateDocument(r))
    )
      throw new WalletError(
        "Website request expired or its page changed.",
        4001,
      );
    return r;
  }
  async approve({ id }) {
    const s = await this.sessions(),
      r = await this.request(s, id);
    if (r.type !== "connect")
      throw new WalletError("Review the transaction before approving.");
    const address = await this.grantOrigin(r.origin);
    r.done = true;
    r.result = [address];
    await this.saveSession(s);
    return true;
  }
  async reject({ id }) {
    const s = await this.sessions(),
      r = s.requests[id];
    if (r && !r.done) {
      r.done = true;
      r.error = { code: 4001, message: "Request rejected by the user." };
      await this.saveSession(s);
    }
    return true;
  }
  async provider(message, sender) {
    const site = trustedSite(sender),
      s = await this.sessions(),
      db = await this.db();
    if (message.action === "poll") {
      const r = s.requests[message.id];
      if (
        !r ||
        r.origin !== site.origin ||
        r.tabId !== site.tabId ||
        r.documentId !== site.documentId
      )
        throw new WalletError("Unknown website request.", 4100);
      if (r.created + REQUEST_MS <= this.now())
        throw new WalletError("Website request timed out.", 4001);
      if (!(await this.validateDocument(r)))
        throw new WalletError("Website page changed.", 4001);
      return r.done
        ? { done: true, result: r.result, error: r.error }
        : { done: false };
    }
    if (message.action !== "request" || typeof message.method !== "string")
      throw new WalletError("Invalid provider request.", -32600);
    if (message.method === "requant_getNetwork")
      return {
        done: true,
        result: { network: "testnet", chain: "requant", version: 1 },
      };
    const grant = db.sites[site.origin],
      w = grant ? db.wallets.find((w) => w.id === grant.walletId) : null;
    if (message.method === "requant_accounts")
      return {
        done: true,
        result: w && this.authorized(s, w.id) ? [w.address] : [],
      };
    if (
      message.method === "requant_requestAccounts" &&
      w &&
      this.authorized(s, w.id)
    )
      return { done: true, result: [w.address] };
    if (
      !["requant_requestAccounts", "requant_sendTransaction"].includes(
        message.method,
      )
    )
      throw new WalletError("This Requant method is not supported.", 4200);
    if (
      message.method === "requant_sendTransaction" &&
      (!w || !this.authorized(s, w.id))
    )
      throw new WalletError("Connect and unlock this wallet first.", 4100);
    const active = Object.values(s.requests).filter(
      (r) => !r.done && r.created + REQUEST_MS > this.now(),
    );
    if (active.length >= 10 || active.some((r) => r.origin === site.origin))
      throw new WalletError("A website approval is already waiting.", -32002);
    const id = uuid();
    const r = {
      id,
      ...site,
      type: message.method === "requant_requestAccounts" ? "connect" : "send",
      created: this.now(),
      walletId: w?.id,
      ...(message.method === "requant_sendTransaction"
        ? { params: transactionParams(message.params) }
        : {}),
    };
    s.requests[id] = r;
    await this.saveSession(s);
    try {
      await this.openApproval(id);
    } catch {
      delete s.requests[id];
      await this.saveSession(s);
      throw new WalletError("Open the extension to approve this request.");
    }
    return { done: false, id };
  }
}
