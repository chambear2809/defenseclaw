const path = require("path");
const { defineConfig } = require("@playwright/test");

const mfeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../../../..");
const outputRoot = path.join(repoRoot, "output", "playwright", "amd-deskside-demo");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "tokenomics-demo-ui.spec.js",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(outputRoot, "artifacts"),
  reporter: [["line"]],
  webServer: {
    command: "node scripts/serve-prebuilt-tokenomics-demo.js",
    cwd: mfeRoot,
    env: {
      API_PORT: "8787",
      HOST: "127.0.0.1",
      MFE_PORT: "3001",
      TOKENOMICS_BFF_URL: "",
    },
    reuseExistingServer: true,
    timeout: 20_000,
    url: "http://127.0.0.1:3001/fleet",
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
    viewport: { width: 1600, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
