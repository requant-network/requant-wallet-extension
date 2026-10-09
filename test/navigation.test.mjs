import test from "node:test";
import assert from "node:assert/strict";
import { initialPage, dedicatedPageUrl } from "../src/navigation.mjs";
test("backup and onboarding use persistent extension tabs; previews and existing tabs stay in place", () => {
  assert.equal(initialPage("?screen=backup"), "backup");
  assert.equal(initialPage("?screen=send"), "home");
  assert.equal(
    dedicatedPageUrl("backup", "", "chrome-extension://wallet/", false),
    "chrome-extension://wallet/popup.html?screen=backup",
  );
  assert.equal(
    dedicatedPageUrl(
      "backup",
      "?screen=backup",
      "chrome-extension://wallet/",
      false,
    ),
    null,
  );
  assert.equal(dedicatedPageUrl("create", "?preview", "", true), null);
  assert.equal(
    dedicatedPageUrl("receive", "", "chrome-extension://wallet/", false),
    null,
  );
});
