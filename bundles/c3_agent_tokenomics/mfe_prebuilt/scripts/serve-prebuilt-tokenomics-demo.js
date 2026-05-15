const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const fixturePath = process.env.TOKENOMICS_FIXTURE_PATH
  ? path.resolve(process.env.TOKENOMICS_FIXTURE_PATH)
  : path.join(rootDir, "fixtures", "tokenomics-summary-runtime-governance.json");
const host = process.env.HOST || "127.0.0.1";
const appPort = Number(process.env.MFE_PORT || 3001);
const apiPort = Number(process.env.API_PORT || 8787);

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
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function startFixtureApi() {
  http.createServer((request, response) => {
    const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

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

    writeJson(response, 404, {
      error: "not_found",
      paths: ["/healthz", "/v1/c3/agent-tokenomics/summary"],
    });
  }).listen(apiPort, host);
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

function startStaticApp() {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    console.error(`Missing prebuilt dist at ${distDir}`);
    console.error("This package should include dist/index.html. Ask for a rebuilt handoff zip.");
    process.exit(1);
  }

  http.createServer((request, response) => {
    const parsed = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(parsed.pathname || "/");
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const candidate = path.join(distDir, safePath === "/" ? "index.html" : safePath);
    const relative = path.relative(distDir, candidate);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      sendFile(response, candidate);
      return;
    }

    sendFile(response, path.join(distDir, "index.html"));
  }).listen(appPort, host);
}

startFixtureApi();
startStaticApp();

const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
console.log(`Tokenomics fixture API: http://${displayHost}:${apiPort}/v1/c3/agent-tokenomics/summary`);
console.log(`Prebuilt MFE:          http://${displayHost}:${appPort}/?view=tokenomics`);
console.log("Press Ctrl+C to stop.");
