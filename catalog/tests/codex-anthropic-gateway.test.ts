import { describe, expect, it } from "bun:test";
import {
  cancellationRequest,
  cleanShutdownRequests,
  codexAppServerCommand,
  codexDynamicToolInputSchema,
  codexDynamicToolName,
  codexDynamicToolsForTurn,
  codexThreadStartParams,
  failClosedClientRequestResult,
  createGatewayState,
  shouldForwardWithRetryDedupe,
  resolveCodexModel,
  shouldStreamAnthropicResponse,
  toAnthropicModelsList,
  toAnthropicStreamEvents,
  toCodexRequests,
  nonStreamingAnthropicResponseFromEvents,
  type AnthropicMessagesRequest,
} from "../../scripts/codex-anthropic-gateway.ts";

const baseRequest: AnthropicMessagesRequest = {
  model: "claude-3-5-sonnet-latest",
  max_tokens: 256,
  system: "You are a careful coding assistant.",
  messages: [{ role: "user", content: "Say hello." }],
};

describe("experimental Codex Anthropic gateway", () => {
  it("declares the official app-server stdio boundary with an empty environment", () => {
    expect(codexAppServerCommand()).toEqual({
      command: "codex",
      args: ["app-server", "--stdio"],
      env: {},
    });
  });

  it("translates an Anthropic request into a fail-closed Codex turn/start request", () => {
    const batch = toCodexRequests(baseRequest, { cwd: "/workspace", requestId: "r1", model: "gpt-5.5", reasoningEffort: "medium" });

    expect(batch.threadId).toBeNull();
    expect(batch.unsupported).toEqual([]);
    expect(batch.requests).toHaveLength(1);
    expect(batch.requests[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "r1",
      method: "turn/start",
      params: {
        cwd: "/workspace",
        model: "gpt-5.5",
        effort: "medium",
        input: [{ type: "text", text: "user: Say hello.", text_elements: [] }],
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      },
    });
    expect(String(batch.requests[0]?.params["threadId"])).toMatch(/^urn:uuid:[0-9a-f-]+$/);
    expect(batch.requests[0]?.params["additionalContext"]).toEqual({
      "anthropic-system": {
        kind: "application",
        value: "You are a careful coding assistant.",
      },
    });
  });

  it("starts Codex threads with read-only execution settings", () => {
    expect(codexThreadStartParams("/workspace", "gpt-5.5", "claude-sonnet-4-5")).toEqual({
      cwd: "/workspace",
      model: "gpt-5.5",
      ephemeral: true,
      threadSource: "fk-toolkit-codex-gateway",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "read-only",
    });
  });

  it("declares Claude tools as Codex dynamic tools at thread start", () => {
    const aliases = new Map<string, string>();
    expect(codexThreadStartParams("/workspace", "gpt-5.5", "claude-sonnet-4-5", [
      {
        name: "Bash",
        description: "Run a shell command",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
      {
        name: "mcp__context7__query-docs",
        description: "Query Context7 docs",
        input_schema: { type: "object" },
      },
    ], [{ role: "user", content: "Use Bash and mcp__context7__query-docs." }], aliases)).toMatchObject({
      dynamicTools: [
        {
          type: "function",
          name: "Bash",
          description:
            'Run a shell command\n\nCall this Claude Code client tool with JSON arguments matching this schema: {"type":"object","properties":{"command":{"type":"string","description":"Shell command for Claude Code to run."},"description":{"type":"string","description":"Short description of what the command does."}},"required":["command"],"additionalProperties":false}',
          inputSchema: {
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
          },
        },
        {
          type: "function",
          name: "claude_tool_1_mcp__context7__query_docs",
          description:
            'Query Context7 docs\n\nCall this Claude Code client tool with JSON arguments matching this schema: {"type":"object","properties":{},"required":[],"additionalProperties":false}',
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
    });
    expect(aliases.get("claude_tool_1_mcp__context7__query_docs")).toBe("mcp__context7__query-docs");
    expect(codexDynamicToolName("mcp__context7__query-docs", 1)).toBe("claude_tool_1_mcp__context7__query_docs");
  });

  it("prefers turn-mentioned tools before falling back to the supported core", () => {
    const tools = [
      { name: "Bash", input_schema: { type: "object" } },
      { name: "CronCreate", input_schema: { type: "object" } },
      { name: "mcp__github__get_me", input_schema: { type: "object" } },
    ];

    expect(codexDynamicToolsForTurn(tools, [{ role: "user", content: "Use Bash once." }]).map((tool) => tool.name)).toEqual([
      "Bash",
    ]);
    expect(codexDynamicToolsForTurn(tools, [{ role: "user", content: "Check my GitHub profile." }]).map((tool) => tool.name)).toEqual([
      "Bash",
      "mcp__github__get_me",
    ]);
  });

  it("normalizes dynamic tool input schemas for Responses function tools", () => {
    expect(codexDynamicToolInputSchema("lookup", { properties: { command: { type: "string" } }, required: ["command"] })).toEqual({
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    });
    expect(codexDynamicToolInputSchema("lookup", null)).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("uses compact Claude Code schemas for built-in client tools", () => {
    expect(codexDynamicToolInputSchema("Bash", { type: "object", properties: { ignored: { type: "string" } } })).toEqual({
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
    });
    expect(codexDynamicToolInputSchema("Write", null)).toMatchObject({
      type: "object",
      required: ["file_path", "content"],
      additionalProperties: false,
    });
  });

  it("uses turn/start for multi-turn requests carrying a Codex thread id", () => {
    const batch = toCodexRequests(
      {
        ...baseRequest,
        metadata: { codex_thread_id: "thread-123" },
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Second" },
          { role: "user", content: "Third" },
        ],
      },
      { cwd: "/workspace", requestId: 7, model: "gpt-5.5" },
    );

    expect(batch.requests[0]).toMatchObject({
      id: 7,
      method: "turn/start",
      params: {
        threadId: "thread-123",
        input: [
          {
            type: "text",
            text: "user: First\n\nassistant: Second\n\nuser: Third",
            text_elements: [],
          },
        ],
      },
    });
  });

  it("does not duplicate dynamic client tool schemas in additional context", () => {
    const batch = toCodexRequests(
      {
        ...baseRequest,
        tools: [
          {
            name: "lookup",
            description: "Lookup a value",
            input_schema: { type: "object", properties: { query: { type: "string" } } },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Use lookup." },
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "result text",
              },
            ],
          },
        ],
      },
      { cwd: "/workspace", model: "gpt-5.5" },
    );

    const context = batch.requests[0]?.params["additionalContext"] as Record<string, { kind: string; value: string }>;
    expect(context).toEqual({
      "anthropic-system": {
        kind: "application",
        value: "You are a careful coding assistant.",
      },
    });
    expect(batch.requests[0]?.params["input"]).toEqual([
      {
        type: "text",
        text: 'user: Use lookup.\n{"type":"tool_result","tool_use_id":"toolu_1","is_error":false,"content":"result text"}',
        text_elements: [],
      },
    ]);
  });

  it("continues Claude-owned tool results through Codex toolOutput", () => {
    const aliases = new Map<string, string>([
      ["mcp__github__get_me", "claude_tool_0_mcp__github__get_me"],
    ]);
    const batch = toCodexRequests(
      {
        ...baseRequest,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "mcp__github__get_me",
                input: {},
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "result text",
              },
            ],
          },
        ],
      },
      { cwd: "/workspace", model: "gpt-5.5" },
      aliases,
    );

    expect(batch.requests[0]?.params["toolOutput"]).toEqual({
      name: "claude_tool_0_mcp__github__get_me",
      namespace: null,
      output: "result text",
    });
    expect(batch.requests[0]?.params["input"]).toEqual([]);
  });


  it("maps Codex model/list into Anthropic-compatible model objects", () => {
    expect(
      toAnthropicModelsList({
        data: [
          {
            id: "gpt-6.1-sol",
            model: "gpt-6.1-sol",
            displayName: "GPT-6.1-Sol",
            description: "Latest workhorse model for coding and everyday work.",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }],
            defaultReasoningEffort: "low",
            inputModalities: ["text", "image"],
            isDefault: true,
          },
          { id: "internal-hidden", hidden: true },
        ],
      }),
    ).toEqual({
      object: "list",
      data: [
        {
          id: "gpt-6.1-sol",
          object: "model",
          display_name: "GPT-6.1-Sol",
          metadata: {
            codex_model: "gpt-6.1-sol",
            description: "Latest workhorse model for coding and everyday work.",
            default_reasoning_effort: "low",
            supported_reasoning_efforts: [{ reasoningEffort: "low", description: "Fast" }],
            input_modalities: ["text", "image"],
            service_tiers: [],
            default_service_tier: null,
            upgrade: null,
            upgrade_info: null,
            is_default: true,
          },
        },
      ],
    });
  });

  it("keeps Codex model choice independent from Claude aliases", () => {
    expect(resolveCodexModel("claude-3-5-sonnet-latest", "gpt-5.5")).toBe("gpt-5.5");
    expect(resolveCodexModel("gpt-5.5")).toBe("gpt-5.5");
    expect(resolveCodexModel("gpt-5.6-luna", "gpt-5.5")).toBe("gpt-5.6-luna");
    expect(codexThreadStartParams("/workspace", "gpt-5.5", "gpt-5.6-luna")).toMatchObject({
      model: "gpt-5.6-luna",
    });
    expect(() => resolveCodexModel("claude-3-5-sonnet-latest")).toThrow(
      "set CODEX_GATEWAY_MODEL to a Codex model id",
    );
  });


  it("declines Codex-side approval and dynamic tool requests", () => {
    expect(failClosedClientRequestResult("item/commandExecution/requestApproval")).toEqual({ decision: "decline" });
    expect(failClosedClientRequestResult("item/fileChange/requestApproval")).toEqual({ decision: "decline" });
    expect(failClosedClientRequestResult("execCommandApproval")).toEqual({
      decision: { denied: { rejection: "Codex gateway keeps Claude Code as the tool-permission owner." } },
    });
    expect(failClosedClientRequestResult("item/permissions/requestApproval")).toEqual({
      permissions: {},
      scope: "turn",
      strictAutoReview: true,
    });
    expect(failClosedClientRequestResult("item/tool/call")).toMatchObject({ success: false });
    expect(failClosedClientRequestResult("thread/unknown")).toBeNull();
  });

  it("defaults Anthropic-compatible responses to non-streaming unless stream is true", () => {
    expect(shouldStreamAnthropicResponse(baseRequest)).toBe(false);
    expect(shouldStreamAnthropicResponse({ ...baseRequest, stream: false })).toBe(false);
    expect(shouldStreamAnthropicResponse({ ...baseRequest, stream: true })).toBe(true);
  });

  it("maps Codex streaming deltas and dynamic tool calls to Anthropic SSE events", () => {
    const state = createGatewayState();
    state.toolNameAliases.set("claude_tool_0_mcp__context7__query_docs", "mcp__context7__query-docs");
    const events = toAnthropicStreamEvents([
      {
        method: "turn/started",
        params: { threadId: "t1", turn: { id: "turn1" } },
      },
      {
        method: "item/agentMessage/delta",
        params: { threadId: "t1", turnId: "turn1", itemId: "i1", delta: "Hel" },
      },
      {
        method: "item/agentMessage/delta",
        params: { threadId: "t1", turnId: "turn1", itemId: "i1", delta: "lo" },
      },
      {
        method: "item/completed",
        params: {
          threadId: "t1",
          turnId: "turn1",
          item: {
            id: "toolu_1",
            type: "dynamic_tool_call",
            toolName: "claude_tool_0_mcp__context7__query_docs",
            arguments: "{\"query\":\"alpha\"}",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId: "t1", turnId: "turn1", itemId: "cmd1", delta: "TOOL_OK" },
      },
      {
        method: "turn/completed",
        params: { threadId: "t1", turn: { id: "turn1" } },
      },
    ], state);

    expect(events.map((event) => event.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events[2]?.data).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hel" },
    });
    expect(events[5]?.data).toEqual({
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_1",
        name: "mcp__context7__query-docs",
        input: { query: "alpha" },
      },
    });
    expect(events[8]?.data).toEqual({
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: "TOOL_OK" },
    });
  });

  it("maps app-server dynamic tool requests to Claude tool_use events with their arguments", () => {
    const state = createGatewayState();
    state.toolNameAliases.set("claude_tool_0_mcp__github__get_me", "mcp__github__get_me");
    const events = toAnthropicStreamEvents([
      {
        method: "turn/started",
        params: { threadId: "t1", turn: { id: "turn1" } },
      },
      {
        method: "item/tool/call",
        params: {
          threadId: "t1",
          turnId: "turn1",
          callId: "call_1",
          namespace: null,
          tool: "claude_tool_0_mcp__github__get_me",
          arguments: { include_private: false },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "t1",
          turnId: "turn1",
          item: {
            id: "call_1",
            type: "dynamic_tool_call",
            toolName: "claude_tool_0_mcp__github__get_me",
            arguments: "{}",
          },
        },
      },
      {
        method: "turn/completed",
        params: { threadId: "t1", turn: { id: "turn1" } },
      },
    ], state);

    const starts = events.filter((event) => event.event === "content_block_start");
    expect(starts).toHaveLength(1);
    expect(starts[0]?.data).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "call_1",
        name: "mcp__github__get_me",
        input: { include_private: false },
      },
    });
  });

  it("deduplicates retried forwards and repeated Codex errors", () => {
    const state = createGatewayState();
    const batch = toCodexRequests(baseRequest, { cwd: "/workspace", requestId: "first", model: "gpt-5.5" });
    const retry = { ...batch.requests[0]!, id: "second" };

    expect(shouldForwardWithRetryDedupe(state, batch.requests[0]!)).toBe(true);
    expect(shouldForwardWithRetryDedupe(state, retry)).toBe(false);

    const events = toAnthropicStreamEvents(
      [
        { method: "error", params: { message: "upstream failed" } },
        { method: "error", params: { message: "upstream failed" } },
      ],
      state,
    );

    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("does not translate failed or interrupted Codex turns into successful Claude turns", () => {
    const failed = toAnthropicStreamEvents([
      {
        method: "turn/completed",
        params: { threadId: "t1", turn: { id: "turn1", status: "failed", error: { message: "tool failed" } } },
      },
    ]);
    const interrupted = toAnthropicStreamEvents([
      {
        method: "turn/interrupted",
        params: { threadId: "t1", turn: { id: "turn2", status: "interrupted" } },
      },
    ]);

    expect(failed.filter((event) => event.event === "error")).toHaveLength(1);
    expect(interrupted.filter((event) => event.event === "error")).toHaveLength(1);
    expect(failed.some((event) => event.event === "message_delta")).toBe(false);
    expect(interrupted.some((event) => event.event === "message_delta")).toBe(false);
  });

  it("returns one structured non-streaming failure instead of a false success for app-server errors", () => {
    const state = createGatewayState();
    const events = toAnthropicStreamEvents(
      [
        { method: "error", params: { message: "unknown MCP tool" } },
        { method: "error", params: { message: "unknown MCP tool" } },
      ],
      state,
    );

    expect(() => nonStreamingAnthropicResponseFromEvents(baseRequest, events, "gpt-5.5")).toThrow(
      "unknown MCP tool",
    );
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
  });

  it("builds cancellation and clean-shutdown turn interrupts", () => {
    expect(cancellationRequest("thread-1", "turn-1", "cancel")).toEqual({
      jsonrpc: "2.0",
      id: "cancel",
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });

    expect(
      cleanShutdownRequests([
        ["turn-1", { threadId: "thread-1" }],
        ["turn-2", { threadId: "thread-2" }],
      ]),
    ).toEqual([
      {
        jsonrpc: "2.0",
        id: "shutdown-1",
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
      {
        jsonrpc: "2.0",
        id: "shutdown-2",
        method: "turn/interrupt",
        params: { threadId: "thread-2", turnId: "turn-2" },
      },
    ]);
  });

  it("fails closed on unsupported Codex notifications and malformed Anthropic requests", () => {
    expect(() => toAnthropicStreamEvents([{ method: "thread/unknown/event", params: {} }])).toThrow(
      "Unsupported Codex notification: thread/unknown/event",
    );
    expect(() =>
      toCodexRequests({ ...baseRequest, messages: [] }, { cwd: "/workspace" }),
    ).toThrow("Anthropic request must include at least one message");
  });
});
