/**
 * Experimental Claude Code -> local Anthropic-compatible -> Codex app-server
 * gateway boundary.
 *
 * This module intentionally implements a narrow, fail-closed protocol subset.
 * It is not a live proof that Claude Code avoided Anthropic unless a separate
 * process-scoped network test blocks and observes Anthropic destinations.
 */

export type AnthropicRole = "user" | "assistant";

export type AnthropicTextBlock = {
  type: "text";
  text: string;
};

export type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
};

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
};

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: unknown;
};

export type AnthropicMessagesRequest = {
  model: string;
  max_tokens: number;
  system?: string | AnthropicTextBlock[];
  messages: AnthropicMessage[];
  stream?: boolean;
  tools?: AnthropicTool[];
  metadata?: Record<string, unknown>;
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcNotification = {
  jsonrpc?: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type CodexGatewayOptions = {
  cwd: string;
  model?: string;
  threadId?: string;
  requestId?: string | number;
};

export type GatewayRequestBatch = {
  threadId: string | null;
  requests: JsonRpcRequest[];
  unsupported: string[];
};

export type AnthropicSseEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type GatewayState = {
  seenRequestKeys: Set<string>;
  activeTurns: Map<string, { threadId: string }>;
  emittedErrors: Set<string>;
};

export function createGatewayState(): GatewayState {
  return {
    seenRequestKeys: new Set(),
    activeTurns: new Map(),
    emittedErrors: new Set(),
  };
}

export function codexAppServerCommand(): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: "codex",
    args: ["app-server", "--stdio"],
    env: {},
  };
}

export function toCodexRequests(
  request: AnthropicMessagesRequest,
  options: CodexGatewayOptions,
): GatewayRequestBatch {
  validateAnthropicRequest(request);

  const threadId = options.threadId ?? stringMetadata(request, "codex_thread_id");
  const input = flattenMessages(request);
  const system = flattenSystem(request.system);
  const additionalContext = system
    ? {
        "anthropic-system": {
          kind: "application",
          value: system,
        },
      }
    : null;

  const toolInstructions = request.tools?.length
    ? {
        "anthropic-tools": {
          kind: "application",
          value: JSON.stringify({
            boundary: "experimental-dynamic-client-tools-only",
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description ?? "",
              input_schema: tool.input_schema,
            })),
          }),
        },
      }
    : null;

  const params = {
    input,
    cwd: options.cwd,
    model: options.model ?? request.model,
    environments: [],
    additionalContext: mergeNullableRecords(additionalContext, toolInstructions),
  };

  const requestId = options.requestId ?? "turn-1";
  const method = threadId ? "turn/steer" : "turn/start";
  const codexParams = threadId ? { ...params, threadId } : params;

  return {
    threadId,
    requests: [
      {
        jsonrpc: "2.0",
        id: requestId,
        method,
        params: codexParams,
      },
    ],
    unsupported: [],
  };
}

export function toAnthropicStreamEvents(
  notifications: JsonRpcNotification[],
  state: GatewayState = createGatewayState(),
): AnthropicSseEvent[] {
  const events: AnthropicSseEvent[] = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_codex_gateway",
          type: "message",
          role: "assistant",
          content: [],
          model: "codex-app-server",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    },
  ];

  let textOpen = false;
  let contentIndex = 0;

  for (const notification of notifications) {
    const params = notification.params ?? {};
    if (notification.method === "turn/started") {
      const turnId = readTurnId(params);
      const threadId = readString(params, "threadId");
      if (turnId && threadId) {
        state.activeTurns.set(turnId, { threadId });
      }
      continue;
    }

    if (notification.method === "item/agentMessage/delta") {
      if (!textOpen) {
        events.push({
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: contentIndex,
            content_block: { type: "text", text: "" },
          },
        });
        textOpen = true;
      }
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "text_delta", text: readString(params, "delta") ?? "" },
        },
      });
      continue;
    }

    if (notification.method === "item/completed") {
      const toolUse = dynamicToolUseFromItem(params["item"]);
      if (toolUse) {
        if (textOpen) {
          events.push({
            event: "content_block_stop",
            data: { type: "content_block_stop", index: contentIndex },
          });
          contentIndex += 1;
          textOpen = false;
        }
        events.push({
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: contentIndex,
            content_block: toolUse,
          },
        });
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: contentIndex },
        });
        contentIndex += 1;
      }
      continue;
    }

    if (notification.method === "turn/completed") {
      if (textOpen) {
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: contentIndex },
        });
        contentIndex += 1;
        textOpen = false;
      }
      events.push({
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 0 },
        },
      });
      continue;
    }

    if (notification.method === "error") {
      const key = JSON.stringify(params);
      if (!state.emittedErrors.has(key)) {
        state.emittedErrors.add(key);
        events.push({
          event: "error",
          data: {
            type: "error",
            error: {
              type: "api_error",
              message: readString(params, "message") ?? "Codex app-server error",
            },
          },
        });
      }
      continue;
    }

    throw new Error(`Unsupported Codex notification: ${notification.method}`);
  }

  if (textOpen) {
    events.push({
      event: "content_block_stop",
      data: { type: "content_block_stop", index: contentIndex },
    });
  }
  events.push({ event: "message_stop", data: { type: "message_stop" } });
  return events;
}

export function cancellationRequest(
  threadId: string,
  turnId: string,
  id: string | number = "cancel-1",
): JsonRpcRequest {
  if (!threadId || !turnId) {
    throw new Error("Cancellation requires both threadId and turnId");
  }
  return {
    jsonrpc: "2.0",
    id,
    method: "turn/interrupt",
    params: { threadId, turnId },
  };
}

export function shouldForwardWithRetryDedupe(
  state: GatewayState,
  request: JsonRpcRequest,
): boolean {
  const key = JSON.stringify({
    method: request.method,
    params: request.params,
  });
  if (state.seenRequestKeys.has(key)) {
    return false;
  }
  state.seenRequestKeys.add(key);
  return true;
}

export function cleanShutdownRequests(
  activeTurns: Iterable<[string, { threadId: string }]>,
): JsonRpcRequest[] {
  return Array.from(activeTurns, ([turnId, turn], index) =>
    cancellationRequest(turn.threadId, turnId, `shutdown-${index + 1}`),
  );
}

function validateAnthropicRequest(request: AnthropicMessagesRequest): void {
  if (!request.model) {
    throw new Error("Anthropic request missing model");
  }
  if (!Number.isFinite(request.max_tokens) || request.max_tokens <= 0) {
    throw new Error("Anthropic request max_tokens must be positive");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("Anthropic request must include at least one message");
  }
  for (const [index, message] of request.messages.entries()) {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error(`Unsupported Anthropic message role at index ${index}`);
    }
  }
}

function flattenMessages(request: AnthropicMessagesRequest): Record<string, unknown>[] {
  const lines: string[] = [];
  for (const message of request.messages) {
    const text = flattenContent(message.content);
    if (text) {
      lines.push(`${message.role}: ${text}`);
    }
  }
  if (lines.length === 0) {
    throw new Error("Anthropic request has no text or tool-result content to forward");
  }
  return [{ type: "text", text: lines.join("\n\n"), text_elements: [] }];
}

function flattenContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "tool_result") {
        return JSON.stringify({
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          is_error: block.is_error === true,
          content: typeof block.content === "string" ? block.content : flattenContent(block.content),
        });
      }
      if (block.type === "tool_use") {
        return JSON.stringify({
          type: "tool_use_observation",
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
      const unsupported: never = block;
      throw new Error(`Unsupported Anthropic content block: ${JSON.stringify(unsupported)}`);
    })
    .filter(Boolean)
    .join("\n");
}

function flattenSystem(system: AnthropicMessagesRequest["system"]): string | null {
  if (!system) {
    return null;
  }
  if (typeof system === "string") {
    return system;
  }
  return system.map((block) => block.text).join("\n");
}

function stringMetadata(
  request: AnthropicMessagesRequest,
  key: string,
): string | null {
  const value = request.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mergeNullableRecords(
  first: Record<string, unknown> | null,
  second: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!first && !second) {
    return null;
  }
  return { ...(first ?? {}), ...(second ?? {}) };
}

function readString(
  params: Record<string, unknown>,
  key: string,
): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function readTurnId(params: Record<string, unknown>): string | null {
  const turn = params["turn"];
  if (turn && typeof turn === "object" && "id" in turn) {
    const id = (turn as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return readString(params, "turnId");
}

function dynamicToolUseFromItem(item: unknown): AnthropicToolUseBlock | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  const type = record["type"];
  if (type !== "dynamic_tool_call" && type !== "mcp_tool_call") {
    return null;
  }
  const id = typeof record["id"] === "string" ? record["id"] : "toolu_codex";
  const name =
    typeof record["toolName"] === "string"
      ? record["toolName"]
      : typeof record["name"] === "string"
        ? record["name"]
        : typeof record["tool"] === "string"
          ? record["tool"]
          : "codex_tool";
  return {
    type: "tool_use",
    id,
    name,
    input: record["input"] ?? record["arguments"] ?? {},
  };
}
