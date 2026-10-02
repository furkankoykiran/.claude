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

export type CodexTurnToolOutput = {
  name: string;
  namespace: string | null;
  output: string | AnthropicTextBlock[];
};

export type JsonRpcNotification = {
  jsonrpc?: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type CodexGatewayOptions = {
  cwd: string;
  model?: string;
  reasoningEffort?: string;
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

export type AnthropicMessagesResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicTextBlock[];
  stop_reason: "end_turn";
  usage: { input_tokens: number; output_tokens: number };
};

export type GatewayState = {
  seenRequestKeys: Set<string>;
  activeTurns: Map<string, { threadId: string }>;
  emittedErrors: Set<string>;
  emittedToolUseIds: Set<string>;
  toolNameAliases: Map<string, string>;
};


export type CodexModelCatalogEntry = Record<string, unknown> & {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  hidden?: unknown;
};

export type CodexModelListResult = {
  data?: CodexModelCatalogEntry[];
  nextCursor?: string | null;
};

export function toAnthropicModelsList(result: CodexModelListResult): Record<string, unknown> {
  const data = Array.isArray(result.data) ? result.data : [];
  return {
    object: "list",
    data: data
      .filter((model) => model.hidden !== true)
      .map((model) => {
        const id = typeof model.id === "string"
          ? model.id
          : typeof model.model === "string"
            ? model.model
            : "unknown-codex-model";
        return {
          id,
          object: "model",
          display_name: typeof model.displayName === "string" ? model.displayName : id,
          metadata: {
            codex_model: typeof model.model === "string" ? model.model : id,
            description: typeof model.description === "string" ? model.description : null,
            default_reasoning_effort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
            supported_reasoning_efforts: Array.isArray(model.supportedReasoningEfforts)
              ? model.supportedReasoningEfforts
              : [],
            input_modalities: Array.isArray(model.inputModalities) ? model.inputModalities : [],
            service_tiers: Array.isArray(model.serviceTiers) ? model.serviceTiers : [],
            default_service_tier: typeof model.defaultServiceTier === "string" ? model.defaultServiceTier : null,
            upgrade: typeof model.upgrade === "string" ? model.upgrade : null,
            upgrade_info: model.upgradeInfo ?? null,
            is_default: model.isDefault === true,
          },
        };
      }),
  };
}


export function createGatewayState(): GatewayState {
  return {
    seenRequestKeys: new Set(),
    activeTurns: new Map(),
    emittedErrors: new Set(),
    emittedToolUseIds: new Set(),
    toolNameAliases: new Map(),
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
  toolAliasesByOriginal: Map<string, string> = new Map(),
): GatewayRequestBatch {
  validateAnthropicRequest(request);

  const existingThreadId = options.threadId ?? stringMetadata(request, "codex_thread_id");
  const toolOutput = toolOutputFromMessages(request.messages, toolAliasesByOriginal);
  const input = toolOutput ? [] : flattenMessages(request);
  const system = flattenSystem(request.system);
  const additionalContext = system
    ? {
        "anthropic-system": {
          kind: "application",
          value: system,
        },
      }
    : null;

  const params: Record<string, unknown> = {
    input,
    cwd: options.cwd,
    model: resolveCodexModel(request.model, options.model),
    additionalContext,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  };
  if (toolOutput) {
    params["toolOutput"] = toolOutput;
  }
  if (options.reasoningEffort) {
    params["effort"] = options.reasoningEffort;
  }

  const requestId = options.requestId ?? "turn-1";
  const threadId = existingThreadId ?? `urn:uuid:${crypto.randomUUID()}`;
  const method = "turn/start";
  const codexParams = { ...params, threadId };

  return {
    threadId: existingThreadId,
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

export function shouldStreamAnthropicResponse(request: Pick<AnthropicMessagesRequest, "stream">): boolean {
  return request.stream === true;
}

export function codexThreadStartParams(
  cwd: string,
  model: string | undefined,
  requestModel: string,
  tools: AnthropicTool[] = [],
  messages: AnthropicMessage[] = [],
  aliases: Map<string, string> = new Map(),
  reverseAliases: Map<string, string> = new Map(),
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    cwd,
    model: resolveCodexModel(requestModel, model),
    ephemeral: true,
    threadSource: "fk-toolkit-codex-gateway",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "read-only",
  };
  if (tools.length > 0) {
    const exposedTools = codexDynamicToolsForTurn(tools, messages);
    const dynamicTools = exposedTools.map((tool, index) => {
      const name = codexDynamicToolName(tool.name, index);
      if (name !== tool.name) {
        aliases.set(name, tool.name);
      }
      reverseAliases.set(tool.name, name);
      const inputSchema = codexDynamicToolInputSchema(tool.name, tool.input_schema);
      return {
        type: "function",
        name,
        description: codexDynamicToolDescription(tool, inputSchema),
        inputSchema,
      };
    });
    traceDynamicTools(dynamicTools);
    params["dynamicTools"] = dynamicTools;
  }
  return params;
}

export function codexDynamicToolsForTurn(tools: AnthropicTool[], messages: AnthropicMessage[]): AnthropicTool[] {
  const turnText = flattenMessagesText(messages).toLowerCase();
  const mentioned = tools.filter((tool) => turnText.includes(tool.name.toLowerCase()));
  if (mentioned.length > 0) {
    return mentioned;
  }
  const supportedCore = new Set(["Bash", "Read", "Edit", "Write", "Task"]);
  return tools.filter((tool) => supportedCore.has(tool.name) || tool.name.startsWith("mcp__"));
}

export function codexDynamicToolName(name: string, index: number): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !name.startsWith("mcp__")) {
    return name;
  }
  const readable = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
  return `claude_tool_${index}_${readable || "tool"}`;
}

function flattenMessagesText(messages: AnthropicMessage[]): string {
  return messages.map((message) => flattenContent(message.content)).join("\n");
}

export function codexDynamicToolInputSchema(toolName: string, inputSchema: unknown): unknown {
  const claudeToolSchema = claudeCodeToolInputSchema(toolName);
  if (claudeToolSchema) {
    return claudeToolSchema;
  }
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }
  const schema = structuredClone(inputSchema) as Record<string, unknown>;
  if (schema["type"] === undefined && (schema["properties"] || schema["required"])) {
    schema["type"] = "object";
  }
  if (schema["type"] === "object") {
    if (!schema["properties"] || typeof schema["properties"] !== "object" || Array.isArray(schema["properties"])) {
      schema["properties"] = {};
    }
    if (!Array.isArray(schema["required"])) {
      schema["required"] = [];
    }
    if (schema["additionalProperties"] === undefined) {
      schema["additionalProperties"] = false;
    }
  }
  return schema;
}

function claudeCodeToolInputSchema(toolName: string): Record<string, unknown> | null {
  if (toolName === "Bash") {
    return {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command for Claude Code to run.",
        },
        description: {
          type: "string",
          description: "Short description of what the command does.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    };
  }
  if (toolName === "Read") {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path for Claude Code to read.",
        },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["file_path"],
      additionalProperties: false,
    };
  }
  if (toolName === "Write") {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path for Claude Code to write.",
        },
        content: {
          type: "string",
          description: "Complete file contents to write.",
        },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    };
  }
  if (toolName === "Edit") {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path for Claude Code to edit.",
        },
        old_string: {
          type: "string",
          description: "Exact text to replace.",
        },
        new_string: {
          type: "string",
          description: "Replacement text.",
        },
        replace_all: { type: "boolean" },
      },
      required: ["file_path", "old_string", "new_string"],
      additionalProperties: false,
    };
  }
  return null;
}

function codexDynamicToolDescription(tool: AnthropicTool, inputSchema: unknown): string {
  const base = tool.description?.trim() ?? "";
  const schema = JSON.stringify(inputSchema);
  const contract = `Call this Claude Code client tool with JSON arguments matching this schema: ${schema}`;
  return base ? `${base}\n\n${contract}` : contract;
}

function traceDynamicTools(dynamicTools: unknown): void {
  if (process.env.CODEX_GATEWAY_TRACE_TOOLS !== "1") {
    return;
  }
  console.error(JSON.stringify({
    event: "codex-gateway.dynamicTools",
    dynamicTools,
  }));
}

export function resolveCodexModel(requestModel: string, selectedModel?: string): string {
  if (!requestModel.startsWith("claude-")) {
    return requestModel;
  }
  if (selectedModel && selectedModel.length > 0) {
    return selectedModel;
  }
  const envModel = process.env.CODEX_GATEWAY_MODEL || process.env.CODEX_MODEL;
  if (envModel) {
    return envModel;
  }
  throw new Error(
    "Claude model aliases cannot be forwarded to Codex directly; set CODEX_GATEWAY_MODEL to a Codex model id",
  );
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
    if (isIgnorableCodexNotification(notification.method)) {
      continue;
    }

    if (notification.method === "turn/started") {
      const turnId = readTurnId(params);
      const threadId = readString(params, "threadId");
      if (turnId && threadId) {
        state.activeTurns.set(turnId, { threadId });
      }
      continue;
    }

    if (notification.method === "item/agentMessage/delta" || notification.method === "item/commandExecution/outputDelta") {
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

    if (notification.method === "item/tool/call") {
      const toolUse = dynamicToolUseFromToolCallParams(params, state.toolNameAliases);
      if (toolUse && !state.emittedToolUseIds.has(toolUse.id)) {
        state.emittedToolUseIds.add(toolUse.id);
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

    if (notification.method === "item/completed") {
      const toolUse = dynamicToolUseFromItem(params["item"], state.toolNameAliases);
      if (toolUse) {
        if (state.emittedToolUseIds.has(toolUse.id)) {
          continue;
        }
        state.emittedToolUseIds.add(toolUse.id);
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

    if (notification.method === "turn/completed" || notification.method === "turn/failed" || notification.method === "turn/interrupted") {
      if (textOpen) {
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: contentIndex },
        });
        contentIndex += 1;
        textOpen = false;
      }
      const terminalError = terminalTurnError(notification.method, params);
      if (terminalError) {
        events.push({
          event: "error",
          data: {
            type: "error",
            error: {
              type: "api_error",
              message: terminalError,
            },
          },
        });
        continue;
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

export function nonStreamingAnthropicResponseFromEvents(
  request: AnthropicMessagesRequest,
  events: AnthropicSseEvent[],
  selectedModel?: string,
): AnthropicMessagesResponse {
  const error = events.find((event) => event.event === "error");
  if (error) {
    throw new Error(errorMessageFromEvent(error));
  }
  const text = events
    .filter((event) => event.event === "content_block_delta")
    .map((event) => {
      const delta = event.data["delta"] as { text?: string } | undefined;
      return delta?.text ?? "";
    })
    .join("");
  return {
    id: "msg_codex_gateway",
    type: "message",
    role: "assistant",
    model: resolveCodexModel(request.model, selectedModel),
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function toolOutputFromMessages(
  messages: AnthropicMessage[],
  toolAliasesByOriginal: Map<string, string> = new Map(),
): CodexTurnToolOutput | null {
  const toolNames = new Map<string, string>();
  let latest: CodexTurnToolOutput | null = null;
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const block of message.content) {
      if (block.type === "tool_use") {
        toolNames.set(block.id, block.name);
        continue;
      }
      if (block.type === "tool_result") {
        const name = toolNames.get(block.tool_use_id);
        if (name) {
          latest = {
            name: toolAliasesByOriginal.get(name) ?? name,
            namespace: null,
            output: typeof block.content === "string" ? block.content : flattenContent(block.content),
          };
        }
      }
    }
  }
  return latest;
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

function isIgnorableCodexNotification(method: string): boolean {
  return method === "thread/started"
    || method === "thread/status/changed"
    || method === "thread/name/updated"
    || method === "thread/tokenUsage/updated"
    || method === "thread/settings/updated"
    || method === "thread/queue/changed"
    || method === "hook/started"
    || method === "hook/completed"
    || method === "item/started"
    || method === "item/commandExecution/terminalInteraction"
    || method === "rawResponseItem/completed"
    || method === "rawResponse/completed"
    || method === "turn/diff/updated"
    || method === "turn/plan/updated"
    || method === "turn/moderationMetadata"
    || method === "model/verification"
    || method === "model/rerouted"
    || method === "model/safetyBuffering/updated"
    || method === "mcpServer/startupStatus/updated"
    || method === "account/updated"
    || method === "account/rateLimits/updated"
    || method === "configWarning"
    || method === "warning"
    || method === "deprecationNotice";
}

function terminalTurnError(method: string, params: Record<string, unknown>): string | null {
  if (method === "turn/failed") {
    return turnErrorMessage(params, "Codex turn failed");
  }
  if (method === "turn/interrupted") {
    return turnErrorMessage(params, "Codex turn interrupted");
  }
  const turn = params["turn"];
  if (turn && typeof turn === "object") {
    const record = turn as Record<string, unknown>;
    const status = record["status"];
    if (status === "failed") {
      return turnErrorMessage(params, "Codex turn failed");
    }
    if (status === "interrupted") {
      return turnErrorMessage(params, "Codex turn interrupted");
    }
  }
  return null;
}

function turnErrorMessage(params: Record<string, unknown>, fallback: string): string {
  const direct = readString(params, "message");
  if (direct) return direct;
  const error = params["error"];
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  const turn = params["turn"];
  if (turn && typeof turn === "object") {
    const error = (turn as Record<string, unknown>)["error"];
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  return fallback;
}

function errorMessageFromEvent(event: AnthropicSseEvent): string {
  const error = event.data["error"];
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Codex app-server error";
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

function dynamicToolUseFromItem(item: unknown, aliases: Map<string, string> = new Map()): AnthropicToolUseBlock | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  const type = record["type"];
  if (type !== "dynamic_tool_call" && type !== "mcp_tool_call" && type !== "dynamicToolCall" && type !== "mcpToolCall") {
    return null;
  }
  const id = typeof record["id"] === "string" ? record["id"] : "toolu_codex";
  const rawName =
    typeof record["toolName"] === "string"
      ? record["toolName"]
      : typeof record["tool"] === "string"
        ? record["tool"]
      : typeof record["name"] === "string"
        ? record["name"]
        : typeof record["tool"] === "string"
          ? record["tool"]
          : "codex_tool";
  const name = aliases.get(rawName) ?? rawName;
  return {
    type: "tool_use",
    id,
    name,
    input: dynamicToolInput(record),
  };
}

function dynamicToolUseFromToolCallParams(params: Record<string, unknown>, aliases: Map<string, string> = new Map()): AnthropicToolUseBlock | null {
  const id = readString(params, "callId");
  const rawName = readString(params, "tool");
  if (!id || !rawName) {
    return null;
  }
  return {
    type: "tool_use",
    id,
    name: aliases.get(rawName) ?? rawName,
    input: params["arguments"] ?? {},
  };
}

function dynamicToolInput(record: Record<string, unknown>): unknown {
  const value = record["arguments"] ?? record["input"];
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return { arguments: value };
    }
  }
  return value ?? {};
}

type CodexProcess = {
  stdin: { write(chunk: Uint8Array): unknown | Promise<unknown> };
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  kill: () => void;
};

type PendingTurn = {
  resolve: (events: AnthropicSseEvent[]) => void;
  reject: (error: Error) => void;
  state: GatewayState;
  notifications: JsonRpcNotification[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function failClosedClientRequestResult(method: string): Record<string, unknown> | null {
  if (method === "item/commandExecution/requestApproval") {
    return { decision: "decline" };
  }
  if (method === "item/fileChange/requestApproval") {
    return { decision: "decline" };
  }
  if (method === "execCommandApproval") {
    return { decision: { denied: { rejection: "Codex gateway keeps Claude Code as the tool-permission owner." } } };
  }
  if (method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn", strictAutoReview: true };
  }
  if (method === "item/tool/call") {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Codex gateway does not execute Codex-side dynamic tools; Claude Code owns client tools.",
        },
      ],
    };
  }
  return null;
}

class CodexJsonRpcClient {
  private seq = 0;
  private initialized = false;
  private readonly rpcPending = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly pending = new Map<string | number, PendingTurn>();
  private readonly activeByTurn = new Map<string, { threadId: string; pending: PendingTurn }>();
  private readonly toolAliasesByOriginal = new Map<string, string>();

  constructor(private readonly proc: CodexProcess) {
    this.readLoop().catch((error) => this.rejectAll(error));
    this.stderrLoop().catch(() => undefined);
  }

  async turn(request: AnthropicMessagesRequest, cwd: string): Promise<AnthropicSseEvent[]> {
    await this.initialize();
    const id = `anthropic-${++this.seq}`;
    const state = createGatewayState();
    const selectedModel = process.env.CODEX_GATEWAY_MODEL || process.env.CODEX_MODEL;
    const batch = toCodexRequests(
      request,
      {
        cwd,
        requestId: id,
        model: selectedModel,
        reasoningEffort: process.env.CODEX_GATEWAY_REASONING_EFFORT,
      },
      this.toolAliasesByOriginal,
    );
    const rpc = batch.requests[0];
    if (rpc && batch.threadId === null) {
      const response = await this.request(
        `thread-${this.seq}`,
        "thread/start",
        codexThreadStartParams(
          cwd,
          selectedModel,
          request.model,
          request.tools ?? [],
          request.messages,
          state.toolNameAliases,
          this.toolAliasesByOriginal,
        ),
      );
      const thread = (response as { thread?: { id?: string } }).thread;
      if (!thread?.id) throw new Error("Codex thread/start returned no thread id");
      rpc.params.threadId = thread.id;
    }
    if (!rpc || !shouldForwardWithRetryDedupe(state, rpc)) {
      throw new Error("Codex gateway refused to forward duplicate request");
    }
    return await new Promise<AnthropicSseEvent[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, state, notifications: [] });
      this.writeJson(rpc).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async models(): Promise<CodexModelListResult> {
    await this.initialize();
    return (await this.request(`models-${++this.seq}`, "model/list", {})) as CodexModelListResult;
  }

  async account(): Promise<unknown> {
    await this.initialize();
    return await this.request(`account-${++this.seq}`, "account/read", { refreshToken: false });
  }

  async accountRateLimits(): Promise<unknown> {
    await this.initialize();
    return await this.request(`rate-limits-${++this.seq}`, "account/rateLimits/read", {
      excludeResetCreditDetails: false,
    });
  }

  async accountUsage(threadId?: string | null): Promise<unknown> {
    await this.initialize();
    return await this.request(`usage-${++this.seq}`, "account/usage/read", threadId ? { threadId } : {});
  }

  async interruptAll(): Promise<void> {
    const active = Array.from(this.activeByTurn.entries()).map(([turnId, turn]) => [turnId, { threadId: turn.threadId }] as [string, { threadId: string }]);
    for (const request of cleanShutdownRequests(active)) {
      await this.writeJson(request);
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.request("initialize", "initialize", {
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
      clientInfo: { name: "fk-toolkit-codex-gateway", title: "FK Toolkit Codex Gateway", version: "0.6.1" },
    });
    await this.writeJson({
      jsonrpc: "2.0",
      method: "initialized",
    });
  }

  private async request(id: string | number, method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    return await new Promise<unknown>((resolve, reject) => {
      this.rpcPending.set(id, { resolve, reject });
      this.writeJson({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.rpcPending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private rejectAll(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
    this.activeByTurn.clear();
  }

  private async writeJson(value: unknown): Promise<void> {
    await this.proc.stdin.write(encoder.encode(`${JSON.stringify(value)}\n`));
  }

  private async readLoop(): Promise<void> {
    if (!this.proc.stdout) throw new Error("Codex app-server stdout is unavailable");
    const reader = this.proc.stdout.getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.handleMessage(JSON.parse(line) as JsonRpcNotification | JsonRpcRequest);
        nl = buffer.indexOf("\n");
      }
    }
  }

  private async stderrLoop(): Promise<void> {
    if (!this.proc.stderr) return;
    const reader = this.proc.stderr.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (text.trim()) console.error(text.trimEnd());
    }
  }

  private respondToClientRequest(id: string | number, method: string): boolean {
    const result = failClosedClientRequestResult(method);
    if (!result) return false;
    void this.writeJson({ jsonrpc: "2.0", id, result });
    return true;
  }

  private handleMessage(message: JsonRpcNotification | JsonRpcRequest): void {
    const record = message as Record<string, unknown>;
    if ("id" in record && "method" in record) {
      if (record["method"] === "item/tool/call") {
        this.recordNotification(message as JsonRpcNotification);
      }
      const handled = this.respondToClientRequest(record["id"] as string | number, String(record["method"]));
      if (handled) return;
    }
    if ("id" in record && !("method" in record)) {
      const id = record["id"] as string | number;
      const rpc = this.rpcPending.get(id);
      if (rpc) {
        this.rpcPending.delete(id);
        if ("error" in record) rpc.reject(new Error(JSON.stringify(record["error"])));
        else rpc.resolve(record["result"]);
        return;
      }
      const pending = this.pending.get(id);
      if (pending && "error" in record) {
        pending.reject(new Error(JSON.stringify(record["error"])));
        this.pending.delete(id);
      }
      return;
    }
    this.recordNotification(message as JsonRpcNotification);
  }

  private recordNotification(notification: JsonRpcNotification): void {
    const params = notification.params ?? {};
    const turnId = readTurnId(params);
    let pending = turnId ? this.activeByTurn.get(turnId)?.pending : undefined;
    if (!pending && notification.method === "turn/started") {
      const latest = Array.from(this.pending.values()).at(-1);
      const startedTurn = readTurnId(params);
      if (latest && startedTurn) {
        pending = latest;
        const threadId = readString(params, "threadId") ?? "";
        this.activeByTurn.set(startedTurn, { threadId, pending: latest });
      }
    }
    if (!pending) pending = Array.from(this.pending.values()).at(-1);
    if (!pending) return;
    pending.notifications.push(notification);
    if (notification.method === "turn/completed" || notification.method === "turn/failed" || notification.method === "turn/interrupted" || notification.method === "error") {
      try {
        pending.resolve(toAnthropicStreamEvents(pending.notifications, pending.state));
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      for (const [id, p] of this.pending.entries()) {
        if (p === pending) this.pending.delete(id);
      }
      if (turnId) this.activeByTurn.delete(turnId);
    }
  }
}

function spawnCodexAppServer(): CodexProcess {
  const cmd = codexAppServerCommand();
  const proc = Bun.spawn([cmd.command, ...cmd.args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...cmd.env },
  });
  return {
    stdin: proc.stdin,
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: () => proc.kill(),
  };
}

function sseEncode(event: AnthropicSseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

async function serve(): Promise<void> {
  const port = Number(process.env.CODEX_GATEWAY_PORT || "4545");
  const cwd = process.env.CODEX_GATEWAY_CWD || process.cwd();
  const client = new CodexJsonRpcClient(spawnCodexAppServer());
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({
          ok: true,
          provider: "codex-app-server",
          model: process.env.CODEX_GATEWAY_MODEL || process.env.CODEX_MODEL || null,
          reasoning_effort: process.env.CODEX_GATEWAY_REASONING_EFFORT || null,
        });
      }
      if (url.pathname === "/v1/models") {
        try {
          return Response.json(toAnthropicModelsList(await client.models()));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 502 });
        }
      }
      if (url.pathname === "/codex/account") {
        try {
          return Response.json(await client.account());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 502 });
        }
      }
      if (url.pathname === "/codex/rate-limits") {
        try {
          return Response.json(await client.accountRateLimits());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 502 });
        }
      }
      if (url.pathname === "/codex/usage") {
        try {
          return Response.json(await client.accountUsage(url.searchParams.get("threadId")));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 502 });
        }
      }
      if (url.pathname !== "/v1/messages" || req.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      let body: AnthropicMessagesRequest;
      try {
        body = (await req.json()) as AnthropicMessagesRequest;
      } catch {
        return Response.json({ type: "error", error: { type: "invalid_request_error", message: "invalid JSON" } }, { status: 400 });
      }
      try {
        const events = await client.turn(body, cwd);
        if (shouldStreamAnthropicResponse(body)) {
          return new Response(events.map(sseEncode).join(""), {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        }
        return Response.json(nonStreamingAnthropicResponseFromEvents(
          body,
          events,
          process.env.CODEX_GATEWAY_MODEL || process.env.CODEX_MODEL,
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 502 });
      }
    },
  });
  const stop = async () => {
    await client.interruptAll().catch(() => undefined);
    server.stop();
  };
  process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
  process.on("SIGINT", () => void stop().then(() => process.exit(0)));
  console.error(`codex-anthropic-gateway listening on http://127.0.0.1:${port}`);
}

if (import.meta.main) {
  const command = process.argv[2] ?? "serve";
  if (command === "serve") {
    await serve();
  } else if (command === "doctor") {
    const hasCodex = Bun.which("codex") !== null;
    console.log(`codex cli: ${hasCodex ? "ok" : "missing"}`);
    console.log(`model: ${process.env.CODEX_GATEWAY_MODEL || process.env.CODEX_MODEL || "not configured"}`);
    console.log(`reasoning effort: ${process.env.CODEX_GATEWAY_REASONING_EFFORT || "default"}`);
    if (!hasCodex) process.exitCode = 1;
  } else {
    console.error("usage: bun run scripts/codex-anthropic-gateway.ts [serve|doctor]");
    process.exit(2);
  }
}
