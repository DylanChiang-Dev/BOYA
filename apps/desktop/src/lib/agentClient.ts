import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentRuntimeClient,
  ApprovalReply,
  ChatMessage,
  ModelInfo,
  RuntimeEvent,
  RuntimeSnapshot,
  SessionSummary,
} from "@boya/sdk";

export interface DesktopAgentClient extends AgentRuntimeClient {
  apiKeyStatus(): Promise<boolean>;
  setApiKey(key: string): Promise<void>;
  removeApiKey(): Promise<void>;
  pickWorkspace(): Promise<string | null>;
  versions(): Promise<{ boya: string; pi: string }>;
}

export class TauriAgentClient implements DesktopAgentClient {
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RuntimeEvent>("agent-runtime-event", (event) => listener(event.payload))
      .then((release) => {
        if (disposed) release();
        else unlisten = release;
      })
      .catch(() => listener({ type: "runtime.error", message: "無法連接 Pi runtime 事件通道" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }

  apiKeyStatus() { return invoke<boolean>("agent_api_key_status"); }
  setApiKey(key: string) { return invoke<void>("agent_set_api_key", { key }); }
  removeApiKey() { return invoke<void>("agent_remove_api_key"); }
  pickWorkspace() { return invoke<string | null>("agent_pick_workspace"); }
  versions() { return invoke<{ boya: string; pi: string }>("agent_versions"); }
  snapshot() { return invoke<RuntimeSnapshot>("agent_snapshot"); }
  start(workspace?: string, sessionPath?: string) {
    return invoke<RuntimeSnapshot>("agent_start", { workspace, sessionPath });
  }
  stop() { return invoke<void>("agent_stop"); }
  prompt(message: string) { return invoke<void>("agent_prompt", { message }); }
  abort() { return invoke<void>("agent_abort"); }
  listSessions() { return invoke<SessionSummary[]>("agent_list_sessions"); }
  newSession() { return invoke<void>("agent_new_session"); }
  switchSession(path: string) { return invoke<void>("agent_switch_session", { path }); }
  renameSession(path: string, title: string) {
    return invoke<void>("agent_rename_session", { path, title });
  }
  archiveSession(path: string) { return invoke<SessionSummary | null>("agent_archive_session", { path }); }
  getMessages() { return invoke<ChatMessage[]>("agent_get_messages"); }
  listModels() { return invoke<ModelInfo[]>("agent_list_models"); }
  setModel(modelId: string) { return invoke<void>("agent_set_model", { modelId }); }
  replyApproval(reply: ApprovalReply) { return invoke<void>("agent_reply_approval", { reply }); }
}

export const agentClient = new TauriAgentClient();
