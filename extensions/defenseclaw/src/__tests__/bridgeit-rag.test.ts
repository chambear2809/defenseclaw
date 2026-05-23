/**
 * Copyright 2026 Cisco Systems, Inc. and its affiliates
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  buildBridgeITChatUrl,
  buildBridgeITRagHeaders,
  buildBridgeITRagPayload,
  extractBridgeITAssistantText,
  resolveBridgeITAccessToken,
  searchBridgeITRag,
  type BridgeITRagConfig,
  type FetchLike,
} from "../bridgeit-rag.js";

const baseConfig: BridgeITRagConfig = {
  chatBaseUrl: "https://chat-ai.example.test",
  appKey: "app-key",
  accessToken: "access-token",
  modelName: "gpt-5-nano",
  apiKeyHeader: "api-key",
  timeoutMs: 1000,
};

describe("BridgeIT chat client", () => {
  it("builds BridgeIT direct chat URL", () => {
    expect(buildBridgeITChatUrl(baseConfig)).toBe(
      "https://chat-ai.example.test/openai/deployments/gpt-5-nano/chat/completions",
    );
    expect(buildBridgeITChatUrl(baseConfig, "gemini-3.1-flash-lite")).toBe(
      "https://chat-ai.example.test/openai/deployments/gemini-3.1-flash-lite/chat/completions",
    );
  });

  it("builds api-key headers for chat-ai", () => {
    const headers = buildBridgeITRagHeaders(
      {
        ...baseConfig,
        apiKeyHeader: "api-key",
        extraHeaders: { "x-extra": "1" },
      },
      "minted-token",
    );

    expect(headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": "minted-token",
      "x-extra": "1",
    });
  });

  it("builds BridgeIT chat payload with required appkey user field", () => {
    expect(
      buildBridgeITRagPayload(baseConfig, {
        query: "defenseclaw",
        systemPrompt: "Be concise.",
        temperature: 0.2,
      }),
    ).toEqual({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "defenseclaw" },
      ],
      user: JSON.stringify({ appkey: "app-key" }),
      stop: ["<|im_end|>"],
      temperature: 0.2,
    });
  });

  it("posts a BridgeIT chat request", async () => {
    let requestUrl = "";
    let requestBody = "";
    let requestHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      requestUrl = url;
      requestBody = init?.body ?? "";
      requestHeaders = init?.headers ?? {};
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      };
    };

    const result = await searchBridgeITRag(
      baseConfig,
      { query: "openclaw research", model: "gpt-5-nano" },
      fetchImpl,
    );

    expect(extractBridgeITAssistantText(result)).toBe("ok");
    expect(requestUrl).toBe(
      "https://chat-ai.example.test/openai/deployments/gpt-5-nano/chat/completions",
    );
    expect(JSON.parse(requestBody)).toMatchObject({
      messages: [{ role: "user", content: "openclaw research" }],
      user: JSON.stringify({ appkey: "app-key" }),
    });
    expect(requestHeaders["api-key"]).toBe("access-token");
  });

  it("mints an access token from client credentials when no token is set", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push(url);
      if (url.endsWith("/token")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers?.Authorization).toBe(
          `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
        );
        expect(init?.body).toBe("grant_type=client_credentials");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "application/json" },
          text: async () =>
            JSON.stringify({ access_token: "minted-token", expires_in: 3600 }),
        };
      }
      expect(init?.headers?.["api-key"]).toBe("minted-token");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ choices: [] }),
      };
    };

    const result = await searchBridgeITRag(
      {
        ...baseConfig,
        accessToken: undefined,
        oauthTokenUrl: "https://id.example.test/token",
        clientId: "client-id",
        clientSecret: "client-secret",
      },
      { query: "openclaw" },
      fetchImpl,
    );

    expect(result).toEqual({ choices: [] });
    expect(calls).toEqual([
      "https://id.example.test/token",
      "https://chat-ai.example.test/openai/deployments/gpt-5-nano/chat/completions",
    ]);
  });

  it("returns a direct access token without calling OAuth", async () => {
    const token = await resolveBridgeITAccessToken(baseConfig, async () => {
      throw new Error("unexpected fetch");
    });
    expect(token).toBe("access-token");
  });

  it("returns useful HTTP error detail", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ fault: { faultstring: "bad api-key" } }),
    });

    await expect(
      searchBridgeITRag(baseConfig, { query: "x" }, fetchImpl),
    ).rejects.toThrow("BridgeIT chat HTTP 401");
  });
});
