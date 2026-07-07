const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const shellDir = path.join(rootDir, "shell");
const embeddedLiveDir = path.join(rootDir, "embedded_live");
const fixturePath = process.env.TOKENOMICS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "tokenomics-summary-runtime-governance.json");
const rowFixturePath = process.env.TOKENOMICS_ROWS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_ROWS_FIXTURE_PATH)
  : fs.existsSync(path.join(rootDir, "samples", "o11y_token_metric_rows.json"))
    ? path.join(rootDir, "samples", "o11y_token_metric_rows.json")
    : path.resolve(rootDir, "..", "samples", "o11y_token_metric_rows.json");
const tokenomicsBffUrl = process.env.TOKENOMICS_BFF_URL ? new URL(process.env.TOKENOMICS_BFF_URL) : null;
const host = process.env.HOST || "127.0.0.1";
const appPort = Number(process.env.MFE_PORT || 3001);
const apiPort = Number(process.env.API_PORT || 8787);
const configuredBffTimeoutMs = Number(process.env.TOKENOMICS_BFF_TIMEOUT_MS || 7000);
const tokenomicsBffTimeoutMs = Number.isFinite(configuredBffTimeoutMs)
  ? Math.min(Math.max(configuredBffTimeoutMs, 100), 30000)
  : 7000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "authorization,content-type,x-c3-tenant,x-c3-token-stage",
    "access-control-allow-methods": "GET,OPTIONS,POST",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function safeResolve(baseDir, requestedPath) {
  const cleaned = requestedPath.replace(/^\/+/, "");
  const candidate = path.join(baseDir, path.normalize(cleaned));
  const relative = path.relative(baseDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

function startFixtureApi() {
  http
    .createServer((request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

      try {
        if (request.method === "OPTIONS") {
          writeJson(response, 204, {});
          return;
        }

        if (parsed.pathname === "/healthz") {
          writeJson(response, 200, {
            fixture: path.basename(fixturePath),
            status: "ok",
          });
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/summary") {
          const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
          fixture.debug = {
            ...(fixture.debug || {}),
            fixture_backed: true,
            requested_filters: {
              agent: parsed.searchParams.get("agent") || "*",
              environment: parsed.searchParams.get("environment") || "production",
              service: parsed.searchParams.get("service") || "defenseclaw",
              tenant: request.headers["x-c3-tenant"] || null,
              window: parsed.searchParams.get("window") || "-24h",
            },
          };
          writeJson(response, 200, fixture);
          return;
        }

        if (parsed.pathname === "/v1/c3/agent-tokenomics/usage/rows") {
          writeJson(response, 200, {
            debug: {
              fixture_backed: true,
              requested_filters: {
                window: parsed.searchParams.get("window") || "-24h",
              },
            },
            generated_at: new Date().toISOString(),
            rows: JSON.parse(fs.readFileSync(rowFixturePath, "utf8")),
            source: "fixture_rows",
          });
          return;
        }

        if (
          parsed.pathname === "/v1/c3/agent-tokenomics/alerts" ||
          parsed.pathname === "/v1/c3/agent-tokenomics/policies/effective"
        ) {
          writeJson(response, 200, []);
          return;
        }

        if (
          request.method === "POST" &&
          (parsed.pathname === "/v1/c3/agent-tokenomics/controls/apply" ||
            parsed.pathname === "/v1/c3/agent-tokenomics/controls/release")
        ) {
          writeJson(response, 503, {
            error: "fixture_mode_read_only",
            detail: "Connect TOKENOMICS_BFF_URL to apply DefenseClaw budget controls.",
          });
          return;
        }

        writeJson(response, 404, {
          error: "not_found",
          paths: [
            "/healthz",
            "/v1/c3/agent-tokenomics/summary",
            "/v1/c3/agent-tokenomics/usage/rows",
            "/v1/c3/agent-tokenomics/alerts",
            "/v1/c3/agent-tokenomics/policies/effective",
          ],
        });
      } catch (error) {
        writeJson(response, 500, {
          error: "fixture_read_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })
    .listen(apiPort, host);
}

function startProxyApi() {
  const transport = tokenomicsBffUrl.protocol === "https:" ? https : http;
  http
    .createServer((request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "OPTIONS") {
        writeJson(response, 204, {});
        return;
      }
      if (parsed.pathname !== "/healthz" && !parsed.pathname.startsWith("/v1/c3/agent-tokenomics/")) {
        writeJson(response, 404, {
          error: "not_found",
          paths: ["/healthz", "/v1/c3/agent-tokenomics/*"],
        });
        return;
      }

      const upstream = new URL(`${parsed.pathname}${parsed.search}`, tokenomicsBffUrl);
      const headers = { ...request.headers };
      delete headers.host;
      headers["x-forwarded-host"] = request.headers.host || "";
      headers["x-forwarded-proto"] = "http";

      let upstreamStarted = false;
      const proxyRequest = transport.request(
        upstream,
        {
          method: request.method,
          headers,
        },
        (proxyResponse) => {
          upstreamStarted = true;
          const proxyHeaders = { ...proxyResponse.headers };
          proxyHeaders["access-control-allow-origin"] = "*";
          proxyHeaders["access-control-allow-methods"] = "GET,OPTIONS,POST";
          response.writeHead(proxyResponse.statusCode || 502, proxyHeaders);
          proxyResponse.on("error", (error) => response.destroy(error));
          proxyResponse.pipe(response);
        },
      );

      proxyRequest.on("error", (error) => {
        if (upstreamStarted || response.headersSent) {
          response.destroy(error);
          return;
        }
        const timedOut = error && error.code === "ETIMEDOUT";
        writeJson(response, timedOut ? 504 : 502, {
          error: timedOut ? "tokenomics_bff_timeout" : "tokenomics_bff_unreachable",
          detail: error.message,
          upstream: tokenomicsBffUrl.toString(),
        });
      });
      proxyRequest.setTimeout(tokenomicsBffTimeoutMs, () => {
        const error = new Error(`Tokenomics BFF timed out after ${tokenomicsBffTimeoutMs}ms`);
        error.code = "ETIMEDOUT";
        proxyRequest.destroy(error);
      });

      request.pipe(proxyRequest);
    })
    .listen(apiPort, host);
}

function startStaticApp() {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    console.error(`Missing prebuilt dist at ${distDir}`);
    console.error("This package should include dist/index.html. Ask for a rebuilt handoff zip.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(shellDir, "index.html"))) {
    console.error(`Missing control shell at ${shellDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(embeddedLiveDir, "index.html"))) {
    console.error(`Missing live embedded page at ${embeddedLiveDir}`);
    process.exit(1);
  }

  http
    .createServer((request, response) => {
      const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      const pathname = decodeURIComponent(parsed.pathname || "/");

      if (pathname === "/" || pathname === "/index.html") {
        sendFile(response, path.join(shellDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/shell/")) {
        const filePath = safeResolve(shellDir, pathname.replace(/^\/shell\//, ""));
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        sendFile(response, filePath);
        return;
      }

      if (pathname === "/embedded" || pathname === "/embedded/") {
        sendFile(response, path.join(distDir, "index.html"));
        return;
      }

      if (pathname === "/embedded-live" || pathname === "/embedded-live/") {
        sendFile(response, path.join(embeddedLiveDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/embedded/")) {
        const innerPath = pathname.replace(/^\/embedded\//, "");
        const filePath = safeResolve(distDir, innerPath);
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          sendFile(response, filePath);
          return;
        }
        sendFile(response, path.join(distDir, "index.html"));
        return;
      }

      if (pathname.startsWith("/embedded-live/")) {
        const innerPath = pathname.replace(/^\/embedded-live\//, "");
        const filePath = safeResolve(embeddedLiveDir, innerPath);
        if (!filePath) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          sendFile(response, filePath);
          return;
        }
        sendFile(response, path.join(embeddedLiveDir, "index.html"));
        return;
      }

      const rootAsset = safeResolve(distDir, pathname);
      if (rootAsset && fs.existsSync(rootAsset) && fs.statSync(rootAsset).isFile()) {
        sendFile(response, rootAsset);
        return;
      }

      sendFile(response, path.join(shellDir, "index.html"));
    })
    .listen(appPort, host);
}

if (tokenomicsBffUrl) {
  startProxyApi();
} else {
  startFixtureApi();
}
startStaticApp();

const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
console.log(`Tokenomics API:  http://${displayHost}:${apiPort}/v1/c3/agent-tokenomics/summary`);
console.log(`Control shell:   http://${displayHost}:${appPort}/`);
console.log(`Embedded MFE:    http://${displayHost}:${appPort}/embedded-live/?view=tokenomics`);
console.log("Press Ctrl+C to stop.");
