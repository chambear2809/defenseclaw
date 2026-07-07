const path = require("path");
const { defineConfig } = require("@playwright/test");

const repoRoot = path.resolve(__dirname, "../../../..");
const outputRoot = path.join(repoRoot, "output", "playwright", "tokenomics-openclaw");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "tokenomics-openclaw-live.spec.js",
  timeout: Number(process.env.TOKENOMICS_E2E_TIMEOUT_MS || 8 * 60 * 1000),
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(outputRoot, "artifacts"),
  reporter: [
    ["line"],
    ["html", { outputFolder: path.join(outputRoot, "report"), open: "never" }],
  ],
  use: {
    headless: process.env.PW_HEADFUL !== "1",
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: process.env.OPENCLAW_GATEWAY_TOKEN ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
