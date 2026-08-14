export type RuntimeStatus = "offline" | "starting" | "ready" | "error";
export type ToolStatus = "running" | "success" | "failed" | "blocked";

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  workspace: string | null;
  sessionId: string | null;
  model: string;
  running: boolean;
  error?: string;
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  workspace: string;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ToolActivity {
  callId: string;
  tool: string;
  status: ToolStatus;
  input?: Record<string, unknown>;
  output?: string;
  partialOutput?: string;
}

export interface ApprovalRequest {
  requestId: string;
  action: "select" | "confirm";
  detail: string;
  options?: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  supportsThinking?: boolean;
}
export type ProviderMode = "official" | "custom";

export interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ProviderSettings {
  mode: ProviderMode;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
}

export interface ProviderSettingsSnapshot {
  settings: ProviderSettings;
  keyConfigured: boolean;
}

export interface ProviderImport {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: ProviderModel[];
  warning?: string;
}

export type RuntimeEvent =
  | { type: "snapshot.updated"; snapshot: RuntimeSnapshot }
  | { type: "text.delta"; contentIndex: number; delta: string }
  | { type: "message.completed"; message: ChatMessage }
  | { type: "tool.updated"; tool: ToolActivity }
  | { type: "approval.requested"; approval: ApprovalRequest }
  | { type: "runtime.settled" }
  | { type: "runtime.error"; message: string };

export type ApprovalReply =
  | { requestId: string; value: string }
  | { requestId: string; confirmed: boolean }
  | { requestId: string; cancelled: true };

export interface AgentRuntimeClient {
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  snapshot(): Promise<RuntimeSnapshot>;
  start(workspace?: string, sessionPath?: string): Promise<RuntimeSnapshot>;
  stop(): Promise<void>;
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  newSession(): Promise<void>;
  switchSession(path: string): Promise<void>;
  renameSession(path: string, title: string): Promise<void>;
  archiveSession(path: string): Promise<SessionSummary | null>;
  getMessages(): Promise<ChatMessage[]>;
  listModels(): Promise<ModelInfo[]>;
  setModel(modelId: string): Promise<void>;
  replyApproval(reply: ApprovalReply): Promise<void>;
}
