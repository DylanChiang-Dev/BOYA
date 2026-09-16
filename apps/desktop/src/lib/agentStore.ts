import { create } from "zustand";
import type {
  ApprovalRequest,
  ChatMessage,
  DesktopAuthSnapshot,
  ModelInfo,
  ProviderSettings,
  RuntimeEvent,
  RuntimeSnapshot,
  SessionSummary,
  ToolActivity,
} from "@boya/sdk";
import type { DesktopAgentClient } from "./agentClient";

interface AgentStore {
  booting: boolean;
  account: DesktopAuthSnapshot | null;
  configured: boolean;
  keyConfigured: boolean;
  providerSettings: ProviderSettings;
  workspace: string | null;
  snapshot: RuntimeSnapshot;
  sessions: SessionSummary[];
  activePath: string | null;
  messages: ChatMessage[];
  streamingText: string;
  tools: ToolActivity[];
  approval: ApprovalRequest | null;
  approvalQueue: ApprovalRequest[];
  models: ModelInfo[];
  versions: { boya: string; pi: string };
  error: string | null;
  login(client: DesktopAgentClient): Promise<void>;
  logout(client: DesktopAgentClient): Promise<void>;
  initialize(client: DesktopAgentClient, isCurrent?: () => boolean): Promise<void>;
  handleEvent(event: RuntimeEvent): void;
  refreshSessions(client: DesktopAgentClient): Promise<void>;
  selectSession(client: DesktopAgentClient, path: string): Promise<void>;
}

const initialSnapshot: RuntimeSnapshot = {
  status: "offline",
  workspace: null,
  sessionId: null,
  model: "gpt-5.6-terra",
  running: false,
};
const initialProviderSettings: ProviderSettings = {
  mode: "official",
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  models: [],
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  booting: true,
  account: null,
  configured: false,
  keyConfigured: false,
  providerSettings: initialProviderSettings,
  workspace: null,
  snapshot: initialSnapshot,
  sessions: [],
  activePath: null,
  messages: [],
  streamingText: "",
  tools: [],
  approval: null,
  approvalQueue: [],
  models: [],
  versions: { boya: "0.3.0", pi: "v0.84.1" },
  error: null,

  async login(client) {
    set({ booting: true, error: null });
    try {
      const account = await client.login();
      set({ account });
      await get().initialize(client);
    } catch (error) {
      set({ booting: false, account: null, error: error instanceof Error ? error.message : String(error) });
    }
  },

  async logout(client) {
    await client.stop().catch(() => {});
    await client.logout();
    resetAgentStore();
  },

  async initialize(client, isCurrent = () => true) {
    try {
      const account = await client.getAccount();
      if (!isCurrent()) return;
      set({ account });
      if (!account) {
        set({ configured: false, booting: false });
        return;
      }
      const [provider, snapshot, versions] = await Promise.all([
        client.getProviderSettings(),
        client.snapshot(),
        client.versions(),
      ]);
      if (!isCurrent()) return;
      const workspace = snapshot.workspace;
      set({
        keyConfigured: provider.keyConfigured,
        providerSettings: provider.settings,
        snapshot,
        workspace,
        versions,
      });
      if (!workspace) {
        set({ configured: false, booting: false });
        return;
      }
      if (!provider.keyConfigured) {
        set({ configured: true, booting: false });
        return;
      }
      const ready = await client.start(workspace);
      if (!isCurrent()) {
        await client.stop();
        return;
      }
      const [sessions, models] = await Promise.all([client.listSessions(), client.listModels()]);
      if (!isCurrent()) {
        await client.stop();
        return;
      }
      set({ configured: true, booting: false, snapshot: ready, sessions, models });
      if (sessions[0]) await get().selectSession(client, sessions[0].path);
    } catch (error) {
      if (!isCurrent()) return;
      set({ booting: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  handleEvent(event) {
    if (event.type === "snapshot.updated") {
      set({ snapshot: event.snapshot, workspace: event.snapshot.workspace });
    } else if (event.type === "text.delta") {
      set((state) => ({ streamingText: state.streamingText + event.delta }));
    } else if (event.type === "message.completed") {
      set((state) => ({
        messages: [
          ...state.messages.filter((message) => {
            if (message.id === event.message.id) return false;
            return !(
              event.message.role === "user"
              && message.role === "user"
              && message.id.startsWith("local-")
              && message.content === event.message.content
            );
          }),
          event.message,
        ],
        streamingText: "",
      }));
    } else if (event.type === "tool.updated") {
      set((state) => {
        const previous = state.tools.find((tool) => tool.callId === event.tool.callId);
        return {
          tools: [
            ...state.tools.filter((tool) => tool.callId !== event.tool.callId),
            { ...previous, ...event.tool },
          ],
        };
      });
    } else if (event.type === "approval.requested") {
      set((state) => {
        const approvalQueue = state.approvalQueue.some(
          (approval) => approval.requestId === event.approval.requestId,
        )
          ? state.approvalQueue
          : [...state.approvalQueue, event.approval];
        return { approvalQueue, approval: approvalQueue[0] ?? null };
      });
    } else if (event.type === "runtime.settled") {
      set((state) => ({ snapshot: { ...state.snapshot, running: false } }));
    } else if (event.type === "runtime.error") {
      set({ error: event.message });
    }
  },

  async refreshSessions(client) {
    const sessions = await client.listSessions();
    const state = get();
    const activePath = state.activePath
      ?? sessions.find((session) => session.id === state.snapshot.sessionId)?.path
      ?? null;
    set({ sessions, activePath });
  },

  async selectSession(client, path) {
    if (get().snapshot.running) throw new Error("請先停止目前回合");
    await client.switchSession(path);
    const messages = await client.getMessages();
    set({ activePath: path, messages, streamingText: "", tools: [], approval: null, approvalQueue: [] });
  },
}));

export function resetAgentStore() {
  useAgentStore.setState({
    booting: true,
    account: null,
    configured: false,
    keyConfigured: false,
    providerSettings: initialProviderSettings,
    workspace: null,
    snapshot: initialSnapshot,
    sessions: [],
    activePath: null,
    messages: [],
    streamingText: "",
    tools: [],
    approval: null,
    approvalQueue: [],
    models: [],
    versions: { boya: "0.3.0", pi: "v0.84.1" },
    error: null,
  });
}
