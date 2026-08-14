import { useState } from "react";
import { Check, FolderOpen, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { ProviderModel, ProviderSettings, RuntimeSnapshot } from "@boya/sdk";
import type { DesktopAgentClient } from "./lib/agentClient";
import { useAgentStore } from "./lib/agentStore";

function IconButton({ label, children, onClick, disabled }: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function cloneSettings(settings: ProviderSettings): ProviderSettings {
  return { ...settings, models: settings.models.map((model) => ({ ...model })) };
}

function offlineSnapshot(snapshot: RuntimeSnapshot, workspace: string | null): RuntimeSnapshot {
  return {
    ...snapshot,
    status: "offline",
    workspace,
    sessionId: null,
    running: false,
    error: undefined,
  };
}

function mergeModels(existing: ProviderModel[], incoming: ProviderModel[]): ProviderModel[] {
  const enabledById = new Map(existing.map((model) => [model.id, model.enabled]));
  const merged = new Map(existing.map((model) => [model.id, model]));
  for (const model of incoming) {
    merged.set(model.id, { ...model, enabled: enabledById.get(model.id) ?? true });
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function ProviderSettingsPanel({ client, onClose }: { client: DesktopAgentClient; onClose: () => void }) {
  const store = useAgentStore();
  const [draft, setDraft] = useState(() => cloneSettings(store.providerSettings));
  const [apiKey, setApiKey] = useState("");
  const [importLink, setImportLink] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateDraft(patch: Partial<ProviderSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setNotice(null);
  }

  function setMode(mode: ProviderSettings["mode"]) {
    if (mode === "official") {
      updateDraft({ mode, name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [] });
      return;
    }
    updateDraft({
      mode,
      name: draft.name === "OpenAI" ? "Custom OpenAI-compatible endpoint" : draft.name,
      baseUrl: draft.baseUrl === "https://api.openai.com/v1" ? "" : draft.baseUrl,
    });
  }

  function addManualModel() {
    const id = manualModel.trim();
    if (!id) return;
    if (draft.models.some((model) => model.id === id)) {
      setError(`模型已存在：${id}`);
      return;
    }
    updateDraft({ models: [...draft.models, { id, name: id, enabled: true }] });
    setManualModel("");
  }

  function toggleModel(id: string) {
    updateDraft({ models: draft.models.map((model) => model.id === id ? { ...model, enabled: !model.enabled } : model) });
  }

  function removeModel(id: string) {
    updateDraft({ models: draft.models.filter((model) => model.id !== id) });
  }

  async function importCCSwitch() {
    if (!importLink.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const imported = await client.parseCCSwitchImport(importLink.trim());
      updateDraft({
        mode: "custom",
        name: imported.name,
        baseUrl: imported.baseUrl,
        models: mergeModels(draft.models, imported.models),
      });
      if (imported.apiKey) setApiKey(imported.apiKey);
      setNotice(imported.warning ? `${imported.warning}；已讀取設定，請確認後儲存` : "已讀取 CC Switch 設定，請檢查後儲存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels() {
    if (!draft.baseUrl.trim()) {
      setError("請先填入 Base URL");
      return;
    }
    setFetching(true);
    setError(null);
    setNotice(null);
    try {
      const incoming = await client.fetchProviderModels(draft.baseUrl.trim(), apiKey.trim() || undefined);
      setDraft((current) => ({ ...current, models: mergeModels(current.models, incoming) }));
      setNotice(`已抓取 ${incoming.length} 個模型，請確認啟用狀態`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFetching(false);
    }
  }

  async function refreshRuntime(settings: ProviderSettings, keyConfigured: boolean) {
    const current = useAgentStore.getState();
    const previousSession = current.activePath ?? undefined;
    const snapshot = offlineSnapshot(current.snapshot, current.workspace);
    useAgentStore.setState({
      providerSettings: settings,
      keyConfigured,
      configured: Boolean(current.workspace),
      snapshot,
      models: [],
      sessions: [],
      activePath: null,
      messages: [],
      streamingText: "",
      tools: [],
      approval: null,
      approvalQueue: [],
    });
    if (current.snapshot.status !== "offline") await client.stop();
    if (!current.workspace || !keyConfigured) return;
    const ready = await client.start(current.workspace, previousSession);
    try {
      const [models, sessions] = await Promise.all([client.listModels(), client.listSessions()]);
      useAgentStore.setState({ snapshot: ready, models, sessions });
      if (sessions[0]) await useAgentStore.getState().selectSession(client, sessions[0].path);
    } catch (caught) {
      await client.stop().catch(() => undefined);
      const failed = useAgentStore.getState();
      useAgentStore.setState({ snapshot: offlineSnapshot(failed.snapshot, failed.workspace), models: [], sessions: [], activePath: null, messages: [], tools: [], approval: null, approvalQueue: [] });
      throw caught;
    }
  }

  async function save() {
    if (fetching) {
      setError("模型抓取尚未完成，請稍候再儲存");
      return;
    }
    if (useAgentStore.getState().snapshot.running) {
      setError("請先停止目前回合，再修改模型服務設定");
      return;
    }
    const settings: ProviderSettings = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      models: draft.models.map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })),
    };
    if (settings.mode === "custom") {
      try {
        const url = new URL(settings.baseUrl);
        if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("Base URL 必須是有效的 http 或 https 網址");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Base URL 格式無效");
        return;
      }
      if (!settings.models.some((model) => model.enabled)) {
        setError("至少啟用一個模型後才能儲存自訂端點");
        return;
      }
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.saveProviderSettings(settings, apiKey.trim() || undefined);
      await refreshRuntime(result.settings, result.keyConfigured);
      setApiKey("");
      setImportLink("");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (useAgentStore.getState().snapshot.running) {
      setError("請先停止目前回合，再移除 API Key");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const current = useAgentStore.getState();
      if (current.snapshot.status !== "offline") await client.stop();
      await client.removeApiKey();
      useAgentStore.setState({
        keyConfigured: false,
        configured: Boolean(current.workspace),
        snapshot: offlineSnapshot(current.snapshot, current.workspace),
        sessions: [],
        activePath: null,
        messages: [],
        streamingText: "",
        tools: [],
        approval: null,
        approvalQueue: [],
      });
      setApiKey("");
      setNotice("API Key 已移除；請輸入新 Key 後儲存設定");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const selected = await client.pickWorkspace();
      if (!selected) return;
      const workspace = await client.saveWorkspace(selected);
      const current = useAgentStore.getState();
      const offline = offlineSnapshot(current.snapshot, workspace);
      useAgentStore.setState({ workspace, snapshot: offline, models: [], sessions: [], activePath: null, messages: [], tools: [], approval: null, approvalQueue: [] });
      if (current.snapshot.status !== "offline") await client.stop();
      if (!current.keyConfigured) {
        setNotice("工作資料夾已更新");
        return;
      }
      try {
        const snapshot = await client.start(workspace);
        const [models, sessions] = await Promise.all([client.listModels(), client.listSessions()]);
        useAgentStore.setState({ snapshot, models, sessions });
        if (sessions[0]) await useAgentStore.getState().selectSession(client, sessions[0].path);
      } catch (caught) {
        await client.stop().catch(() => undefined);
        useAgentStore.setState({ snapshot: offlineSnapshot(useAgentStore.getState().snapshot, workspace), models: [], sessions: [], activePath: null, messages: [], tools: [], approval: null, approvalQueue: [] });
        throw caught;
      }
      setNotice("工作資料夾已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" role="presentation"><section className="settings-panel" role="dialog" aria-modal="true" aria-label="設定">
    <header><h2>設定</h2><IconButton label="關閉設定" onClick={onClose}><X size={18} /></IconButton></header>
    <div className="settings-section provider-settings-section">
      <h3>模型服務</h3>
      <div className="provider-mode" role="radiogroup" aria-label="模型服務模式">
        <label className={draft.mode === "official" ? "selected" : ""}><input type="radio" name="provider-mode" checked={draft.mode === "official"} disabled={busy || fetching} onChange={() => setMode("official")} />官方 OpenAI</label>
        <label className={draft.mode === "custom" ? "selected" : ""}><input type="radio" name="provider-mode" checked={draft.mode === "custom"} disabled={busy || fetching} onChange={() => setMode("custom")} />自訂 OpenAI 相容端點</label>
      </div>
      {draft.mode === "custom" && <>
        <label className="field"><span>服務名稱</span><input aria-label="服務名稱" value={draft.name} disabled={busy || fetching} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
        <label className="field"><span>Base URL</span><input aria-label="Base URL" value={draft.baseUrl} disabled={busy || fetching} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" autoComplete="off" /></label>
        <label className="field"><span>CC Switch 匯入連結</span><textarea aria-label="CC Switch 連結" value={importLink} disabled={busy || fetching} onChange={(event) => setImportLink(event.target.value)} placeholder="貼上 ccswitch://v1/import..." rows={3} /></label>
        <div className="button-row"><button className="secondary-button" type="button" disabled={busy || fetching || !importLink.trim()} onClick={() => void importCCSwitch()}>匯入連結</button><button className="secondary-button" type="button" disabled={busy || fetching || !draft.baseUrl.trim()} onClick={() => void fetchModels()}>{fetching ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}抓取模型</button></div>
      </>}
      <div className="key-ready"><KeyRound size={16} /><span>{store.keyConfigured ? "API Key 已儲存在 macOS Keychain" : "尚未設定 API Key"}</span>{store.keyConfigured && <Check size={16} />}</div>
      <label className="field"><span>API Key</span><input aria-label="API Key" type="password" value={apiKey} disabled={busy || fetching} onChange={(event) => setApiKey(event.target.value)} placeholder={store.keyConfigured ? "輸入新 Key 以更新，留白則保留現有 Key" : "輸入服務提供的 API Key"} autoComplete="off" /></label>
      <div className="button-row"><button className="danger-button" type="button" disabled={busy || fetching || store.snapshot.running || !store.keyConfigured} onClick={() => void removeKey()}>移除 Key</button></div>
    </div>
    {draft.mode === "custom" && <div className="settings-section">
      <h3>模型清單</h3>
      <div className="manual-model-row"><input aria-label="新增模型 id" value={manualModel} disabled={busy || fetching} onChange={(event) => setManualModel(event.target.value)} placeholder="手動輸入 model id" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel(); } }} /><button className="secondary-button" type="button" disabled={busy || fetching || !manualModel.trim()} onClick={addManualModel}><Plus size={15} />新增</button></div>
      <div className="provider-model-list">{draft.models.length === 0 && <p className="settings-hint">尚未加入模型；可抓取上游清單或手動新增。</p>}{draft.models.map((model) => <div className={`provider-model-row ${model.enabled ? "enabled" : "disabled"}`} key={model.id}><label><input type="checkbox" checked={model.enabled} disabled={busy || fetching} onChange={() => toggleModel(model.id)} /><span><strong>{model.name}</strong><code>{model.id}</code></span></label><IconButton label={`移除模型 ${model.id}`} disabled={busy || fetching} onClick={() => removeModel(model.id)}><Trash2 size={15} /></IconButton></div>)}</div>
    </div>}
    <div className="settings-section"><h3>目前模型</h3><select aria-label="模型" value={store.snapshot.model} disabled={busy || store.snapshot.running || store.models.length === 0} onChange={(event) => { if (busy) return; const model = event.target.value; setBusy(true); setError(null); void client.setModel(model).then(() => useAgentStore.setState((state) => ({ snapshot: { ...state.snapshot, model } }))).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught))).finally(() => setBusy(false)); }}>{store.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select>{store.models.length === 0 && <p className="settings-hint">完成 API Key 與模型設定後，這裡會顯示可用模型。</p>}</div>
    <div className="settings-section"><h3>工作資料夾</h3><div className="workspace-path">{store.workspace ?? "尚未選擇"}</div><button type="button" className="secondary-button" disabled={busy || store.snapshot.running} onClick={() => void changeWorkspace()}><FolderOpen size={16} />更換資料夾</button></div>
    {(error || notice) && <div className={error ? "error-banner" : "settings-notice"}>{error || notice}</div>}
    <footer><button className="primary-button" type="button" disabled={busy || fetching || store.snapshot.running} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16} /> : null}儲存設定</button><span>BOYA {store.versions.boya}<span>Pi {store.versions.pi}</span></span></footer>
  </section></div>;
}
