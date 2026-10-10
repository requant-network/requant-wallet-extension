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
  constructor(browser, fetcher = fetch) {
    this.browser = browser;
    this.fetcher = fetcher;
    this.running = null;
  }
  async status() {
    const stored =
      (await this.browser.storage.local.get("requantUpdates")).requantUpdates ||
      {};
    const details = await this.browser.management?.getSelf().catch(() => null);
    const version = this.browser.runtime.getManifest?.().version || "0.3.0";
    return {
      ...stored,
      current: version,
      unpacked: !details || details.installType === "development",
      available: newer(stored.version || "", version),
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
      const text = await response.text();
      if (text.length > 65_536) throw new Error("Invalid update feed.");
      const row = JSON.parse(text);
      if (
        !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(row.version) ||
        row.url !==
          `https://requant.network/downloads/wallet/v${row.version}-testnet/Requant-Wallet-Extension_${row.version}_chromium-testnet.zip` ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes <= 0 ||
        row.bytes > 20_000_000
      )
        throw new Error("Invalid update feed.");
      const { browserReady, browserVersion } = state;
      await this.browser.storage.local.set({
        requantUpdates: {
          ...row,
          checkedAt: Date.now(),
          browserReady,
          browserVersion,
          error: "",
        },
      });
    } catch {
      await this.browser.storage.local.set({
        requantUpdates: {
          ...state,
          checkedAt: Date.now(),
          error: "Update check unavailable. Will retry automatically.",
        },
      });
    }
    return this.status();
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
    if (!explicit && this.browser.runtime.getContexts) {
      const contexts = await this.browser.runtime.getContexts({
        contextTypes: ["POPUP", "TAB"],
      });
      if (contexts.length) return false;
    }
    engine.interruptLock();
    await engine.lock();
    this.browser.runtime.reload();
    return true;
  }
}
