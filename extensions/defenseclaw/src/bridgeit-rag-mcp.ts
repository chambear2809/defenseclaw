/**
 * Copyright 2026 Cisco Systems, Inc. and its affiliates
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { stdin, stdout } from "node:process";
import {
  extractBridgeITAssistantText,
  loadBridgeITRagConfigFromEnv,
  searchBridgeITRag,
  type BridgeITRagSearchArgs,
} from "./bridgeit-rag.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const TOOL_NAME = "bridgeit_chat_completion";
const LEGACY_TOOL_NAME = "bridgeit_rag_search";

const tool = {
  name: TOOL_NAME,
  description: "Send a prompt to Cisco BridgeIT and return the final assistant response.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "User prompt to send to BridgeIT.",
      },
      model: {
        type: "string",
        description: "Optional BridgeIT deployment/model override.",
      },
      systemPrompt: {
        type: "string",
        description: "Optional system message to prepend.",
      },
    },
    required: ["query"],
  },
};

const legacyTool = {
  ...tool,
  name: LEGACY_TOOL_NAME,
  description: "Compatibility alias for bridgeit_chat_completion.",
};

function writeMessage(message: JsonRpcResponse | Record<string, unknown>): void {
  const body = JSON.stringify(message);
  stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function response(
  id: string | number | null | undefined,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function errorResponse(
  id: string | number | null | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function parseSearchArgs(params: unknown): BridgeITRagSearchArgs {
  const input =
    params && typeof params === "object" && "arguments" in params
      ? (params as { arguments?: unknown }).arguments
      : params;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool arguments must be an object");
  }
  const raw = input as Record<string, unknown>;
  const query = raw.query;
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("query is required");
  }
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  const systemPrompt =
    typeof raw.systemPrompt === "string" && raw.systemPrompt.trim()
      ? raw.systemPrompt.trim()
      : undefined;
  return { query, model, systemPrompt };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (!req.id && req.method?.startsWith("notifications/")) return;

  try {
    switch (req.method) {
      case "initialize":
        writeMessage(
          response(req.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "defenseclaw-bridgeit-rag", version: "0.1.0" },
          }),
        );
        return;
      case "tools/list":
        writeMessage(response(req.id, { tools: [tool, legacyTool] }));
        return;
      case "tools/call": {
        const params = req.params as { name?: string } | undefined;
        if (params?.name !== TOOL_NAME && params?.name !== LEGACY_TOOL_NAME) {
          writeMessage(errorResponse(req.id, -32602, `unknown tool: ${params?.name ?? ""}`));
          return;
        }
        const result = await searchBridgeITRag(
          loadBridgeITRagConfigFromEnv(),
          parseSearchArgs(req.params),
        );
        writeMessage(
          response(req.id, {
            content: [
              {
                type: "text",
                text: extractBridgeITAssistantText(result) ?? JSON.stringify(result, null, 2),
              },
            ],
          }),
        );
        return;
      }
      default:
        writeMessage(errorResponse(req.id, -32601, `method not found: ${req.method ?? ""}`));
    }
  } catch (err) {
    writeMessage(
      response(req.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      }),
    );
  }
}

let buffer = Buffer.alloc(0);

function drainBuffer(): void {
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) return;

    const body = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    void handleRequest(JSON.parse(body) as JsonRpcRequest);
  }
}

stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
});

stdin.resume();
