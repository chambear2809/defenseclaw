/**
 * Copyright 2026 Cisco Systems, Inc. and its affiliates
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import http from "node:http";
import {
  buildBridgeITChatUrl,
  buildBridgeITRagHeaders,
  loadBridgeITRagConfigFromEnv,
  resolveBridgeITAccessToken,
  type BridgeITChatMessage,
} from "./bridgeit-rag.js";

type OpenAIChatRequest = {
  model?: string;
  messages?: BridgeITChatMessage[];
  stream?: boolean;
  user?: unknown;
  stop?: unknown;
  [key: string]: unknown;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readJson(req: http.IncomingMessage, limitBytes = 2 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function configuredProxyToken(): string | undefined {
  return env("BRIDGEIT_PROXY_API_KEY");
}

function bearerToken(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice(7).trim() : trimmed;
}

function authorize(req: http.IncomingMessage): boolean {
  const expected = configuredProxyToken();
  if (!expected) return true;
  const got = bearerToken(req.headers.authorization);
  return got === expected;
}

function normalizeModel(model: unknown, fallback: string): string {
  if (typeof model !== "string" || !model.trim()) return fallback;
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function handleModels(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!authorize(req)) {
    writeJson(res, 401, { error: { message: "unauthorized", type: "invalid_request_error" } });
    return;
  }

  const cfg = loadBridgeITRagConfigFromEnv();
  const model = cfg.modelName;
  writeJson(res, 200, {
    object: "list",
    data: [
      {
        id: model,
        object: "model",
        created: 0,
        owned_by: "bridgeit",
      },
    ],
  });
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!authorize(req)) {
    writeJson(res, 401, { error: { message: "unauthorized", type: "invalid_request_error" } });
    return;
  }

  const cfg = loadBridgeITRagConfigFromEnv();
  if (!cfg.appKey) {
    writeJson(res, 500, { error: { message: "BRIDGEIT_APP_KEY is required" } });
    return;
  }

  const incoming = (await readJson(req)) as OpenAIChatRequest;
  if (!Array.isArray(incoming.messages)) {
    writeJson(res, 400, { error: { message: "messages is required" } });
    return;
  }

  const model = normalizeModel(incoming.model, cfg.modelName);
  const accessToken = await resolveBridgeITAccessToken(cfg);
  const payload: OpenAIChatRequest = {
    ...incoming,
    model: undefined,
    user: JSON.stringify({ appkey: cfg.appKey }),
  };
  if (payload.stop === undefined) {
    payload.stop = ["<|im_end|>"];
  }

  const upstream = await fetch(buildBridgeITChatUrl(cfg, model), {
    method: "POST",
    headers: buildBridgeITRagHeaders(cfg, accessToken),
    body: JSON.stringify(payload),
  });

  res.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  res.setHeader("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);

  if (incoming.stream && upstream.body) {
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
    return;
  }

  const text = await upstream.text();
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

const host = env("BRIDGEIT_OPENAI_PROXY_HOST") ?? "127.0.0.1";
const port = Number.parseInt(env("BRIDGEIT_OPENAI_PROXY_PORT") ?? "8787", 10);

const server = http.createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/healthz") {
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      handleModels(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      await handleChat(req, res);
      return;
    }
    writeJson(res, 404, { error: { message: "not found" } });
  })().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    writeJson(res, 502, { error: { message } });
  });
});

server.listen(port, host, () => {
  console.error(`[bridgeit] OpenAI-compatible proxy listening on http://${host}:${port}/v1`);
});
