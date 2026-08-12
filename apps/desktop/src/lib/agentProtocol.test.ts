import { describe, expect, it } from "vitest";
import {
  JsonlDecoder,
  PiEventNormalizer,
  type RuntimeEvent,
} from "@boya/sdk";

describe("JsonlDecoder", () => {
  it("buffers partial frames and only splits on LF", () => {
    const decoder = new JsonlDecoder();

    expect(decoder.push('{"type":"agent_')).toEqual([]);
    expect(
      decoder.push('settled"}\n{"type":"message_update","text":"a\u2028b"}\r\n'),
    ).toEqual([
      { type: "agent_settled" },
      { type: "message_update", text: "a b" },
    ]);
  });

  it("reports malformed complete frames without losing later frames", () => {
    const decoder = new JsonlDecoder();

    expect(decoder.push("not-json\n{\"type\":\"agent_settled\"}\n")).toEqual([
      { type: "protocol_error", message: "Invalid JSONL frame" },
      { type: "agent_settled" },
    ]);
  });
});

describe("PiEventNormalizer", () => {
  it("assembles text deltas and emits the authoritative completed message", () => {
    const normalizer = new PiEventNormalizer();
    const events: RuntimeEvent[] = [];

    events.push(
      ...normalizer.accept({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
      ...normalizer.accept({
        type: "message_update",
        assistantMessageEvent: { type: "text_start", contentIndex: 0 },
      }),
      ...normalizer.accept({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Hello ",
        },
      }),
      ...normalizer.accept({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "world",
        },
      }),
      ...normalizer.accept({
        type: "message_end",
        message: {
          role: "assistant",
          timestamp: 123,
          content: [{ type: "text", text: "Hello world" }],
        },
      }),
    );

    expect(events).toContainEqual({
      type: "text.delta",
      contentIndex: 0,
      delta: "Hello ",
    });
    expect(events.at(-1)).toEqual({
      type: "message.completed",
      message: {
        id: expect.any(String),
        role: "assistant",
        content: "Hello world",
        createdAt: 123,
      },
    });
  });

  it("normalizes tool progress, approvals, settlement, and extension errors", () => {
    const normalizer = new PiEventNormalizer();

    expect(
      normalizer.accept({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "pnpm test" },
      }),
    ).toEqual([
      {
        type: "tool.updated",
        tool: {
          callId: "call-1",
          tool: "bash",
          status: "running",
          input: { command: "pnpm test" },
        },
      },
    ]);

    expect(
      normalizer.accept({
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "3 passed" }] },
      }),
    ).toEqual([
      {
        type: "tool.updated",
        tool: expect.objectContaining({
          callId: "call-1",
          status: "running",
          partialOutput: "3 passed",
        }),
      },
    ]);

    expect(
      normalizer.accept({
        type: "extension_ui_request",
        id: "approval-1",
        method: "select",
        title: "Allow overwrite?",
        options: ["Allow", "Block"],
      }),
    ).toEqual([
      {
        type: "approval.requested",
        approval: {
          requestId: "approval-1",
          action: "select",
          detail: "Allow overwrite?",
          options: ["Allow", "Block"],
        },
      },
    ]);

    expect(normalizer.accept({ type: "agent_settled" })).toEqual([
      { type: "runtime.settled" },
    ]);
    expect(
      normalizer.accept({ type: "extension_error", error: "policy failed" }),
    ).toEqual([{ type: "runtime.error", message: "policy failed" }]);
  });

  it("keeps multiple completed messages distinct", () => {
    const normalizer = new PiEventNormalizer();
    const first = normalizer.accept({
      type: "message_end",
      message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "First" }] },
    });
    const second = normalizer.accept({
      type: "message_end",
      message: { role: "assistant", timestamp: 2, content: [{ type: "text", text: "Second" }] },
    });

    expect(first[0]).toMatchObject({ type: "message.completed" });
    expect(second[0]).toMatchObject({ type: "message.completed" });
    if (first[0]?.type !== "message.completed" || second[0]?.type !== "message.completed") {
      throw new Error("Expected completed messages");
    }
    expect(first[0].message.id).not.toBe(second[0].message.id);
  });

  it("surfaces provider failures and aborted turns as runtime errors", () => {
    const normalizer = new PiEventNormalizer();

    expect(normalizer.accept({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Invalid API key",
        content: [],
      },
    })).toEqual([{ type: "runtime.error", message: "Invalid API key" }]);

    expect(normalizer.accept({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "aborted",
        content: [],
      },
    })).toEqual([{ type: "runtime.error", message: "The current turn was stopped" }]);
  });
});
