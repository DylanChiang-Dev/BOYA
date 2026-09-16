import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalReply,
  ChatMessage,
  DesktopAuthSnapshot,
  ModelInfo,
  ProviderImport,
  ProviderModel,
  ProviderSettings,
  ProviderSettingsSnapshot,
  RuntimeEvent,
  RuntimeSnapshot,
  SessionSummary,
} from "@boya/sdk";
import { App } from "./App";
import type { DesktopAgentClient } from "./lib/agentClient";
import { resetAgentStore, useAgentStore } from "./lib/agentStore";

class FakeClient implements DesktopAgentClient {
  account: DesktopAuthSnapshot | null = {
    account: {
      user: { id: "user-1", name: "研究者", email: "researcher@example.com" },
      roles: ["member"],
      membership: { tier: "free", expiresAt: null },
      desktopAccess: true,
      sessionExpiresAt: "2026-10-01T00:00:00.000Z",
    },
    offline: false,
  };
  keyConfigured = false;
  workspace: string | null = null;
  providerSettings: ProviderSettings = { mode: "official", name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [] };
  listeners = new Set<(event: RuntimeEvent) => void>();
  sessions: SessionSummary[] = [];
  messages: ChatMessage[] = [];
  abort = vi.fn(async () => {});
  replyApproval = vi.fn(async (_reply: ApprovalReply) => {});
  stop = vi.fn(async () => {});
  startCalls = 0;
  login = vi.fn(async () => this.account!);
  getAccount = vi.fn(async () => this.account);
  logout = vi.fn(async () => { this.account = null; });
  setApiKey = vi.fn(async () => { this.keyConfigured = true; });
  removeApiKey = vi.fn(async () => { this.keyConfigured = false; });
  getProviderSettings = vi.fn(async (): Promise<ProviderSettingsSnapshot> => ({ settings: this.providerSettings, keyConfigured: this.keyConfigured }));
  saveProviderSettings = vi.fn(async (settings: ProviderSettings, apiKey?: string): Promise<ProviderSettingsSnapshot> => {
    this.providerSettings = settings;
    if (apiKey) this.keyConfigured = true;
    return { settings, keyConfigured: this.keyConfigured };
  });
  saveWorkspace = vi.fn(async (workspace: string) => { this.workspace = workspace; return workspace; });
  fetchProviderModels = vi.fn(async (): Promise<ProviderModel[]> => [{ id: "fetched-model", name: "Fetched model", enabled: true }]);
  parseCCSwitchImport = vi.fn(async (): Promise<ProviderImport> => ({ name: "Imported", baseUrl: "https://gateway.example/v1", apiKey: "abc123", models: [{ id: "imported-model", name: "Imported model", enabled: true }] }));

  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async apiKeyStatus() { return this.keyConfigured; }
  async pickWorkspace() { this.workspace = "/Users/research/field-notes"; return this.workspace; }
  async versions() { return { boya: "0.3.0", pi: "v0.84.1" }; }
  async snapshot(): Promise<RuntimeSnapshot> {
    return { status: "offline", workspace: this.workspace, sessionId: null, model: "gpt-5.6-terra", running: false };
  }
  async start(workspace?: string): Promise<RuntimeSnapshot> {
    this.startCalls += 1;
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
  it("requires the BOYA account before workspace setup", async () => {
    const client = new FakeClient();
    client.account = null;
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "登入 BOYA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "選擇資料夾" })).not.toBeInTheDocument();
    client.account = new FakeClient().account;
    fireEvent.click(screen.getByRole("button", { name: "使用 BOYA Web 登入" }));
    expect(await screen.findByRole("heading", { name: "設定 BOYA" })).toBeInTheDocument();
  });

  it("ignores initialization failures from a replaced client", async () => {
    resetAgentStore();
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/old-workspace";
    let rejectStart!: (error: Error) => void;
    client.start = vi.fn(() => new Promise<RuntimeSnapshot>((_resolve, reject) => {
      rejectStart = reject;
    }));
    let current = true;

    const initialization = useAgentStore.getState().initialize(client, () => current);
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    current = false;
    resetAgentStore();
    rejectStart(new Error("stale client failed"));
    await initialization;

    expect(useAgentStore.getState().booting).toBe(true);
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("enters the workbench with only a workspace configured", async () => {
    const client = new FakeClient();
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "設定 BOYA" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "選擇資料夾" }));
    await screen.findByText("/Users/research/field-notes");
    fireEvent.click(screen.getByRole("button", { name: "進入 BOYA" }));

    expect(await screen.findByText("尚無對話")).toBeInTheDocument();
    expect(client.saveWorkspace).toHaveBeenCalledWith("/Users/research/field-notes");
    expect(client.startCalls).toBe(0);
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

  it("queues simultaneous approvals without losing an earlier request", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    act(() => {
      client.emit({ type: "approval.requested", approval: { requestId: "first", action: "confirm", detail: "第一個確認" } });
      client.emit({ type: "approval.requested", approval: { requestId: "second", action: "confirm", detail: "第二個確認" } });
    });

    expect(screen.getByText("第一個確認")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "允許一次" }));
    expect(await screen.findByText("第二個確認")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "拒絕" }));
    await waitFor(() => expect(client.replyApproval).toHaveBeenNthCalledWith(1, { requestId: "first", confirmed: true }));
    await waitFor(() => expect(client.replyApproval).toHaveBeenNthCalledWith(2, { requestId: "second", cancelled: true }));
  });

  it("starts Pi once under React StrictMode", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";

    render(<StrictMode><App client={client} /></StrictMode>);
    await screen.findByText("尚無對話");

    expect(client.startCalls).toBe(1);
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

  it("saves a custom endpoint with an arbitrary key and keeps settings available after key removal", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByLabelText("自訂 OpenAI 相容端點"));
    fireEvent.change(screen.getByLabelText("服務名稱"), { target: { value: "My Gateway" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example/v1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "abc123" } });
    fireEvent.change(screen.getByLabelText("新增模型 id"), { target: { value: "some-model" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));

    await waitFor(() => expect(client.saveProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ mode: "custom", baseUrl: "https://gateway.example/v1" }), "abc123"));
    expect(client.stop).toHaveBeenCalled();
    expect(client.startCalls).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByRole("button", { name: "移除 Key" }));
    await waitFor(() => expect(client.removeApiKey).toHaveBeenCalled());
    expect(await screen.findByText("API Key 已移除；請輸入新 Key 後儲存設定")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "設定 BOYA" })).not.toBeInTheDocument();
  });

  it("surfaces provider settings failures without applying optimistic state", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    client.saveProviderSettings.mockRejectedValueOnce(new Error("Keychain unavailable"));
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByLabelText("自訂 OpenAI 相容端點"));
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example/v1" } });
    fireEvent.change(screen.getByLabelText("新增模型 id"), { target: { value: "some-model" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "abc123" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));

    expect(await screen.findByText("Keychain unavailable")).toBeInTheDocument();
    expect(client.providerSettings.mode).toBe("official");
  });


  it("imports CC Switch settings, fetches models, and persists enablement", async () => {
    const client = new FakeClient();
    client.keyConfigured = true;
    client.workspace = "/Users/research/field-notes";
    render(<App client={client} />);
    await screen.findByText("尚無對話");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    fireEvent.click(screen.getByLabelText("自訂 OpenAI 相容端點"));
    fireEvent.change(screen.getByLabelText("CC Switch 連結"), { target: { value: "ccswitch://v1/import?..." } });
    fireEvent.click(screen.getByRole("button", { name: "匯入連結" }));
    expect(await screen.findByDisplayValue("https://gateway.example/v1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("abc123")).toBeInTheDocument();
    expect(screen.getByText("Imported model")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "抓取模型" }));
    expect(await screen.findByText("Fetched model")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));

    await waitFor(() => expect(client.fetchProviderModels).toHaveBeenCalledWith("https://gateway.example/v1", "abc123"));
    await waitFor(() => expect(client.saveProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ mode: "custom", models: expect.arrayContaining([expect.objectContaining({ id: "imported-model", enabled: false }), expect.objectContaining({ id: "fetched-model", enabled: true })]) }), "abc123"));
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
