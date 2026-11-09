import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".test-profile/report", open: "never" }],
  ],
  outputDir: ".test-profile/e2e",
  use: { actionTimeout: 15_000, screenshot: "only-on-failure" },
});
