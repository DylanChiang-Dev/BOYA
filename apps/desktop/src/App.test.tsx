import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalReply,
  ChatMessage,
  ModelInfo,
  RuntimeEvent,
  RuntimeSnapshot,
  SessionSummary,
} from "@boya/sdk";
import { App } from "./App";
import type { DesktopAgentClient } from "./lib/agentClient";

class FakeClient implements DesktopAgentClient {
  keyConfigured = false;
  workspace: string | null = null;
  listeners = new Set<(event: RuntimeEvent) => void>();
  sessions: SessionSummary[] = [];
  messages: ChatMessage[] = [];
  abort = vi.fn(async () => {});
  replyApproval = vi.fn(async (_reply: ApprovalReply) => {});
  stop = vi.fn(async () => {});
  setApiKey = vi.fn(async () => { this.keyConfigured = true; });
  removeApiKey = vi.fn(async () => { this.keyConfigured = false; });

  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async apiKeyStatus() { return this.keyConfigured; }
  async pickWorkspace() { this.workspace = "/Users/research/field-notes"; return this.workspace; }
  async versions() { return { boya: "0.2.0", pi: "v0.84.1" }; }
  async snapshot(): Promise<RuntimeSnapshot> {
    return { status: "offline", workspace: this.workspace, sessionId: null, model: "gpt-5.6-terra", running: false };
  }
  async start(workspace?: string): Promise<RuntimeSnapshot> {
    this.workspace = workspace ?? this.workspace;
    return { status: "ready", workspace: this.workspace, sessionId: "session-1", model: "gpt-5.6-terra", running: false };
  }
  async prompt(message: string) {
    this.messages.push({ id: "user-1", role: "user", content: message, createdAt: 1 });
    this.emit({ type: "text.delta", contentIndex: 0, delta: "正在整理" });
  }
  async listSessions() { return this.sessions; }
  async newSession() {
    this.emit({
      type: "snapshot.updated",
      snapshot: { status: "ready", workspace: this.workspace, sessionId: "session-2", model: "gpt-5.6-terra", running: false },
    });
  }
  async switchSession() {}
  async renameSession(path: string, title: string) {
    const session = this.sessions.find((item) => item.path === path);
    if (session) session.title = title;
  }
  async archiveSession(path: string) { this.sessions = this.sessions.filter((item) => item.path !== path); return null; }
  async getMessages() { return this.messages; }
  async listModels(): Promise<ModelInfo[]> { return [{ id: "gpt-5.6-terra", name: "GPT-5.6 Terra" }]; }
  async setModel() {}
}

describe("BOYA Desktop", () => {
  it("completes first-run setup in the workspace", async () => {
    const client = new FakeClient();
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "設定 BOYA" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("OpenAI API Key"), { target: { value: "sk-valid-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "選擇資料夾" }));
    await screen.findByText("/Users/research/field-notes");
    fireEvent.click(screen.getByRole("button", { name: "開始使用" }));

    expect(await screen.findByText("尚無對話" )).toBeInTheDocument();
  });

  it("streams text, expands tools, handles approval, stop, and runtime errors", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    client.sessions = [{ id: "session-1", path: "/sessions/1.jsonl", title: "田野筆記", workspace: client.workspace, updatedAt: 1 }];
    render(<App client={client} />);

    await screen.findByText("田野筆記");
    fireEvent.change(screen.getByLabelText("訊息"), { target: { value: "整理今天的筆記" } });
    fireEvent.click(screen.getByRole("button", { name: "傳送" }));
    expect(await screen.findByText("正在整理")).toBeInTheDocument();

    act(() => client.emit({ type: "tool.updated", tool: { callId: "tool-1", tool: "read", status: "running", input: { path: "notes.md" } } }));
    act(() => client.emit({ type: "tool.updated", tool: { callId: "tool-1", tool: "read", status: "success", output: "12 lines" } }));
    fireEvent.click(await screen.findByRole("button", { name: /read/ }));
    expect(screen.getByText(/notes\.md/)).toBeInTheDocument();
    expect(screen.getByText("12 lines")).toBeInTheDocument();

    act(() => client.emit({ type: "approval.requested", approval: { requestId: "approval-1", action: "confirm", detail: "覆寫 notes.md？" } }));
    fireEvent.click(await screen.findByRole("button", { name: "允許一次" }));
    expect(client.replyApproval).toHaveBeenCalledWith({ requestId: "approval-1", confirmed: true });

    act(() => client.emit({ type: "snapshot.updated", snapshot: { status: "ready", workspace: client.workspace, sessionId: "session-1", model: "gpt-5.6-terra", running: true } }));
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    expect(client.abort).toHaveBeenCalled();

    act(() => client.emit({ type: "runtime.error", message: "Pi 意外結束" }));
    expect(await screen.findByText("Pi 意外結束")).toBeInTheDocument();
  });

  it("returns the selected value for Pi select approvals", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    act(() => client.emit({
      type: "approval.requested",
      approval: {
        requestId: "approval-2",
        action: "select",
        detail: "選擇處理方式",
        options: ["保留", "覆寫"],
      },
    }));
    fireEvent.click(await screen.findByRole("button", { name: "覆寫" }));

    await waitFor(() => expect(client.replyApproval).toHaveBeenCalledWith({
      requestId: "approval-2",
      value: "覆寫",
    }));
    await waitFor(() => expect(screen.queryByText("選擇處理方式")).not.toBeInTheDocument());
  });

  it("creates, renames, and archives sessions", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "新增對話" }));
    fireEvent.change(screen.getByLabelText("訊息"), { target: { value: "建立文獻整理" } });
    fireEvent.click(screen.getByRole("button", { name: "傳送" }));
    client.sessions = [{ id: "session-2", path: "/sessions/2.jsonl", title: "建立文獻整理", workspace: client.workspace!, updatedAt: 2 }];
    act(() => client.emit({ type: "runtime.settled" }));
    expect(await screen.findByRole("heading", { name: "建立文獻整理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "重新命名" }));
    fireEvent.change(screen.getByLabelText("對話名稱"), { target: { value: "文獻整理" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存名稱" }));
    expect(await screen.findByRole("heading", { name: "文獻整理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "封存" }));
    await waitFor(() => expect(screen.queryByText("文獻整理")).not.toBeInTheDocument());
  });

  it("restarts after updating the Key and stops before removing it", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.change(screen.getByLabelText("更新 OpenAI API Key"), { target: { value: "sk-updated-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(client.setApiKey).toHaveBeenCalledWith("sk-updated-test-key"));
    expect(client.setApiKey).toHaveBeenCalledBefore(client.stop);
    await waitFor(() => expect(client.workspace).toBe("/Users/research/field-notes"));

    fireEvent.click(screen.getByRole("button", { name: "移除 Key" }));
    await waitFor(() => expect(client.removeApiKey).toHaveBeenCalled());
    expect(client.stop).toHaveBeenCalledBefore(client.removeApiKey);
    expect(await screen.findByRole("heading", { name: "設定 BOYA" })).toBeInTheDocument();
  });

  it("surfaces settings failures without applying optimistic state", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    client.setApiKey.mockRejectedValueOnce(new Error("Keychain unavailable"));
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.change(screen.getByLabelText("更新 OpenAI API Key"), { target: { value: "sk-updated-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    expect(await screen.findByText("Keychain unavailable")).toBeInTheDocument();
    expect(client.keyConfigured).toBe(true);
  });

  it("replaces the optimistic user message with Pi history instead of duplicating it", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.change(screen.getByLabelText("訊息"), { target: { value: "只顯示一次" } });
    fireEvent.click(screen.getByRole("button", { name: "傳送" }));
    act(() => client.emit({
      type: "message.completed",
      message: { id: "pi-user-1", role: "user", content: "只顯示一次", createdAt: 2 },
    }));

    expect(screen.getAllByText("只顯示一次")).toHaveLength(1);
  });
});
