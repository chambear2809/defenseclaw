const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

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

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  const requests = [];
  let hangRequests = false;
  const upstream = http.createServer((request, response) => {
    if (hangRequests) return;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ body, method: request.method, url: request.url });
      const payload = Buffer.from(JSON.stringify({ body, method: request.method, url: request.url }));
      response.writeHead(200, {
        "content-length": payload.length,
        "content-type": "application/json",
      });
      response.end(payload);
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = upstream.address().port;
  const apiPort = await freePort();
  const appPort = await freePort();
  const stderr = [];
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      HOST: "127.0.0.1",
      MFE_PORT: String(appPort),
      TOKENOMICS_BFF_URL: `http://127.0.0.1:${upstreamPort}`,
      TOKENOMICS_BFF_TIMEOUT_MS: "100",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    await waitFor(`http://127.0.0.1:${apiPort}/healthz`, child, stderr);

    const summaryResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/summary?window=-24h&include_galileo=true`,
    );
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.method, "GET");
    assert.equal(summary.url, "/v1/c3/agent-tokenomics/summary?window=-24h&include_galileo=true");

    const controlBody = { action: "deny", agent_id: "proxy-smoke", daily_token_budget: 1 };
    const controlResponse = await fetch(
      `http://127.0.0.1:${apiPort}/v1/c3/agent-tokenomics/controls/apply`,
      {
        body: JSON.stringify(controlBody),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    assert.equal(controlResponse.status, 200);
    const control = await controlResponse.json();
    assert.equal(control.method, "POST");
    assert.deepEqual(JSON.parse(control.body), controlBody);
    assert.equal(requests.at(-1).url, "/v1/c3/agent-tokenomics/controls/apply");

    hangRequests = true;
    const timeoutResponse = await fetch(`http://127.0.0.1:${apiPort}/healthz`);
    assert.equal(timeoutResponse.status, 504);
    const timeout = await timeoutResponse.json();
    assert.equal(timeout.error, "tokenomics_bff_timeout");
    hangRequests = false;

    upstream.close();
    await once(upstream, "close");
    const unavailableResponse = await fetch(`http://127.0.0.1:${apiPort}/healthz`);
    assert.equal(unavailableResponse.status, 502);
    const unavailable = await unavailableResponse.json();
    assert.equal(unavailable.error, "tokenomics_bff_unreachable");
  } finally {
    if (upstream.listening) {
      upstream.close();
      await once(upstream, "close");
    }
    await stopChild(child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
