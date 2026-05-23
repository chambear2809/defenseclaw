/**
 * Copyright 2026 Cisco Systems, Inc. and its affiliates
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export type BridgeITChatMessage = {
  role: "system" | "user" | "assistant" | "tool" | string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
};

export type BridgeITRagConfig = {
  chatBaseUrl: string;
  chatUrl?: string;
  appKey?: string;
  accessToken?: string;
  oauthTokenUrl?: string;
  oauthScope?: string;
  clientId?: string;
  clientSecret?: string;
  modelName: string;
  apiKeyHeader: string;
  timeoutMs: number;
  staticPayload?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
};

export type BridgeITRagSearchArgs = {
  query: string;
  model?: string;
  systemPrompt?: string;
  messages?: BridgeITChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
};

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const DEFAULT_CHAT_BASE_URL = "https://chat-ai.cisco.com";
const DEFAULT_OAUTH_TOKEN_URL = "https://id.cisco.com/oauth2/default/v1/token";
const DEFAULT_MODEL_NAME = "gpt-5-nano";
const TOKEN_CACHE_SKEW_MS = 60_000;

const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function loadBridgeITRagConfigFromEnv(): BridgeITRagConfig {
  return {
    chatBaseUrl: env("BRIDGEIT_CHAT_BASE_URL") ?? DEFAULT_CHAT_BASE_URL,
    chatUrl: env("BRIDGEIT_CHAT_URL"),
    appKey: env("BRIDGEIT_APP_KEY"),
    accessToken: env("BRIDGEIT_ACCESS_TOKEN"),
    oauthTokenUrl: env("BRIDGEIT_OAUTH_TOKEN_URL") ?? DEFAULT_OAUTH_TOKEN_URL,
    oauthScope: env("BRIDGEIT_OAUTH_SCOPE"),
    clientId: env("BRIDGEIT_CLIENT_ID"),
    clientSecret: env("BRIDGEIT_CLIENT_SECRET"),
    modelName: env("BRIDGEIT_MODEL") ?? DEFAULT_MODEL_NAME,
    apiKeyHeader: env("BRIDGEIT_API_KEY_HEADER") ?? "api-key",
    timeoutMs: parsePositiveInt(env("BRIDGEIT_RAG_TIMEOUT_MS"), 60000),
    staticPayload: parseJsonObject(env("BRIDGEIT_CHAT_STATIC_JSON")),
    extraHeaders: parseJsonObject(env("BRIDGEIT_CHAT_EXTRA_HEADERS_JSON")) as
      | Record<string, string>
      | undefined,
  };
}

function tokenCacheKey(cfg: BridgeITRagConfig): string {
  return [cfg.oauthTokenUrl ?? "", cfg.clientId ?? "", cfg.oauthScope ?? ""].join("\n");
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

export async function resolveBridgeITAccessToken(
  cfg: BridgeITRagConfig,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<string> {
  if (cfg.accessToken) return cfg.accessToken;
  if (!cfg.oauthTokenUrl || !cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "BridgeIT credentials are required: set BRIDGEIT_ACCESS_TOKEN or BRIDGEIT_CLIENT_ID + BRIDGEIT_CLIENT_SECRET",
    );
  }

  const cacheKey = tokenCacheKey(cfg);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - Date.now() > TOKEN_CACHE_SKEW_MS) {
    return cached.token;
  }

  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (cfg.oauthScope) form.set("scope", cfg.oauthScope);
  const res = await fetchImpl(cfg.oauthTokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(cfg.clientId, cfg.clientSecret),
    },
    body: form.toString(),
  });
  const body = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  if (!res.ok) {
    const detail =
      typeof parsed === "string" ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400);
    throw new Error(`BridgeIT OAuth HTTP ${res.status}: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BridgeIT OAuth response was not an object");
  }

  const data = parsed as Record<string, unknown>;
  const token = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!token) throw new Error("BridgeIT OAuth response missing access_token");
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 300;
  tokenCache.set(cacheKey, {
    token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  });
  return token;
}

export function buildBridgeITChatUrl(cfg: BridgeITRagConfig, model?: string): string {
  if (cfg.chatUrl) return cfg.chatUrl;
  const base = cfg.chatBaseUrl.replace(/\/+$/, "");
  const deployment = encodeURIComponent((model ?? cfg.modelName).trim());
  return `${base}/openai/deployments/${deployment}/chat/completions`;
}

export function buildBridgeITRagHeaders(
  cfg: BridgeITRagConfig,
  accessToken = cfg.accessToken,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(cfg.extraHeaders ?? {}),
  };

  if (accessToken) {
    headers[cfg.apiKeyHeader] = accessToken;
  }

  return headers;
}

function defaultMessages(args: BridgeITRagSearchArgs): BridgeITChatMessage[] {
  const messages: BridgeITChatMessage[] = [];
  if (args.systemPrompt?.trim()) {
    messages.push({ role: "system", content: args.systemPrompt.trim() });
  }
  messages.push({ role: "user", content: args.query });
  return messages;
}

export function buildBridgeITRagPayload(
  cfg: BridgeITRagConfig,
  args: BridgeITRagSearchArgs,
): Record<string, unknown> {
  if (!cfg.appKey) {
    throw new Error("BRIDGEIT_APP_KEY is required");
  }

  const payload: Record<string, unknown> = {
    ...(cfg.staticPayload ?? {}),
    messages: args.messages && args.messages.length > 0 ? args.messages : defaultMessages(args),
    user: JSON.stringify({ appkey: cfg.appKey }),
  };

  if (!("stop" in payload)) {
    payload.stop = args.stop && args.stop.length > 0 ? args.stop : ["<|im_end|>"];
  }
  if (typeof args.temperature === "number") payload.temperature = args.temperature;
  if (typeof args.maxTokens === "number") payload.max_tokens = args.maxTokens;
  if (typeof args.topP === "number") payload.top_p = args.topP;

  return payload;
}

function parseResponse(body: string, contentType: string | null): unknown {
  if (contentType?.includes("application/json")) {
    return JSON.parse(body);
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function extractBridgeITAssistantText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const root = result as Record<string, unknown>;
  const choices = root.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
  }
  const data = root.data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;
  return undefined;
}

export async function searchBridgeITRag(
  cfg: BridgeITRagConfig,
  args: BridgeITRagSearchArgs,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<unknown> {
  if (!args.query.trim() && (!args.messages || args.messages.length === 0)) {
    throw new Error("query or messages is required");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const accessToken = await resolveBridgeITAccessToken(cfg, fetchImpl);
    const res = await fetchImpl(buildBridgeITChatUrl(cfg, args.model), {
      method: "POST",
      headers: buildBridgeITRagHeaders(cfg, accessToken),
      body: JSON.stringify(buildBridgeITRagPayload(cfg, args)),
      signal: controller.signal,
    });
    const body = await res.text();
    const parsed = parseResponse(body, res.headers.get("content-type"));
    if (!res.ok) {
      const detail =
        typeof parsed === "string" ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400);
      throw new Error(`BridgeIT chat HTTP ${res.status}: ${detail}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
