import type { ChatMessage, RuntimeEvent, ToolActivity } from "./types";

export type JsonFrame = Record<string, unknown>;

export class JsonlDecoder {
  private pending = "";

  push(chunk: string): JsonFrame[] {
    this.pending += chunk;
    const records = this.pending.split("\n");
    this.pending = records.pop() ?? "";

    return records.flatMap((record) => {
      const frame = record.endsWith("\r") ? record.slice(0, -1) : record;
      if (!frame) return [];
      try {
        return [JSON.parse(frame) as JsonFrame];
      } catch {
        return [{ type: "protocol_error", message: "Invalid JSONL frame" }];
      }
    });
  }
}

function textContent(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; text?: string } => !!item && typeof item === "object")
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

function messageFrom(value: unknown, fallbackId: string): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { role?: unknown; timestamp?: unknown };
  if (raw.role !== "user" && raw.role !== "assistant") return null;
  return {
    id: fallbackId,
    role: raw.role,
    content: textContent(value),
    createdAt: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
  };
}

export class PiEventNormalizer {
  private sequence = 0;
  private readonly tools = new Map<string, ToolActivity>();

  accept(frame: JsonFrame): RuntimeEvent[] {
    const type = frame.type;
    if (type === "protocol_error") {
      return [{ type: "runtime.error", message: String(frame.message ?? "Protocol error") }];
    }
    if (type === "message_update") {
      const update = frame.assistantMessageEvent;
      if (!update || typeof update !== "object") return [];
      const delta = update as { type?: unknown; contentIndex?: unknown; delta?: unknown };
      if (delta.type !== "text_delta" || typeof delta.delta !== "string") return [];
      return [{
        type: "text.delta",
        contentIndex: typeof delta.contentIndex === "number" ? delta.contentIndex : 0,
        delta: delta.delta,
      }];
    }
    if (type === "message_end") {
      const raw = frame.message && typeof frame.message === "object"
        ? frame.message as { stopReason?: unknown; errorMessage?: unknown }
        : null;
      if (raw?.stopReason === "error" || raw?.stopReason === "aborted") {
        const fallback = raw.stopReason === "aborted"
          ? "The current turn was stopped"
          : "Pi could not complete the response";
        return [{
          type: "runtime.error",
          message: typeof raw.errorMessage === "string" ? raw.errorMessage : fallback,
        }];
      }
      const message = messageFrom(frame.message, `message-${++this.sequence}`);
      return message ? [{ type: "message.completed", message }] : [];
    }
    if (type === "tool_execution_start") {
      const callId = String(frame.toolCallId ?? "");
      const tool: ToolActivity = {
        callId,
        tool: String(frame.toolName ?? "tool"),
        status: "running",
        input: frame.args && typeof frame.args === "object"
          ? frame.args as Record<string, unknown>
          : undefined,
      };
      this.tools.set(callId, tool);
      return [{ type: "tool.updated", tool }];
    }
    if (type === "tool_execution_update") {
      const callId = String(frame.toolCallId ?? "");
      const previous = this.tools.get(callId) ?? {
        callId,
        tool: String(frame.toolName ?? "tool"),
        status: "running" as const,
      };
      const tool = { ...previous, partialOutput: textContent(frame.partialResult) };
      this.tools.set(callId, tool);
      return [{ type: "tool.updated", tool }];
    }
    if (type === "tool_execution_end") {
      const callId = String(frame.toolCallId ?? "");
      const previous = this.tools.get(callId) ?? {
        callId,
        tool: String(frame.toolName ?? "tool"),
        status: "running" as const,
      };
      const tool: ToolActivity = {
        ...previous,
        status: frame.isError ? "failed" : "success",
        output: textContent(frame.result),
        partialOutput: undefined,
      };
      this.tools.set(callId, tool);
      return [{ type: "tool.updated", tool }];
    }
    if (type === "extension_ui_request") {
      if (frame.method !== "select" && frame.method !== "confirm") return [];
      return [{
        type: "approval.requested",
        approval: {
          requestId: String(frame.id ?? ""),
          action: frame.method,
          detail: String(frame.title ?? frame.message ?? "Approval required"),
          options: Array.isArray(frame.options)
            ? frame.options.map(String)
            : undefined,
        },
      }];
    }
    if (type === "agent_settled") return [{ type: "runtime.settled" }];
    if (type === "extension_error") {
      return [{ type: "runtime.error", message: String(frame.error ?? "Extension error") }];
    }
    return [];
  }
}
