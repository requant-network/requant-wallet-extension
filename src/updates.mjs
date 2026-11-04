const FEED = "https://requant.network/updates/wallet/extension.json";
export function newer(version, current) {
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(current)
  )
    return false;
  const a = version.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export class ExtensionUpdates {
  constructor(
    browser,
    fetcher = fetch,
    verify = async () => {
      throw new Error("Installed signature verifier is unavailable.");
    },
  ) {
    this.verify = verify;
    this.browser = browser;
    this.fetcher = fetcher;
    this.running = null;
  }
  async status() {
    const stored =
      (await this.browser.storage.local.get("requantUpdates")).requantUpdates ||
      {};
    const version = this.browser.runtime.getManifest?.().version || "0.5.0";
    let row = {};
    if (stored.signed) {
      try {
        row = await this.release(stored.signed, version);
      } catch {
        /* Never offer an unverified cached update. */
      }
    }
    const details = await this.browser.management?.getSelf().catch(() => null);
    return {
      checkedAt: stored.checkedAt,
      error: stored.error,
      ...row,
      signed: row.version ? stored.signed : undefined,
      current: version,
      unpacked: !details || details.installType === "development",
      available: newer(row.version || "", version),
      browserVersion: stored.browserVersion,
      browserReady:
        !!stored.browserReady && newer(stored.browserVersion || "", version),
    };
  }
  async check(force = false) {
    if (this.running) return this.running;
    this.running = this.perform(force).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async perform(force) {
    const state = await this.status();
    if (
      !force &&
      state.checkedAt &&
      Date.now() - state.checkedAt < 6 * 60 * 60_000
    )
      return state;
    try {
      const response = await this.fetcher(FEED, {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Cannot check updates.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await readBounded(response, 262144),
      );
      const signed = JSON.parse(text);
      const row = await this.release(signed, state.version || state.current);
      if (
        state.version === row.version &&
        state.signed &&
        state.signed.manifest !== signed.manifest
      )
        throw new Error("Release versions are immutable.");
      const { browserReady, browserVersion } = state;
      await this.browser.storage.local.set({
        requantUpdates: {
          signed,
          checkedAt: Date.now(),
          browserReady,
          browserVersion,
          error: "",
        },
      });
    } catch {
      await this.browser.storage.local.set({
        requantUpdates: {
          ...((await this.browser.storage.local.get("requantUpdates"))
            .requantUpdates || {}),
          checkedAt: Date.now(),
          error: "Update check unavailable. Will retry automatically.",
        },
      });
    }
    return this.status();
  }
  async release(signed, floor) {
    if (
      typeof signed?.manifest !== "string" ||
      typeof signed?.signature !== "string"
    )
      throw new Error("Missing signed release manifest.");
    const manifest = await this.verify({
      ...signed,
      floor,
      client: this.browser.runtime.getManifest().version,
    });
    const name = `Requant-Wallet-Extension_${manifest.version}_chromium-testnet.zip`;
    const file = manifest.files?.[0];
    if (
      manifest.files?.length !== 1 ||
      file.path !== name ||
      file.bytes < 1 ||
      file.bytes > 16 * 1024 * 1024
    )
      throw new Error("Invalid signed extension package.");
    return {
      version: manifest.version,
      bytes: file.bytes,
      sha256: file.sha256,
      url: `https://requant.network/downloads/wallet/v${manifest.version}-testnet/${name}`,
    };
  }
  async download() {
    const state = await this.status();
    if (!state.available || !state.signed)
      throw new Error("No verified update is available.");
    const response = await this.fetcher(state.url, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("Cannot download the signed update.");
    const bytes = await readBounded(response, state.bytes);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (bytes.length !== state.bytes || digest !== state.sha256)
      throw new Error("Extension package hash verification failed.");
    // The trusted extension UI creates the Blob; MV3 workers cannot create object URLs.
    let encoded = "";
    for (let i = 0; i < bytes.length; i += 8192)
      encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {
      base64: btoa(encoded),
      name: `Requant-Wallet-Extension_${state.version}_chromium-testnet.zip`,
    };
  }
  async browserAvailable(details) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(details.version)) return;
    const previous =
      (await this.browser.storage.local.get("requantUpdates")).requantUpdates ||
      {};
    await this.browser.storage.local.set({
      requantUpdates: {
        ...previous,
        browserReady: true,
        browserVersion: details.version,
      },
    });
  }
  async apply(engine, explicit = false) {
    const offer = await this.status();
    if (!offer.browserReady || offer.unpacked) return false;
    const state = await engine.state();
    if (state.requests.length || (state.unlocked && !explicit)) return false;
    if (this.browser.runtime.getContexts) {
      const contexts = await this.browser.runtime.getContexts({
        contextTypes: ["POPUP", "TAB"],
      });
      if (contexts.length > (explicit ? 1 : 0)) return false;
    }
    engine.interruptLock();
    await engine.lock();
    this.browser.runtime.reload();
    return true;
  }
}

export async function readBounded(response, maximum) {
  if (Number(response.headers.get("content-length")) > maximum)
    throw new Error("Update exceeds the size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing update body.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Update exceeds the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
