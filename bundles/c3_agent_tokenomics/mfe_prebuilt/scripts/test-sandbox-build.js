const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const serverScript = path.join(__dirname, "serve-prebuilt-tokenomics-demo.js");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitFor(url, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`prebuilt server exited early (${child.exitCode}): ${stderr.join("")}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(250) });
      if (response.ok) return;
    } catch (_error) {
      // The child has not bound its ports yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}: ${stderr.join("")}`);
}

async function main() {
  const requiredFiles = [
    "dist/index.html",
    "dist/main.js",
    "dist/remoteEntry.js",
    "embedded_live/app.js",
    "embedded_live/index.html",
    "fixtures/tokenomics-summary-runtime-governance.json",
    "shell/app.js",
    "shell/index.html",
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(rootDir, relativePath)), true, `missing ${relativePath}`);
  }

  const remoteEntry = fs.readFileSync(path.join(rootDir, "dist/remoteEntry.js"), "utf8");
  assert.match(remoteEntry, /"\.\/App"/);
  assert.match(remoteEntry, /"\.\/DefenseClawTokenomics"/);

  const apiPort = await freePort();
  const appPort = await freePort();
  const stderr = [];
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      HOST: "127.0.0.1",
      MFE_PORT: String(appPort),
      TOKENOMICS_BFF_URL: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    await waitFor(`http://127.0.0.1:${apiPort}/healthz`, child, stderr);
    const appResponse = await fetch(`http://127.0.0.1:${appPort}/`);
    assert.equal(appResponse.status, 200);

    const summaryResponse = await fetch(`http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.debug.fixture_backed, true);

    const rowsResponse = await fetch(`http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/usage/rows`);
    assert.equal(rowsResponse.status, 200);
    const rows = await rowsResponse.json();
    assert.equal(rows.debug.fixture_backed, true);
    assert.ok(Array.isArray(rows.rows) && rows.rows.length > 0);

    const controlResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/controls/apply`,
      { method: "POST" },
    );
    assert.equal(controlResponse.status, 503);
    const control = await controlResponse.json();
    assert.equal(control.error, "fixture_mode_read_only");

    const traversalResponse = await fetch(`http://127.0.0.1:${appPort}/shell/..%2fpackage.json`);
    assert.equal(traversalResponse.status, 403);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
