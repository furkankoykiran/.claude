import { describe, expect, it } from "bun:test";
import {
  cancellationRequest,
  cleanShutdownRequests,
  codexAppServerCommand,
  createGatewayState,
  shouldForwardWithRetryDedupe,
  toAnthropicStreamEvents,
  toCodexRequests,
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
    const batch = toCodexRequests(baseRequest, { cwd: "/workspace", requestId: "r1" });

    expect(batch.threadId).toBeNull();
    expect(batch.unsupported).toEqual([]);
    expect(batch.requests).toHaveLength(1);
    expect(batch.requests[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "r1",
      method: "turn/start",
      params: {
        cwd: "/workspace",
        model: "claude-3-5-sonnet-latest",
        environments: [],
        input: [{ type: "text", text: "user: Say hello.", text_elements: [] }],
      },
    });
    expect(batch.requests[0]?.params["additionalContext"]).toEqual({
      "anthropic-system": {
        kind: "application",
        value: "You are a careful coding assistant.",
      },
    });
  });

  it("uses turn/steer for multi-turn requests carrying a Codex thread id", () => {
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
      { cwd: "/workspace", requestId: 7 },
    );

    expect(batch.requests[0]).toMatchObject({
      id: 7,
      method: "turn/steer",
      params: {
        threadId: "thread-123",
        input: [
          {
            type: "text",
            text: "user: First\n\nassistant: Second\n\nuser: Third",
            text_elements: [],
          },
        ],
        environments: [],
      },
    });
  });

  it("round trips dynamic client tools as instructions and Anthropic tool_result content", () => {
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
      { cwd: "/workspace" },
    );

    const context = batch.requests[0]?.params["additionalContext"] as Record<string, { value: string }>;
    expect(JSON.parse(context["anthropic-tools"]?.value ?? "{}")).toEqual({
      boundary: "experimental-dynamic-client-tools-only",
      tools: [
        {
          name: "lookup",
          description: "Lookup a value",
          input_schema: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    });
    expect(batch.requests[0]?.params["input"]).toEqual([
      {
        type: "text",
        text: 'user: Use lookup.\n{"type":"tool_result","tool_use_id":"toolu_1","is_error":false,"content":"result text"}',
        text_elements: [],
      },
    ]);
  });

  it("maps Codex streaming deltas and dynamic tool calls to Anthropic SSE events", () => {
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
            toolName: "lookup",
            input: { query: "alpha" },
          },
        },
      },
      {
        method: "turn/completed",
        params: { threadId: "t1", turn: { id: "turn1" } },
      },
    ]);

    expect(events.map((event) => event.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
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
        name: "lookup",
        input: { query: "alpha" },
      },
    });
  });

  it("deduplicates retried forwards and repeated Codex errors", () => {
    const state = createGatewayState();
    const batch = toCodexRequests(baseRequest, { cwd: "/workspace", requestId: "first" });
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
    expect(() => toAnthropicStreamEvents([{ method: "thread/name/updated", params: {} }])).toThrow(
      "Unsupported Codex notification: thread/name/updated",
    );
    expect(() =>
      toCodexRequests({ ...baseRequest, messages: [] }, { cwd: "/workspace" }),
    ).toThrow("Anthropic request must include at least one message");
  });
});
