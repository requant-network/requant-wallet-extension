import { test as base, expect, chromium } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import init, { run } from "../pkg-browser/requant_browser_core.js";
import { fixture, password } from "../test/helpers.mjs";

await init({
  module_or_path: await readFile(
    new URL("../pkg-browser/requant_browser_core_bg.wasm", import.meta.url),
  ),
});
const core = (op, args) => JSON.parse(run(op, JSON.stringify(args)));
export { expect, fixture, password };
export const siteURL = "https://requant.network/e2e-dapp";

export async function launchExtension() {
  const profile = await mkdtemp(join(tmpdir(), "requant-extension-e2e-"));
  const extensionPath = resolve("dist");
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        "--disable-extensions-except=" + extensionPath,
        "--load-extension=" + extensionPath,
        "--host-resolver-rules=MAP * ~NOTFOUND",
      ],
    });
    const node = {
      broadcasts: [],
      requests: [],
      spent: false,
      loseResponse: false,
      beforeBroadcast: async () => {},
    };
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.href === siteURL ||
        url.pathname === "/e2e-frame" ||
        url.origin === "https://other.example"
      )
        return route.fulfill({
          contentType: "text/html",
          body:
            "<!doctype html><title>E2E website</title><h1>Unfunded wallet fixture</h1>" +
            (url.href === siteURL ? '<iframe src="/e2e-frame"></iframe>' : ""),
        });
      if (url.href !== "https://requant.network/wallet-api/v1/rpc") {
        if (["http:", "https:"].includes(url.protocol)) return route.abort();
        return route.continue();
      }
      node.requests.push(request.postData());
      const { method, params } = request.postDataJSON();
      let result;
      if (method === "getinfo")
        result = {
          network: "test",
          height: 100,
          tip: "a".repeat(64),
          peers: 4,
        };
      else if (method === "getblock") result = { id: fixture.genesis };
      else if (method === "utxos") {
        const owners = Array.isArray(params[0]) ? params[0] : [params[0]];
        result =
          node.spent || !owners.includes(fixture.metadata.owner)
            ? []
            : [
                {
                  ...fixture.coin,
                  owner: fixture.metadata.owner,
                  value: "__e2e_atoms__",
                },
              ];
      } else if (method === "history") result = [];
      else if (method === "gettx") {
        if (params[0] === fixture.coin.txid)
          result = { hex: fixture.parentHex };
        else {
          const signed = node.broadcasts.find((tx) => tx.txid === params[0]);
          if (!signed || node.loseResponse)
            return route.fulfill({
              json: { result: null, error: "not found" },
            });
          result = { hex: signed.hex };
        }
      } else if (method === "sendtx") {
        const signed = {
          ...core("signed", { hex: params[0] }),
          hex: params[0],
        };
        await node.beforeBroadcast(signed);
        node.broadcasts.push(signed);
        if (node.loseResponse) return route.abort("connectionreset");
        result = signed.txid;
      } else throw new Error("Unexpected RPC: " + method);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ result, error: null }).replaceAll(
          '"__e2e_atoms__"',
          fixture.coin.value,
        ),
      });
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    return {
      context,
      node,
      id,
      url: (path) => `chrome-extension://${id}/${path}`,
      async close() {
        await context.close();
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

export const test = base.extend({
  extension: async ({}, use, info) => {
    const extension = await launchExtension();
    await extension.context.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    try {
      await use(extension);
    } finally {
      const failed = info.status !== info.expectedStatus;
      const path = info.outputPath("trace.zip");
      await extension.context.tracing.stop(failed ? { path } : {});
      if (failed)
        await info.attach("trace", { path, contentType: "application/zip" });
      await extension.close();
    }
  },
  context: async ({ extension }, use) => {
    await use(extension.context);
  },
});

export async function importLegacy(page, extension) {
  await page.goto(extension.url("popup.html?screen=restore"));
  await page.getByLabel(/^Encrypted backup/).setInputFiles({
    name: "unfunded.key",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture.encrypted),
  });
  await page.getByLabel("Backup password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Restore wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connected", exact: true }),
  ).toBeVisible();
}

export async function review(page) {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByLabel("Recipient address", { exact: true })
    .fill(fixture.recipient);
  await page.getByLabel("Amount (RQT)").fill("1.00000000");
  await page
    .getByRole("button", { name: "Review transfer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review transfer.", exact: true }),
  ).toBeVisible();
}

export async function website(context, page) {
  // The production manifest already grants this host. Use Chrome's actual
  // scripting API to install the shipped provider without a toolbar permission dialog.
  await page.evaluate(async () => {
    await chrome.scripting.registerContentScripts([
      {
        id: "e2e-provider",
        matches: ["https://requant.network/*"],
        js: ["provider.js"],
        world: "MAIN",
        runAt: "document_start",
        allFrames: false,
      },
      {
        id: "e2e-bridge",
        matches: ["https://requant.network/*"],
        js: ["bridge.js"],
        world: "ISOLATED",
        runAt: "document_start",
        allFrames: false,
      },
    ]);
  });
  const site = await context.newPage();
  await site.goto(siteURL);
  await expect
    .poll(() => site.evaluate(() => window.requant?.isRequant))
    .toBe(true);
  return site;
}

export async function requestApproval(context, site, method, params) {
  const opening = context.waitForEvent("page");
  await site.evaluate(
    ({ method, params }) => {
      window.approvalResult = undefined;
      window.requant.request({ method, params }).then(
        (result) => (window.approvalResult = { result }),
        (error) =>
          (window.approvalResult = {
            error: { code: error.code, message: error.message },
          }),
      );
    },
    { method, params },
  );
  const approval = await opening;
  await approval.waitForURL(/popup\.html\?request=/);
  return approval;
}
