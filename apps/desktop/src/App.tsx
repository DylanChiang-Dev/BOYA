import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Send,
  Settings,
  Square,
  X,
} from "lucide-react";
import type { ApprovalReply, ApprovalRequest, SessionSummary, ToolActivity } from "@boya/sdk";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";
import { agentClient as defaultClient, type DesktopAgentClient } from "./lib/agentClient";
import { resetAgentStore, useAgentStore } from "./lib/agentStore";

interface AppProps {
  client?: DesktopAgentClient;
}

function IconButton({ label, children, onClick, disabled }: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Setup({ client }: { client: DesktopAgentClient }) {
  const store = useAgentStore();
  const [workspace, setWorkspace] = useState(store.workspace);
  const [busy, setBusy] = useState(false);

  async function chooseFolder() {
    try {
      const selected = await client.pickWorkspace();
      if (selected) setWorkspace(selected);
    } catch (error) {
      useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true);
    try {
      const savedWorkspace = await client.saveWorkspace(workspace);
      if (!store.keyConfigured) {
        useAgentStore.setState({
          configured: true,
          booting: false,
          workspace: savedWorkspace,
          snapshot: { ...store.snapshot, status: "offline", workspace: savedWorkspace, sessionId: null, running: false },
        });
        return;
      }
      const snapshot = await client.start(savedWorkspace);
      useAgentStore.setState({ configured: true, keyConfigured: true, workspace: snapshot.workspace, snapshot, booting: false });
      const [sessions, models] = await Promise.all([client.listSessions(), client.listModels()]);
      useAgentStore.setState({ sessions, models });
      if (sessions[0]) await useAgentStore.getState().selectSession(client, sessions[0].path);
    } catch (error) {
      useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-view" data-tauri-drag-region>
      <form className="setup-panel" onSubmit={submit}>
        <div className="brand-mark">B</div>
        <h1>設定 BOYA</h1>
        <p>先指定 Pi 可以工作的本機資料夾；API Key 與 Base URL 可進入後在設定中保存。</p>
        <div className="folder-field">
          <button type="button" className="secondary-button" onClick={chooseFolder}><FolderOpen size={17} />選擇資料夾</button>
          <span>{workspace ?? "尚未選擇工作資料夾"}</span>
        </div>
        <button className="primary-button" type="submit" disabled={busy || !workspace}>{busy ? <LoaderCircle className="spin" size={17} /> : null}進入 BOYA</button>
        {store.error && <div className="error-banner">{store.error}</div>}
      </form>
    </main>
  );
}

function SessionItem({ session, active, running, onSelect, onRename, onArchive }: {
  session: SessionSummary;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return <div className={`session-item ${active ? "active" : ""}`}>
    <button className="session-main" type="button" onClick={onSelect} disabled={running && !active}><span>{session.title}</span></button>
    <IconButton label="更多" onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></IconButton>
    {menu && <div className="session-menu"><button type="button" aria-label="重新命名" onClick={() => { setMenu(false); onRename(); }}><Pencil size={14} />重新命名</button><button type="button" aria-label="封存" onClick={() => { setMenu(false); onArchive(); }}><Archive size={14} />封存</button></div>}
  </div>;
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  const [expanded, setExpanded] = useState(false);
  const status = tool.status === "running" ? "執行中" : tool.status === "success" ? "完成" : tool.status === "blocked" ? "已阻擋" : "失敗";
  return <div className={`tool-row ${tool.status}`}>
    <button type="button" onClick={() => setExpanded(!expanded)} aria-label={`${tool.tool} ${status}`}>
      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<code>{tool.tool}</code><span>{status}</span>
    </button>
    {expanded && <div className="tool-detail">{tool.input && <pre>{JSON.stringify(tool.input, null, 2)}</pre>}{(tool.output || tool.partialOutput) && <pre>{tool.output || tool.partialOutput}</pre>}</div>}
  </div>;
}

function ApprovalBar({ approval, client }: { approval: ApprovalRequest; client: DesktopAgentClient }) {
  function reply(value: ApprovalReply) {
    void client.replyApproval(value)
      .then(() => useAgentStore.setState((state) => {
        const approvalQueue = state.approvalQueue.filter(
          (queued) => queued.requestId !== approval.requestId,
        );
        return { approvalQueue, approval: approvalQueue[0] ?? null };
      }))
      .catch((error) => useAgentStore.setState({
        error: error instanceof Error ? error.message : String(error),
      }));
  }

  return <div className="approval-bar" role="alertdialog" aria-label="需要確認">
    <div className="approval-copy"><strong>需要確認</strong><span>{approval.detail}</span></div>
    <div className="approval-actions">
      <button type="button" className="secondary-button" onClick={() => reply({ requestId: approval.requestId, cancelled: true })}>拒絕</button>
      {approval.action === "confirm"
        ? <button type="button" className="primary-button compact" onClick={() => reply({ requestId: approval.requestId, confirmed: true })}>允許一次</button>
        : approval.options?.map((option) => <button key={option} type="button" className="primary-button compact" onClick={() => reply({ requestId: approval.requestId, value: option })}>{option}</button>)}
    </div>
  </div>;
}


function Workbench({ client }: { client: DesktopAgentClient }) {
  const store = useAgentStore();
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState(false);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const activeSession = useMemo(() => store.sessions.find((item) => item.path === store.activePath), [store.sessions, store.activePath]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [store.messages, store.streamingText, store.tools]);

  async function createSession() {
    try {
      await client.newSession();
      useAgentStore.setState({ activePath: null, messages: [], streamingText: "", tools: [], approval: null, approvalQueue: [] });
    } catch (error) { useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || store.snapshot.running) return;
    if (store.snapshot.status !== "ready") {
      useAgentStore.setState({ error: "請先到設定配置 API Key 與模型" });
      return;
    }
    setInput("");
    useAgentStore.setState((state) => ({ messages: [...state.messages, { id: `local-${Date.now()}`, role: "user", content: text, createdAt: Date.now() }], streamingText: "", tools: [], error: null, snapshot: { ...state.snapshot, running: true } }));
    try { await client.prompt(text); } catch (error) { useAgentStore.setState((state) => ({ error: error instanceof Error ? error.message : String(error), snapshot: { ...state.snapshot, running: false } })); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="titlebar" data-tauri-drag-region><div className="brand-mark small">B</div><strong>BOYA</strong></div>
      <button type="button" className="workspace-button" disabled={store.snapshot.running} onClick={() => setSettings(true)}><FolderOpen size={16} /><span><small>工作資料夾</small>{store.workspace?.split("/").filter(Boolean).at(-1)}</span><ChevronRight size={15} /></button>
      <div className="sidebar-heading"><span>對話</span><IconButton label="新增對話" onClick={createSession} disabled={store.snapshot.running}><MessageSquarePlus size={17} /></IconButton></div>
      <div className="session-list">{store.sessions.map((session) => <SessionItem key={session.path} session={session} active={session.path === store.activePath} running={store.snapshot.running} onSelect={() => void store.selectSession(client, session.path).catch((error) => useAgentStore.setState({ error: String(error) }))} onRename={() => { setRenaming(session); setRenameValue(session.title); }} onArchive={() => void client.archiveSession(session.path).then(async (replacement) => { await store.refreshSessions(client); if (session.path === store.activePath) { if (replacement) await store.selectSession(client, replacement.path); else useAgentStore.setState({ activePath: null, messages: [], tools: [], streamingText: "" }); } }).catch((error) => useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }))} />)}{store.sessions.length === 0 && <div className="sidebar-empty">尚無對話</div>}</div>
    </aside>
    <main className="conversation">
      <header className="conversation-header" data-tauri-drag-region><div><h1>{activeSession?.title ?? "新對話"}</h1><span className={`runtime-dot ${store.snapshot.status}`} />{store.snapshot.model}</div><IconButton label="設定" onClick={() => setSettings(true)}><Settings size={18} /></IconButton></header>
      <div className="transcript">
        {store.messages.length === 0 && !store.streamingText && <div className="empty-conversation"><div className="brand-mark">B</div><h2>準備開始</h2><p>輸入你想處理的工作。Pi 只會存取目前的資料夾。</p></div>}
        {store.messages.map((message) => <article className={`message ${message.role}`} key={message.id}>{message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p>{message.content}</p>}</article>)}
        {store.streamingText && <article className="message assistant streaming"><ReactMarkdown remarkPlugins={[remarkGfm]}>{store.streamingText}</ReactMarkdown><span className="cursor" /></article>}
        {store.tools.length > 0 && <section className="tools-list">{store.tools.map((tool) => <ToolRow key={tool.callId} tool={tool} />)}</section>}
        <div ref={endRef} />
      </div>
      {store.error && <div className="runtime-error"><span>{store.error}</span><IconButton label="關閉錯誤" onClick={() => useAgentStore.setState({ error: null })}><X size={15} /></IconButton></div>}
      <form className="composer" onSubmit={submit}><textarea aria-label="訊息" value={input} onChange={(event) => setInput(event.target.value)} placeholder="傳訊息給 Pi" rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />{store.snapshot.running ? <IconButton label="停止" onClick={() => void client.abort().catch((error) => useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }))}><Square size={16} fill="currentColor" /></IconButton> : <button className="send-button" type="submit" aria-label="傳送" disabled={!input.trim()}><Send size={17} /></button>}</form>
    </main>
    {store.approval && <ApprovalBar approval={store.approval} client={client} />}
    {settings && <ProviderSettingsPanel client={client} onClose={() => setSettings(false)} />}
    {renaming && <div className="modal-backdrop"><form className="rename-dialog" onSubmit={async (event) => { event.preventDefault(); try { await client.renameSession(renaming.path, renameValue); setRenaming(null); await store.refreshSessions(client); await store.selectSession(client, renaming.path); } catch (error) { useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }); } }}><h2>重新命名對話</h2><label className="field"><span>對話名稱</span><input aria-label="對話名稱" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><div className="button-row"><button type="button" className="secondary-button" onClick={() => setRenaming(null)}>取消</button><button type="submit" className="primary-button compact">儲存名稱</button></div></form></div>}
  </div>;
}

export function App({ client = defaultClient }: AppProps) {
  const store = useAgentStore();
  const initializationRef = useRef<{ client: DesktopAgentClient; active: boolean } | null>(null);
  const effectVersionRef = useRef(0);
  useEffect(() => {
    effectVersionRef.current += 1;
    const effectVersion = effectVersionRef.current;
    const unsubscribe = client.subscribe((event) => {
      useAgentStore.getState().handleEvent(event);
      if (event.type === "runtime.settled") {
        void useAgentStore.getState().refreshSessions(client).catch((error) => useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    if (initializationRef.current?.client !== client) {
      if (initializationRef.current) initializationRef.current.active = false;
      const initialization = { client, active: true };
      initializationRef.current = initialization;
      resetAgentStore();
      void useAgentStore.getState().initialize(client, () => initialization.active)
        .catch((error) => {
          if (initialization.active) {
            useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) });
          }
        });
    }
    return () => {
      unsubscribe();
      queueMicrotask(() => {
        if (effectVersionRef.current === effectVersion && initializationRef.current?.client === client) {
          initializationRef.current.active = false;
        }
      });
    };
  }, [client]);
  if (store.booting) return <div className="boot-screen"><LoaderCircle className="spin" size={22} />正在啟動 Pi</div>;
  return store.configured ? <Workbench client={client} /> : <Setup client={client} />;
}
