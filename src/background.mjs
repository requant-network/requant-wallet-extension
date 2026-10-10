import init, { invoke } from "../pkg/requant_extension_core.js";
import { Engine, NodeClient, siteOrigin } from "./engine.mjs";
import { ExtensionUpdates } from "./updates.mjs";
const updates = new ExtensionUpdates(chrome);
chrome.alarms.create("requant-updates", { periodInMinutes: 360 });
chrome.runtime.onUpdateAvailable?.addListener((details) => {
  void updates.browserAvailable(details).catch(() => {});
});
void updates.check().catch(() => {});
const ready = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  await init({
    module_or_path: chrome.runtime.getURL("requant_extension_core_bg.wasm"),
  });
  const core = (op, args) => {
    try {
      return JSON.parse(invoke(op, JSON.stringify(args)));
    } catch (e) {
      throw new Error(typeof e === "string" ? e : e.message);
    }
  };
  return new Engine({
    local: chrome.storage.local,
    session: chrome.storage.session,
    core,
    node: new NodeClient(core),
    openApproval: async (id) => {
      await chrome.windows.create({
        url: chrome.runtime.getURL(
          `popup.html?request=${encodeURIComponent(id)}`,
        ),
        type: "popup",
        width: 420,
        height: 720,
      });
    },
    validateDocument: async (r) => {
      try {
        const tab = await chrome.tabs.get(r.tabId);
        if (siteOrigin(tab.url) !== r.origin) return false;
        const results = await chrome.scripting.executeScript({
          target: { tabId: r.tabId, frameIds: [0] },
          func: () => location.origin,
        });
        return (
          results.length === 1 &&
          results[0].result === r.origin &&
          results[0].documentId === r.documentId
        );
      } catch {
        return false;
      }
    },
  });
})();
chrome.alarms.create("requant-lock", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "requant-updates") void updates.check().catch(() => {});
  if (alarm.name !== "requant-lock") return;
  ready
    .then((e) =>
      e.serial(async () => {
        await e.sweep();
        await updates.apply(e);
      }),
    )
    .catch(() => {});
});
const uiSender = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.split("?")[0] === chrome.runtime.getURL("popup.html");
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    const engine = await ready;
    if (
      message?.channel === "requant-ui" &&
      message.action === "lock" &&
      uiSender(sender)
    )
      engine.interruptLock();
    return engine.serial(async () => {
      if (message?.channel === "requant-provider")
        return engine.provider(message, sender);
      if (message?.channel !== "requant-ui" || !uiSender(sender))
        throw new Error("Unauthorized extension request.");
      const action = message.action,
        args = message.args ?? {};
      if (action === "updateStatus") return updates.status();
      if (action === "checkUpdates") return updates.check(true);
      if (action === "applyBrowserUpdate") return updates.apply(engine, true);
      const allowed = [
        "state",
        "add",
        "unlock",
        "lock",
        "touch",
        "select",
        "backup",
        "markBackup",
        "changePassword",
        "snapshot",
        "plan",
        "send",
        "checkBroadcast",
        "approve",
        "reject",
        "revoke",
      ];
      if (action === "enableSite") {
        const origin = siteOrigin(args.origin);
        if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
          throw new Error("Grant access to this website first.");
        const key = Array.from(new TextEncoder().encode(origin))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const ids = [`requant-main-${key}`, `requant-bridge-${key}`];
        await chrome.scripting
          .unregisterContentScripts({ ids })
          .catch(() => {});
        await chrome.scripting.registerContentScripts([
          {
            id: ids[0],
            matches: [`${origin}/*`],
            js: ["provider.js"],
            world: "MAIN",
            runAt: "document_start",
            allFrames: false,
          },
          {
            id: ids[1],
            matches: [`${origin}/*`],
            js: ["bridge.js"],
            world: "ISOLATED",
            runAt: "document_start",
            allFrames: false,
          },
        ]);
        if (args.tabId !== undefined) {
          const tab = await chrome.tabs.get(args.tabId);
          if (siteOrigin(tab.url) !== origin)
            throw new Error("The current website changed.");
          await chrome.scripting.executeScript({
            target: { tabId: args.tabId },
            files: ["provider.js"],
            world: "MAIN",
          });
          await chrome.scripting.executeScript({
            target: { tabId: args.tabId },
            files: ["bridge.js"],
            world: "ISOLATED",
          });
        }
        return engine.grantOrigin(origin);
      }
      if (action === "revoke") {
        await engine.revoke(args);
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        const ids = scripts
          .filter((x) => x.matches?.includes(`${args.origin}/*`))
          .map((x) => x.id);
        if (ids.length)
          await chrome.scripting.unregisterContentScripts({ ids });
        await chrome.permissions
          .remove({ origins: [`${args.origin}/*`] })
          .catch(() => {});
        return true;
      }
      if (!allowed.includes(action))
        throw new Error("Unsupported extension request.");
      return engine[action](args);
    });
  })().then(
    (result) => respond({ ok: true, result }),
    (error) =>
      respond({
        ok: false,
        error: {
          message: error.message ?? "Wallet request failed.",
          code: error.code ?? -32603,
        },
      }),
  );
  return true;
});
chrome.windows.onRemoved.addListener(() => {
  /* Requests stay visible in the popup and expire after five minutes. */
});
