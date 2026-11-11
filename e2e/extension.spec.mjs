import {
  test,
  expect,
  fixture,
  password,
  launchExtension,
  importLegacy,
  review,
  website,
  requestApproval,
} from "./fixtures.mjs";
import { readFile } from "node:fs/promises";

test("installed full wallet creates an HD backup and restores it in a separate extension profile", async ({
  page,
  extension,
}, info) => {
  await page.goto(extension.url("full.html"));
  const localPassword = "disposable-extension-hd-password";
  await page
    .getByLabel("Local wallet password", { exact: true })
    .fill(localPassword);
  await page.getByLabel("Confirm local password").fill(localPassword);
  await page.getByRole("button", { name: "Create wallet locally" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to wallet" }),
  ).toBeDisabled();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save encrypted backup", exact: true })
    .click();
  const backup = info.outputPath("unfunded-hd-backup.json");
  await (await pending).saveAs(backup);
  const encrypted = await readFile(backup, "utf8");
  expect(encrypted).not.toContain(localPassword);
  await page
    .getByLabel("I have stored my recovery phrase safely offline.")
    .check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await page
    .getByRole("button", { name: "Show address & QR", exact: true })
    .click();
  const address = await page.locator(".receive-address").innerText();
  const clean = await launchExtension();
  try {
    const restored = await clean.context.newPage();
    await restored.goto(clean.url("full.html"));
    await restored
      .getByRole("button", { name: "Import backup", exact: true })
      .click();
    await restored.locator('input[type="file"]').setInputFiles(backup);
    await restored
      .getByLabel("Backup password (leave empty for watch-only)")
      .fill("incorrect-password");
    await restored
      .getByRole("button", { name: "Restore wallet", exact: true })
      .click();
    await expect(restored.getByRole("alert")).toContainText(/Wrong.*password/);
    await restored
      .getByLabel("Backup password (leave empty for watch-only)")
      .fill(localPassword);
    await restored
      .getByRole("button", { name: "Restore wallet", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Show address & QR", exact: true })
      .click();
    await expect(restored.locator(".receive-address")).toHaveText(address);
    await restored.reload();
    await restored
      .getByRole("button", { name: "Show address & QR", exact: true })
      .click();
    await expect(restored.locator(".receive-address")).toHaveText(address);
    expect(clean.node.broadcasts).toHaveLength(0);
  } finally {
    await clean.close();
  }
  expect(extension.node.requests.join("\n")).not.toContain(localPassword);
});

test("legacy backup unlocks locally, preserves exact balances and sends only after password confirmation", async ({
  page,
  extension,
}) => {
  await importLegacy(page, extension);
  await expect(page.locator(".balance-card .balance")).toContainText(
    "90071992.54740993",
  );
  await review(page);
  await expect(page.locator(".review-amount")).toContainText("1.00000000");
  await page
    .getByLabel("Confirm with your wallet password")
    .fill("incorrect-password");
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /Wrong password|password/i,
  );
  expect(extension.node.broadcasts).toHaveLength(0);
  await page.getByLabel("Confirm with your wallet password").fill(password);
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "On its way." }),
  ).toBeVisible();
  expect(extension.node.broadcasts).toHaveLength(1);
  await page.reload();
  expect(extension.node.broadcasts).toHaveLength(1);
  expect(extension.node.requests.join("\n")).not.toContain(password);
  expect(extension.node.requests.join("\n")).not.toContain(fixture.encrypted);
});
test("a legacy backup imported in the full wallet unlocks and signs in the popup with the same key", async ({
  page,
  extension,
}) => {
  await page.goto(extension.url("full.html"));
  await page
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "unfunded-legacy.key",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture.encrypted),
  });
  await page
    .getByLabel("Backup password (leave empty for watch-only)")
    .fill(password);
  await page
    .getByRole("button", { name: "Restore wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show address & QR", exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(() => chrome.storage.local.get("db"));
  await page.goto(extension.url("popup.html"));
  await expect(
    page.getByRole("heading", { name: "Your wallet awaits." }),
  ).toBeVisible();
  await page
    .getByLabel("Wallet password", { exact: true })
    .fill("incorrect-password");
  await page
    .getByRole("button", { name: "Unlock wallet", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/Wrong.*password/);
  await page.getByLabel("Wallet password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Unlock wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connected", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() => chrome.storage.local.get("db"));
  expect(after.db.wallets[0]).toEqual({
    ...before.db.wallets[0],
    publicKey: fixture.metadata.publicKey,
  });
  expect(after.db.wallets[0].encrypted).toBe(fixture.encrypted);
  await page.getByRole("button", { name: "Lock wallet", exact: true }).click();
  await page.getByLabel("Wallet password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Unlock wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connected", exact: true }),
  ).toBeVisible();
  await review(page);
  await page.getByLabel("Confirm with your wallet password").fill(password);
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "On its way." }),
  ).toBeVisible();
  expect(extension.node.broadcasts).toHaveLength(1);
});

test("a spent coin blocks signing from an existing review", async ({
  page,
  extension,
}) => {
  await importLegacy(page, extension);
  await review(page);
  extension.node.spent = true;
  await page.getByLabel("Confirm with your wallet password").fill(password);
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/changed|spent/i);
  expect(extension.node.broadcasts).toHaveLength(0);
});

test("a lost broadcast response survives closing the popup; reconciliation never broadcasts twice", async ({
  page,
  context,
  extension,
}) => {
  await importLegacy(page, extension);
  extension.node.loseResponse = true;
  extension.node.beforeBroadcast = async (signed) => {
    const { db } = await page.evaluate(() => chrome.storage.local.get("db"));
    expect(db.outbox[0]).toMatchObject({
      txid: signed.txid,
      hex: signed.hex,
      status: "unknown",
    });
  };
  await review(page);
  await page.getByLabel("Confirm with your wallet password").fill(password);
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Check the explorer." }),
  ).toBeVisible();
  expect(extension.node.broadcasts).toHaveLength(1);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(extension.url("popup.html"));
  await reopened.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    reopened.getByText("Broadcast unknown", { exact: true }),
  ).toBeVisible();
  extension.node.loseResponse = false;
  await reopened
    .getByRole("button", { name: "Check broadcast", exact: true })
    .click();
  await expect(
    reopened.getByText("Pending confirmation", { exact: true }),
  ).toBeVisible();
  expect(extension.node.broadcasts).toHaveLength(1);
});

test("real website provider requires connection approval and explicit transaction approval", async ({
  page,
  context,
  extension,
}) => {
  await importLegacy(page, extension);
  const site = await website(context, page);
  expect(await site.evaluate(() => typeof window.ethereum)).toBe("undefined");
  expect(await site.frames()[1].evaluate(() => typeof window.requant)).toBe(
    "undefined",
  );
  let approval = await requestApproval(
    context,
    site,
    "requant_requestAccounts",
  );
  await expect(
    approval.getByRole("heading", { name: "Connect this site?" }),
  ).toBeVisible();
  await approval.getByRole("button", { name: "Reject", exact: true }).click();
  await expect
    .poll(() => site.evaluate(() => window.approvalResult?.error?.code))
    .toBe(4001);
  expect(
    await site.evaluate(() =>
      window.requant.request({ method: "requant_accounts" }),
    ),
  ).toEqual([]);
  await approval.close();
  approval = await requestApproval(context, site, "requant_requestAccounts");
  await approval.getByRole("button", { name: "Connect", exact: true }).click();
  await expect
    .poll(() => site.evaluate(() => window.approvalResult?.result))
    .toEqual([fixture.metadata.address]);
  await approval.close();
  approval = await requestApproval(context, site, "requant_sendTransaction", {
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  await approval
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  await expect
    .poll(() => site.evaluate(() => window.approvalResult?.error?.code))
    .toBe(4001);
  expect(extension.node.broadcasts).toHaveLength(0);
  await approval.close();
  approval = await requestApproval(context, site, "requant_sendTransaction", {
    recipient: fixture.recipient,
    amount: "1",
    fee: "0.0001",
  });
  await expect(
    approval.getByRole("textbox", { name: "Recipient address", exact: true }),
  ).toHaveValue(fixture.recipient);
  await expect(
    approval.getByRole("textbox", { name: "Recipient address", exact: true }),
  ).toHaveAttribute("readonly", "");
  await approval
    .getByRole("button", { name: "Review transfer", exact: true })
    .click();
  await approval.getByLabel("Confirm with your wallet password").fill(password);
  await approval
    .getByRole("button", { name: "Sign & send", exact: true })
    .click();
  await expect.poll(() => extension.node.broadcasts.length).toBe(1);
  await expect
    .poll(() => site.evaluate(() => window.approvalResult?.result?.txid))
    .toBe(extension.node.broadcasts[0].txid);
  expect(extension.node.broadcasts).toHaveLength(1);
});

test("navigating the requesting website invalidates its open approval", async ({
  page,
  context,
  extension,
}) => {
  await importLegacy(page, extension);
  const site = await website(context, page);
  const approval = await requestApproval(
    context,
    site,
    "requant_requestAccounts",
  );
  await expect(
    approval.getByRole("heading", { name: "Connect this site?" }),
  ).toBeVisible();
  await site.goto("https://other.example/e2e");
  await approval.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(approval.getByRole("alert")).toContainText(
    /page changed|expired/i,
  );
  expect(extension.node.broadcasts).toHaveLength(0);
});

test("MV3 restart preserves an unknown signed transfer and never automatically rebroadcasts it", async ({
  page,
  context,
  extension,
}) => {
  await importLegacy(page, extension);
  extension.node.loseResponse = true;
  await review(page);
  await page.getByLabel("Confirm with your wallet password").fill(password);
  await page.getByRole("button", { name: "Sign & send", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Check the explorer." }),
  ).toBeVisible();
  const before = await page.evaluate(() => chrome.storage.local.get("db"));
  expect(before.db.outbox).toHaveLength(1);
  expect(JSON.stringify(before)).not.toContain(password);
  const serviceWorker = context.serviceWorkers()[0];
  await serviceWorker.evaluate(() => {
    globalThis.__walletE2EBoot = "before-stop";
  });
  const cdp = await context.newCDPSession(page);
  let version,
    stopped = false;
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const current of versions) {
      if (current.scriptURL === extension.url("background.js")) {
        version = current;
        if (current.runningStatus === "stopped") stopped = true;
      }
    }
  });
  try {
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => version?.runningStatus).toBe("running");
    await cdp.send("ServiceWorker.stopWorker", {
      versionId: version.versionId,
    });
    await expect.poll(() => stopped).toBe(true);
    await page.reload();
    // Playwright retains the Worker handle across MV3 suspension. A new global
    // scope, rather than a new handle/event, proves that the worker restarted.
    expect(
      await serviceWorker.evaluate(() => globalThis.__walletE2EBoot),
    ).toBeUndefined();
  } finally {
    await cdp.detach();
  }
  await expect(page.getByLabel("Selected wallet")).toHaveValue(
    before.db.selected,
  );
  const after = await page.evaluate(() => chrome.storage.local.get("db"));
  expect(after.db.wallets).toEqual(before.db.wallets);
  expect(after.db.outbox).toEqual(before.db.outbox);
  expect(extension.node.broadcasts).toHaveLength(1);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("Broadcast unknown", { exact: true }),
  ).toBeVisible();
  extension.node.loseResponse = false;
  await page
    .getByRole("button", { name: "Check broadcast", exact: true })
    .click();
  await expect(
    page.getByText("Pending confirmation", { exact: true }),
  ).toBeVisible();
  expect(extension.node.broadcasts).toHaveLength(1);
});
