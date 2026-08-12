use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const SENSITIVE_NAMES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub workspace: String,
    pub updated_at: u64,
}

pub fn canonical_workspace(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("Workspace must be an absolute path".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot open workspace: {error}"))?;
    if !canonical.is_dir() {
        return Err("Workspace must be a directory".into());
    }
    Ok(canonical)
}

fn has_sensitive_component(path: &Path) -> bool {
    path.components().any(|component| {
        let Component::Normal(name) = component else {
            return false;
        };
        let name = name.to_string_lossy();
        name == ".git"
            || name == ".ssh"
            || name == ".gnupg"
            || SENSITIVE_NAMES.contains(&name.as_ref())
            || name.starts_with(".env.")
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn validate_workspace_path(
    workspace: &Path,
    requested: &str,
    allow_missing_leaf: bool,
) -> Result<PathBuf, String> {
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("Invalid workspace: {error}"))?;
    let relative = Path::new(requested);
    if relative.is_absolute() || has_sensitive_component(relative) {
        return Err("Path is outside the allowed workspace boundary".into());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Parent traversal is not allowed".into());
    }

    let candidate = workspace.join(relative);
    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|error| format!("Cannot resolve path: {error}"))?
    } else if allow_missing_leaf {
        let mut ancestor = candidate.as_path();
        let mut suffix = Vec::new();
        while !ancestor.exists() {
            let name = ancestor
                .file_name()
                .ok_or_else(|| "Cannot resolve target parent".to_string())?;
            suffix.push(name.to_os_string());
            ancestor = ancestor
                .parent()
                .ok_or_else(|| "Cannot resolve target parent".to_string())?;
        }
        let mut resolved = ancestor
            .canonicalize()
            .map_err(|error| format!("Cannot resolve target parent: {error}"))?;
        for component in suffix.iter().rev() {
            resolved.push(component);
        }
        resolved
    } else {
        return Err("Path does not exist".into());
    };

    if !resolved.starts_with(&workspace) {
        return Err("Resolved path escapes the workspace".into());
    }
    Ok(resolved)
}

pub fn runtime_sandbox_profile(workspace: &Path, private: &Path, package: &Path) -> String {
    let _ = (workspace, private, package);
    r#"(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow file-read*)
(deny file-read* (subpath (param "USER_HOME")))
(allow file-read* (subpath (param "PACKAGE")) (literal (param "EXTENSION")) (subpath (param "WORKSPACE")) (subpath (param "PRIVATE")))
(allow file-write* (subpath (param "WORKSPACE")) (subpath (param "PRIVATE")))
(allow network-outbound)
(allow sysctl-read)
(allow mach-lookup)
"#
    .to_owned()
}

pub fn shell_sandbox_profile(workspace: &Path) -> String {
    let _ = workspace;
    r##"(version 1)
(deny default)
(deny network*)
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath (param "WORKSPACE")))
(allow file-write* (subpath (param "WORKSPACE")))
(deny file-read* (subpath (string-append (param "WORKSPACE") "/.git")) (regex #".*\.env(\..*)?$"))
(deny file-write* (subpath (string-append (param "WORKSPACE") "/.git")) (regex #".*\.env(\..*)?$"))
(allow sysctl-read)
(allow mach-lookup)
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.trustd.agent"))
"##
    .to_owned()
}

fn message_text(message: &Value) -> Option<String> {
    let content = message.get("content")?.as_array()?;
    let text = content
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<String>();
    (!text.trim().is_empty()).then_some(text)
}

fn default_session_title(value: &str) -> String {
    let first_line = value.lines().next().unwrap_or_default().trim();
    let mut title = first_line.chars().take(52).collect::<String>();
    if first_line.chars().count() > 52 {
        title.push_str("...");
    }
    if title.is_empty() {
        "New session".into()
    } else {
        title
    }
}

pub fn parse_session_summary(path: &Path) -> Result<SessionSummary, String> {
    let file = fs::File::open(path).map_err(|error| format!("Cannot read session: {error}"))?;
    let mut id = None;
    let mut workspace = None;
    let mut first_prompt = None;
    let mut explicit_name = None;

    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| format!("Cannot read session: {error}"))?;
        let frame: Value = serde_json::from_str(&line)
            .map_err(|error| format!("Invalid session JSONL: {error}"))?;
        match frame.get("type").and_then(Value::as_str) {
            Some("session") => {
                id = frame.get("id").and_then(Value::as_str).map(str::to_owned);
                workspace = frame.get("cwd").and_then(Value::as_str).map(str::to_owned);
            }
            Some("message") if first_prompt.is_none() => {
                let message = frame.get("message").unwrap_or(&Value::Null);
                if message.get("role").and_then(Value::as_str) == Some("user") {
                    first_prompt = message_text(message);
                }
            }
            Some("session_info") => {
                if let Some(name) = frame.get("name").and_then(Value::as_str) {
                    explicit_name = Some(name.to_owned());
                }
            }
            _ => {}
        }
    }

    let metadata = fs::metadata(path).map_err(|error| format!("Cannot stat session: {error}"))?;
    let updated_at = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let title = explicit_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| default_session_title(first_prompt.as_deref().unwrap_or_default()));

    Ok(SessionSummary {
        id: id.ok_or_else(|| "Session header is missing an id".to_string())?,
        path: path.to_string_lossy().into_owned(),
        title,
        workspace: workspace.ok_or_else(|| "Session header is missing a workspace".to_string())?,
        updated_at,
    })
}

pub fn archive_session_file(path: &Path, archive_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(archive_dir).map_err(|error| format!("Cannot create archive: {error}"))?;
    let name = path
        .file_name()
        .ok_or_else(|| "Session path has no file name".to_string())?;
    let mut destination = archive_dir.join(name);
    if destination.exists() {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("session");
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("jsonl");
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        destination = archive_dir.join(format!("{stem}-{nonce}.{extension}"));
    }
    fs::rename(path, &destination).map_err(|error| format!("Cannot archive session: {error}"))?;
    Ok(destination)
}

pub fn sanitize_runtime_text(text: &str, secret: Option<&str>) -> String {
    let mut clean = text.to_owned();
    if let Some(secret) = secret.filter(|value| !value.is_empty()) {
        clean = clean.replace(secret, "[REDACTED]");
    }
    for marker in ["Authorization: Bearer ", "authorization: bearer "] {
        let mut cursor = 0;
        while let Some(relative_start) = clean[cursor..].find(marker) {
            let start = cursor + relative_start;
            let value_start = start + marker.len();
            if clean[value_start..].starts_with("[REDACTED]") {
                cursor = value_start + "[REDACTED]".len();
                continue;
            }
            let value_end = clean[value_start..]
                .find(char::is_whitespace)
                .map(|offset| value_start + offset)
                .unwrap_or(clean.len());
            clean.replace_range(value_start..value_end, "[REDACTED]");
            cursor = value_start + "[REDACTED]".len();
        }
    }
    for marker in ["OPENAI_API_KEY=", "openai_api_key="] {
        let mut cursor = 0;
        while let Some(relative_start) = clean[cursor..].find(marker) {
            let start = cursor + relative_start;
            let value_start = start + marker.len();
            if clean[value_start..].starts_with("[REDACTED]") {
                cursor = value_start + "[REDACTED]".len();
                continue;
            }
            let value_end = clean[value_start..]
                .find(char::is_whitespace)
                .map(|offset| value_start + offset)
                .unwrap_or(clean.len());
            clean.replace_range(value_start..value_end, "[REDACTED]");
            cursor = value_start + "[REDACTED]".len();
        }
    }
    clean
}

const EVENT_CHANNEL: &str = "agent-runtime-event";
const KEYCHAIN_SERVICE: &str = "dev.dylanchiang.boya.openai";
const KEYCHAIN_ACCOUNT: &str = "openai";
const DEFAULT_MODEL: &str = "gpt-5.6-terra";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    status: String,
    workspace: Option<String>,
    session_id: Option<String>,
    model: String,
    running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Default for RuntimeSnapshot {
    fn default() -> Self {
        Self {
            status: "offline".into(),
            workspace: None,
            session_id: None,
            model: DEFAULT_MODEL.into(),
            running: false,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    id: String,
    role: String,
    content: String,
    created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    name: String,
    context_window: Option<u64>,
    supports_thinking: Option<bool>,
}

#[derive(Debug, Clone)]
struct RuntimeConfig {
    workspace: PathBuf,
    private_dir: PathBuf,
    sessions_dir: PathBuf,
    pi_binary: PathBuf,
    extension: PathBuf,
    model: String,
    session_path: Option<PathBuf>,
}

struct RuntimeProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>,
}

struct RuntimeInner {
    snapshot: RuntimeSnapshot,
    process: Option<RuntimeProcess>,
    config: Option<RuntimeConfig>,
    desired_running: bool,
    restart_count: u8,
    generation: u64,
    request_sequence: u64,
}

impl Default for RuntimeInner {
    fn default() -> Self {
        Self {
            snapshot: RuntimeSnapshot::default(),
            process: None,
            config: None,
            desired_running: false,
            restart_count: 0,
            generation: 0,
            request_sequence: 0,
        }
    }
}

#[derive(Default)]
pub struct AgentRuntimeState {
    inner: Arc<Mutex<RuntimeInner>>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| "Runtime state is unavailable".into())
}

fn emit_snapshot(app: &AppHandle, snapshot: &RuntimeSnapshot) {
    let _ = app.emit(
        EVENT_CHANNEL,
        serde_json::json!({ "type": "snapshot.updated", "snapshot": snapshot }),
    );
}

fn app_private_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("pi-runtime"))
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))
}

fn user_home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Cannot resolve the user home directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Cannot resolve the user home directory: {error}"))
}

fn preference_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("boya.json"))
        .map_err(|error| format!("Cannot resolve app config directory: {error}"))
}

fn read_preferences(app: &AppHandle) -> Value {
    preference_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn update_preferences(app: &AppHandle, key: &str, value: Value) -> Result<(), String> {
    let path = preference_path(app)?;
    let mut preferences = read_preferences(app);
    preferences[key] = value;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid preferences path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create config directory: {error}"))?;
    fs::write(
        path,
        serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot save preferences: {error}"))
}

fn locate_resource(app: &AppHandle, names: &[&str]) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve resources: {error}"))?;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for name in names {
        for candidate in [resource_dir.join(name), manifest_dir.join(name)] {
            if candidate.exists() {
                return candidate.canonicalize().map_err(|error| error.to_string());
            }
        }
    }
    Err(format!(
        "Required runtime resource is missing: {}",
        names[0]
    ))
}

fn write_runtime_files(config: &RuntimeConfig) -> Result<(PathBuf, PathBuf), String> {
    fs::create_dir_all(&config.private_dir)
        .map_err(|error| format!("Cannot create Pi private directory: {error}"))?;
    fs::create_dir_all(&config.sessions_dir)
        .map_err(|error| format!("Cannot create session directory: {error}"))?;
    let auth = serde_json::json!({
        "openai": {
            "type": "api_key",
            "key": format!("!/usr/bin/security find-generic-password -s {KEYCHAIN_SERVICE} -a {KEYCHAIN_ACCOUNT} -w")
        }
    });
    let settings = serde_json::json!({
        "defaultProvider": "openai",
        "defaultModel": config.model,
        "defaultProjectTrust": "never",
        "enableInstallTelemetry": false,
        "enableAnalytics": false,
        "retry": { "enabled": false, "provider": { "maxRetries": 0 } }
    });
    fs::write(
        config.private_dir.join("auth.json"),
        serde_json::to_vec_pretty(&auth).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write Pi auth config: {error}"))?;
    fs::write(
        config.private_dir.join("settings.json"),
        serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write Pi settings: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            config.private_dir.join("auth.json"),
            fs::Permissions::from_mode(0o600),
        )
        .map_err(|error| format!("Cannot secure Pi auth config: {error}"))?;
    }

    let runtime_profile = config.private_dir.join("runtime.sb");
    let shell_profile = config.private_dir.join("shell.sb");
    let package = config
        .pi_binary
        .parent()
        .ok_or_else(|| "Invalid Pi binary path".to_string())?;
    fs::write(
        &runtime_profile,
        runtime_sandbox_profile(&config.workspace, &config.private_dir, package),
    )
    .map_err(|error| format!("Cannot write runtime sandbox: {error}"))?;
    fs::write(&shell_profile, shell_sandbox_profile(&config.workspace))
        .map_err(|error| format!("Cannot write shell sandbox: {error}"))?;
    Ok((runtime_profile, shell_profile))
}

fn state_session(response: &Value) -> Result<(String, PathBuf), String> {
    let id = response
        .pointer("/data/sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Pi state is missing the session id".to_string())?;
    let path = response
        .pointer("/data/sessionFile")
        .and_then(Value::as_str)
        .ok_or_else(|| "Pi state is missing the session file".to_string())?;
    Ok((id.to_owned(), PathBuf::from(path)))
}

fn validate_session_path(sessions_dir: &Path, path: &Path) -> Result<PathBuf, String> {
    let sessions_dir = sessions_dir
        .canonicalize()
        .map_err(|error| format!("Cannot resolve BOYA session storage: {error}"))?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve session: {error}"))?;
    if !path.starts_with(&sessions_dir) || path.starts_with(sessions_dir.join("archive")) {
        return Err("Session is outside active BOYA session storage".into());
    }
    Ok(path)
}

fn normalize_message(frame: &Value) -> Option<Value> {
    let message = frame.get("message")?;
    let role = message.get("role")?.as_str()?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let content = message_text(message)?;
    let created_at = message
        .get("timestamp")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        });
    Some(serde_json::json!({
        "type": "message.completed",
        "message": {
            "id": frame.get("id").and_then(Value::as_str).unwrap_or("pi-message"),
            "role": role,
            "content": content,
            "createdAt": created_at
        }
    }))
}

fn normalized_event(frame: &Value) -> Option<Value> {
    match frame.get("type").and_then(Value::as_str)? {
        "message_update" => {
            let update = frame.get("assistantMessageEvent")?;
            (update.get("type").and_then(Value::as_str) == Some("text_delta")).then(|| {
                serde_json::json!({
                    "type": "text.delta",
                    "contentIndex": update.get("contentIndex").and_then(Value::as_u64).unwrap_or(0),
                    "delta": update.get("delta").and_then(Value::as_str).unwrap_or_default()
                })
            })
        }
        "message_end" => normalize_message(frame),
        "tool_execution_start" => Some(serde_json::json!({
            "type": "tool.updated",
            "tool": {
                "callId": frame.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
                "tool": frame.get("toolName").and_then(Value::as_str).unwrap_or("tool"),
                "status": "running",
                "input": frame.get("args").cloned().unwrap_or(Value::Null)
            }
        })),
        "tool_execution_update" => Some(serde_json::json!({
            "type": "tool.updated",
            "tool": {
                "callId": frame.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
                "tool": frame.get("toolName").and_then(Value::as_str).unwrap_or("tool"),
                "status": "running",
                "partialOutput": frame.get("partialResult").and_then(message_text).unwrap_or_default()
            }
        })),
        "tool_execution_end" => Some(serde_json::json!({
            "type": "tool.updated",
            "tool": {
                "callId": frame.get("toolCallId").and_then(Value::as_str).unwrap_or_default(),
                "tool": frame.get("toolName").and_then(Value::as_str).unwrap_or("tool"),
                "status": if frame.get("isError").and_then(Value::as_bool).unwrap_or(false) { "failed" } else { "success" },
                "output": frame.get("result").and_then(message_text).unwrap_or_default()
            }
        })),
        "extension_ui_request" => match frame.get("method").and_then(Value::as_str) {
            Some("select" | "confirm") => Some(serde_json::json!({
                "type": "approval.requested",
                "approval": {
                    "requestId": frame.get("id").and_then(Value::as_str).unwrap_or_default(),
                    "action": frame.get("method").and_then(Value::as_str).unwrap_or("confirm"),
                    "detail": frame.get("title").or_else(|| frame.get("message")).and_then(Value::as_str).unwrap_or("Approval required"),
                    "options": frame.get("options").cloned().unwrap_or(Value::Null)
                }
            })),
            _ => None,
        },
        "agent_settled" => Some(serde_json::json!({ "type": "runtime.settled" })),
        "extension_error" => Some(serde_json::json!({
            "type": "runtime.error",
            "message": sanitize_runtime_text(frame.get("error").and_then(Value::as_str).unwrap_or("Extension error"), None)
        })),
        _ => None,
    }
}

fn handle_stdout(
    app: AppHandle,
    state: Arc<Mutex<RuntimeInner>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>,
    stdout: impl Read,
    generation: u64,
) {
    let mut reader = BufReader::new(stdout);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) => break,
            Ok(_) => {
                if bytes.last() == Some(&b'\n') {
                    bytes.pop();
                }
                if bytes.last() == Some(&b'\r') {
                    bytes.pop();
                }
                let Ok(frame) = serde_json::from_slice::<Value>(&bytes) else {
                    let _ = app.emit(
                        EVENT_CHANNEL,
                        serde_json::json!({ "type": "runtime.error", "message": "Invalid JSONL frame from Pi" }),
                    );
                    continue;
                };
                if frame.get("type").and_then(Value::as_str) == Some("response") {
                    if let Some(id) = frame.get("id").and_then(Value::as_str) {
                        if let Ok(mut requests) = pending.lock() {
                            if let Some(sender) = requests.remove(id) {
                                let result = if frame.get("success").and_then(Value::as_bool)
                                    == Some(true)
                                {
                                    Ok(frame)
                                } else {
                                    Err(frame
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Pi command failed")
                                        .to_owned())
                                };
                                let _ = sender.send(result);
                            }
                        }
                    }
                    continue;
                }
                if frame.get("type").and_then(Value::as_str) == Some("agent_start") {
                    if let Ok(mut inner) = state.lock() {
                        if inner.generation == generation {
                            inner.snapshot.running = true;
                            let snapshot = inner.snapshot.clone();
                            drop(inner);
                            emit_snapshot(&app, &snapshot);
                        }
                    }
                }
                if frame.get("type").and_then(Value::as_str) == Some("agent_settled") {
                    if let Ok(mut inner) = state.lock() {
                        if inner.generation == generation {
                            inner.snapshot.running = false;
                            let snapshot = inner.snapshot.clone();
                            drop(inner);
                            emit_snapshot(&app, &snapshot);
                        }
                    }
                }
                if let Some(event) = normalized_event(&frame) {
                    let _ = app.emit(EVENT_CHANNEL, event);
                }
            }
            Err(_) => break,
        }
    }

    let mut should_restart = false;
    if let Ok(mut inner) = state.lock() {
        if inner.generation == generation && inner.desired_running {
            inner.process = None;
            inner.snapshot.running = false;
            if inner.restart_count == 0 {
                inner.restart_count = 1;
                inner.snapshot.status = "starting".into();
                inner.snapshot.error = Some("Pi exited unexpectedly; restarting once".into());
                should_restart = true;
            } else {
                inner.snapshot.status = "error".into();
                inner.snapshot.error = Some("Pi exited unexpectedly".into());
            }
            emit_snapshot(&app, &inner.snapshot);
        }
    }
    if should_restart {
        thread::sleep(Duration::from_millis(250));
        let restart = spawn_saved_runtime(&app, &state).and_then(|_| {
            rpc_request_inner(&state, serde_json::json!({ "type": "get_state" })).and_then(
                |response| {
                    let (session_id, _) = state_session(&response)?;
                    let mut inner = lock(&state)?;
                    inner.snapshot.status = "ready".into();
                    inner.snapshot.session_id = Some(session_id);
                    inner.snapshot.error = None;
                    emit_snapshot(&app, &inner.snapshot);
                    Ok(())
                },
            )
        });
        if let Err(error) = restart {
            if let Ok(mut inner) = state.lock() {
                inner.snapshot.status = "error".into();
                inner.snapshot.error = Some(error.clone());
                emit_snapshot(&app, &inner.snapshot);
            }
            let _ = app.emit(
                EVENT_CHANNEL,
                serde_json::json!({ "type": "runtime.error", "message": error }),
            );
        }
    }
}

fn handle_stderr(app: AppHandle, stderr: impl Read) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        let clean = sanitize_runtime_text(&line, None);
        if !clean.trim().is_empty() {
            let _ = app.emit(
                EVENT_CHANNEL,
                serde_json::json!({ "type": "runtime.error", "message": clean }),
            );
        }
    }
}

fn spawn_saved_runtime(app: &AppHandle, state: &Arc<Mutex<RuntimeInner>>) -> Result<(), String> {
    let config = lock(state)?
        .config
        .clone()
        .ok_or_else(|| "Runtime is not configured".to_string())?;
    let (runtime_profile, shell_profile) = write_runtime_files(&config)?;
    if !Path::new("/usr/bin/sandbox-exec").exists() {
        return Err("macOS sandbox-exec is unavailable".into());
    }
    let package = config
        .pi_binary
        .parent()
        .ok_or_else(|| "Invalid Pi binary path".to_string())?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .arg("-f")
        .arg(runtime_profile)
        .arg("-D")
        .arg(format!("WORKSPACE={}", config.workspace.display()))
        .arg("-D")
        .arg(format!("PRIVATE={}", config.private_dir.display()))
        .arg("-D")
        .arg(format!("PACKAGE={}", package.display()))
        .arg("-D")
        .arg(format!("EXTENSION={}", config.extension.display()))
        .arg("-D")
        .arg(format!("USER_HOME={}", user_home()?.display()))
        .arg(&config.pi_binary)
        .args([
            "--mode",
            "rpc",
            "--provider",
            "openai",
            "--model",
            &config.model,
            "--models",
            "openai/*",
            "--session-dir",
        ])
        .arg(&config.sessions_dir)
        .args([
            "--tools",
            "read,bash,edit,write,grep,find,ls",
            "--no-extensions",
            "--extension",
        ])
        .arg(&config.extension)
        .args([
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
            "--no-context-files",
            "--no-approve",
            "--offline",
        ]);
    if let Some(session) = &config.session_path {
        command.arg("--session").arg(session);
    }
    command
        .current_dir(&config.workspace)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", &config.private_dir)
        .env("TMPDIR", std::env::temp_dir())
        .env("LANG", "en_US.UTF-8")
        .env("PI_CODING_AGENT_DIR", &config.private_dir)
        .env("PI_CODING_AGENT_SESSION_DIR", &config.sessions_dir)
        .env("PI_OFFLINE", "1")
        .env("PI_SKIP_VERSION_CHECK", "1")
        .env("PI_TELEMETRY", "0")
        .env("BOYA_WORKSPACE", &config.workspace)
        .env("BOYA_SHELL_SANDBOX", shell_profile)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start bundled Pi: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Pi stdin is unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Pi stdout is unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Pi stderr is unavailable".to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));

    let generation = {
        let mut inner = lock(state)?;
        inner.generation += 1;
        inner.snapshot.status = "ready".into();
        inner.snapshot.workspace = Some(config.workspace.to_string_lossy().into_owned());
        inner.snapshot.model = config.model.clone();
        inner.snapshot.error = None;
        inner.process = Some(RuntimeProcess {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            pending: pending.clone(),
        });
        emit_snapshot(app, &inner.snapshot);
        inner.generation
    };
    let app_stdout = app.clone();
    let state_stdout = state.clone();
    thread::spawn(move || handle_stdout(app_stdout, state_stdout, pending, stdout, generation));
    let app_stderr = app.clone();
    thread::spawn(move || handle_stderr(app_stderr, stderr));
    Ok(())
}

fn rpc_request(state: &AgentRuntimeState, command: Value) -> Result<Value, String> {
    rpc_request_inner(&state.inner, command)
}

fn rpc_request_inner(state: &Arc<Mutex<RuntimeInner>>, command: Value) -> Result<Value, String> {
    let (id, stdin, pending) = {
        let mut inner = lock(state)?;
        inner.request_sequence += 1;
        let id = format!("boya-{}", inner.request_sequence);
        let process = inner
            .process
            .as_ref()
            .ok_or_else(|| "Pi runtime is not running".to_string())?;
        (id, process.stdin.clone(), process.pending.clone())
    };
    let mut frame = command;
    frame["id"] = Value::String(id.clone());
    let (sender, receiver) = mpsc::channel();
    lock(&pending)?.insert(id.clone(), sender);
    let bytes = serde_json::to_vec(&frame).map_err(|error| error.to_string())?;
    if let Err(error) = lock(&stdin).and_then(|mut input| {
        input.write_all(&bytes).map_err(|error| error.to_string())?;
        input.write_all(b"\n").map_err(|error| error.to_string())?;
        input.flush().map_err(|error| error.to_string())
    }) {
        lock(&pending)?.remove(&id);
        return Err(format!("Cannot write Pi RPC request: {error}"));
    }
    receiver
        .recv_timeout(Duration::from_secs(20))
        .map_err(|_| "Pi RPC request timed out".to_string())?
}

fn stop_process(state: &AgentRuntimeState) -> Result<(), String> {
    let process = {
        let mut inner = lock(&state.inner)?;
        inner.desired_running = false;
        inner.snapshot.status = "offline".into();
        inner.snapshot.running = false;
        inner.snapshot.session_id = None;
        inner.process.take()
    };
    if let Some(process) = process {
        if let Ok(mut child) = process.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut pending) = process.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err("Pi runtime stopped".into()));
            }
        }
    }
    Ok(())
}

fn session_files(root: &Path, output: &mut Vec<PathBuf>, depth: usize) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.file_name().and_then(|name| name.to_str()) != Some("archive") {
            session_files(&path, output, depth + 1);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            output.push(path);
        }
    }
}

#[cfg(target_os = "macos")]
fn keychain_get() -> Result<Option<String>, String> {
    use security_framework_sys::base::errSecItemNotFound;

    match security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Keychain value is not valid UTF-8".into()),
        Err(error) if error.code() == errSecItemNotFound => Ok(None),
        Err(error) => Err(format!("Cannot read API Key from Keychain: {error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_get() -> Result<Option<String>, String> {
    Err("BOYA Desktop 0.2 only supports macOS".into())
}

#[tauri::command]
pub fn agent_api_key_status() -> Result<bool, String> {
    Ok(keychain_get()?.is_some())
}

#[tauri::command]
pub fn agent_set_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.len() < 12 || !trimmed.starts_with("sk-") {
        return Err("OpenAI API Key format is invalid".into());
    }
    #[cfg(target_os = "macos")]
    security_framework::passwords::set_generic_password(
        KEYCHAIN_SERVICE,
        KEYCHAIN_ACCOUNT,
        trimmed.as_bytes(),
    )
    .map_err(|error| format!("Cannot save API Key to Keychain: {error}"))?;
    #[cfg(not(target_os = "macos"))]
    return Err("BOYA Desktop 0.2 only supports macOS".into());
    Ok(())
}

#[tauri::command]
pub fn agent_remove_api_key() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = security_framework::passwords::delete_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
        );
    }
    #[cfg(not(target_os = "macos"))]
    return Err("BOYA Desktop 0.2 only supports macOS".into());
    Ok(())
}

#[tauri::command]
pub fn agent_snapshot(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
) -> Result<RuntimeSnapshot, String> {
    let mut snapshot = lock(&state.inner)?.snapshot.clone();
    if snapshot.workspace.is_none() {
        let preferences = read_preferences(&app);
        snapshot.workspace = preferences
            .get("workspace")
            .and_then(Value::as_str)
            .map(str::to_owned);
        snapshot.model = preferences
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_MODEL)
            .to_owned();
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn agent_start(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    workspace: Option<String>,
    session_path: Option<String>,
) -> Result<RuntimeSnapshot, String> {
    if keychain_get()?.is_none() {
        return Err("請先設定 OpenAI API Key".into());
    }
    let preferences = read_preferences(&app);
    let workspace_value = workspace
        .or_else(|| {
            preferences
                .get("workspace")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or_else(|| "請先選擇工作資料夾".to_string())?;
    let workspace = canonical_workspace(&workspace_value)?;
    let private_dir = app_private_dir(&app)?;
    let sessions_dir = private_dir.join("sessions");
    let pi_binary = locate_resource(&app, &["binaries/pi-aarch64-apple-darwin", "binaries/pi"])?;
    let extension = locate_resource(&app, &["agent-runtime/boya-policy.ts"])?;
    let model = preferences
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_MODEL)
        .to_owned();
    fs::create_dir_all(&sessions_dir)
        .map_err(|error| format!("Cannot create BOYA session storage: {error}"))?;
    let session_path = session_path
        .map(|path| validate_session_path(&sessions_dir, Path::new(&path)))
        .transpose()?;
    stop_process(&state)?;
    update_preferences(
        &app,
        "workspace",
        Value::String(workspace.to_string_lossy().into_owned()),
    )?;
    {
        let mut inner = lock(&state.inner)?;
        inner.desired_running = true;
        inner.restart_count = 0;
        inner.snapshot.status = "starting".into();
        inner.snapshot.workspace = Some(workspace.to_string_lossy().into_owned());
        inner.snapshot.model = model.clone();
        inner.snapshot.error = None;
        inner.config = Some(RuntimeConfig {
            workspace,
            private_dir,
            sessions_dir: sessions_dir.clone(),
            pi_binary,
            extension,
            model,
            session_path,
        });
        emit_snapshot(&app, &inner.snapshot);
    }
    spawn_saved_runtime(&app, &state.inner)?;
    let response = rpc_request(&state, serde_json::json!({ "type": "get_state" }))?;
    let (session_id, session_path) = state_session(&response)?;
    validate_session_path(&sessions_dir, &session_path)?;
    let mut inner = lock(&state.inner)?;
    inner.snapshot.session_id = Some(session_id);
    if let Some(config) = inner.config.as_mut() {
        config.session_path = Some(session_path);
    }
    inner.snapshot.status = "ready".into();
    let snapshot = inner.snapshot.clone();
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn agent_stop(app: AppHandle, state: State<'_, AgentRuntimeState>) -> Result<(), String> {
    stop_process(&state)?;
    emit_snapshot(&app, &lock(&state.inner)?.snapshot);
    Ok(())
}

#[tauri::command]
pub fn agent_prompt(state: State<'_, AgentRuntimeState>, message: String) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("Message cannot be empty".into());
    }
    if lock(&state.inner)?.snapshot.running {
        return Err("A turn is already running".into());
    }
    rpc_request(
        &state,
        serde_json::json!({ "type": "prompt", "message": message }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn agent_abort(state: State<'_, AgentRuntimeState>) -> Result<(), String> {
    rpc_request(&state, serde_json::json!({ "type": "abort" }))?;
    Ok(())
}

#[tauri::command]
pub fn agent_list_sessions(
    state: State<'_, AgentRuntimeState>,
) -> Result<Vec<SessionSummary>, String> {
    let (sessions_dir, workspace) = {
        let inner = lock(&state.inner)?;
        let config = inner
            .config
            .as_ref()
            .ok_or_else(|| "Runtime is not configured".to_string())?;
        (
            config.sessions_dir.clone(),
            config.workspace.to_string_lossy().into_owned(),
        )
    };
    let mut files = Vec::new();
    session_files(&sessions_dir, &mut files, 0);
    let mut sessions = files
        .iter()
        .filter_map(|path| parse_session_summary(path).ok())
        .filter(|session| session.workspace == workspace)
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(sessions)
}

#[tauri::command]
pub fn agent_new_session(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
) -> Result<(), String> {
    if lock(&state.inner)?.snapshot.running {
        return Err("Stop the current turn before creating a session".into());
    }
    rpc_request(&state, serde_json::json!({ "type": "new_session" }))?;
    let response = rpc_request(&state, serde_json::json!({ "type": "get_state" }))?;
    let (session_id, path) = state_session(&response)?;
    {
        let mut inner = lock(&state.inner)?;
        let sessions_dir = inner
            .config
            .as_ref()
            .ok_or_else(|| "Runtime is not configured".to_string())?
            .sessions_dir
            .clone();
        let path = validate_session_path(&sessions_dir, &path)?;
        inner.snapshot.session_id = Some(session_id);
        if let Some(config) = inner.config.as_mut() {
            config.session_path = Some(path.clone());
        }
        emit_snapshot(&app, &inner.snapshot);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_switch_session(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    path: String,
) -> Result<(), String> {
    if lock(&state.inner)?.snapshot.running {
        return Err("Stop the current turn before switching sessions".into());
    }
    let sessions_dir = lock(&state.inner)?
        .config
        .as_ref()
        .ok_or_else(|| "Runtime is not configured".to_string())?
        .sessions_dir
        .clone();
    let path = validate_session_path(&sessions_dir, Path::new(&path))?;
    rpc_request(
        &state,
        serde_json::json!({ "type": "switch_session", "sessionPath": path }),
    )?;
    let response = rpc_request(&state, serde_json::json!({ "type": "get_state" }))?;
    let (session_id, session_path) = state_session(&response)?;
    let session_path = validate_session_path(&sessions_dir, &session_path)?;
    let mut inner = lock(&state.inner)?;
    inner.snapshot.session_id = Some(session_id);
    if let Some(config) = inner.config.as_mut() {
        config.session_path = Some(session_path);
    }
    emit_snapshot(&app, &inner.snapshot);
    Ok(())
}

#[tauri::command]
pub fn agent_rename_session(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    path: String,
    title: String,
) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Session title cannot be empty".into());
    }
    agent_switch_session(app.clone(), state.clone(), path)?;
    rpc_request(
        &state,
        serde_json::json!({ "type": "set_session_name", "name": title.trim() }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn agent_archive_session(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    path: String,
) -> Result<Option<SessionSummary>, String> {
    if lock(&state.inner)?.snapshot.running {
        return Err("Stop the current turn before archiving a session".into());
    }
    let session = PathBuf::from(path);
    let sessions_dir = lock(&state.inner)?
        .config
        .as_ref()
        .ok_or_else(|| "Runtime is not configured".to_string())?
        .sessions_dir
        .clone();
    let canonical = validate_session_path(&sessions_dir, &session)?;
    let response = rpc_request(&state, serde_json::json!({ "type": "get_state" }))?;
    let was_active = response
        .pointer("/data/sessionFile")
        .and_then(Value::as_str)
        == canonical.to_str();
    if was_active {
        rpc_request(&state, serde_json::json!({ "type": "new_session" }))?;
    }
    archive_session_file(&canonical, &sessions_dir.join("archive"))?;
    if !was_active {
        return Ok(None);
    }
    let response = rpc_request(&state, serde_json::json!({ "type": "get_state" }))?;
    let (session_id, path) = state_session(&response)?;
    let path = validate_session_path(&sessions_dir, &path)?;
    let summary = parse_session_summary(&path)?;
    let mut inner = lock(&state.inner)?;
    inner.snapshot.session_id = Some(session_id);
    if let Some(config) = inner.config.as_mut() {
        config.session_path = Some(path);
    }
    emit_snapshot(&app, &inner.snapshot);
    Ok(Some(summary))
}

#[tauri::command]
pub fn agent_get_messages(state: State<'_, AgentRuntimeState>) -> Result<Vec<ChatMessage>, String> {
    let response = rpc_request(&state, serde_json::json!({ "type": "get_messages" }))?;
    let messages = response
        .pointer("/data/messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(messages
        .iter()
        .enumerate()
        .filter_map(|(index, message)| {
            let role = message.get("role")?.as_str()?;
            if role != "user" && role != "assistant" {
                return None;
            }
            Some(ChatMessage {
                id: message
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("history-{index}")),
                role: role.to_owned(),
                content: message_text(message).unwrap_or_default(),
                created_at: message
                    .get("timestamp")
                    .and_then(Value::as_u64)
                    .unwrap_or(index as u64),
            })
        })
        .collect())
}

#[tauri::command]
pub fn agent_list_models(state: State<'_, AgentRuntimeState>) -> Result<Vec<ModelInfo>, String> {
    let response = rpc_request(
        &state,
        serde_json::json!({ "type": "get_available_models" }),
    )?;
    let models = response
        .pointer("/data/models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(models
        .iter()
        .filter(|model| model.get("provider").and_then(Value::as_str) == Some("openai"))
        .filter_map(|model| {
            let id = model.get("id")?.as_str()?.to_owned();
            Some(ModelInfo {
                name: model
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_owned(),
                id,
                context_window: model.get("contextWindow").and_then(Value::as_u64),
                supports_thinking: model.get("reasoning").and_then(Value::as_bool),
            })
        })
        .collect())
}

#[tauri::command]
pub fn agent_set_model(
    app: AppHandle,
    state: State<'_, AgentRuntimeState>,
    model_id: String,
) -> Result<(), String> {
    if lock(&state.inner)?.snapshot.running {
        return Err("Stop the current turn before changing models".into());
    }
    rpc_request(
        &state,
        serde_json::json!({ "type": "set_model", "provider": "openai", "modelId": model_id }),
    )?;
    update_preferences(&app, "model", Value::String(model_id.clone()))?;
    let mut inner = lock(&state.inner)?;
    inner.snapshot.model = model_id.clone();
    if let Some(config) = inner.config.as_mut() {
        config.model = model_id;
    }
    emit_snapshot(&app, &inner.snapshot);
    Ok(())
}

#[tauri::command]
pub fn agent_reply_approval(
    state: State<'_, AgentRuntimeState>,
    reply: Value,
) -> Result<(), String> {
    let request_id = reply
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Approval reply is missing requestId".to_string())?;
    let mut frame = serde_json::json!({
        "type": "extension_ui_response",
        "id": request_id
    });
    if let Some(value) = reply.get("value") {
        frame["value"] = value.clone();
    } else if let Some(confirmed) = reply.get("confirmed") {
        frame["confirmed"] = confirmed.clone();
    } else {
        frame["cancelled"] = Value::Bool(true);
    }
    let stdin = lock(&state.inner)?
        .process
        .as_ref()
        .ok_or_else(|| "Pi runtime is not running".to_string())?
        .stdin
        .clone();
    let mut bytes = serde_json::to_vec(&frame).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    let result = lock(&stdin)?
        .write_all(&bytes)
        .map_err(|error| format!("Cannot reply to approval: {error}"));
    result
}

#[tauri::command]
pub fn agent_versions() -> Value {
    serde_json::json!({ "boya": env!("CARGO_PKG_VERSION"), "pi": "v0.84.1" })
}

#[tauri::command]
pub fn agent_pick_workspace(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned()))
}

pub fn kill_runtime(state: &AgentRuntimeState) {
    let _ = stop_process(state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "boya-agent-runtime-{name}-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn canonicalizes_existing_absolute_workspace() {
        let dir = temp_dir("workspace");
        assert_eq!(
            canonical_workspace(dir.to_str().unwrap()).unwrap(),
            dir.canonicalize().unwrap()
        );
        assert!(canonical_workspace("relative/path").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_sensitive_and_symlink_escape_paths() {
        use std::os::unix::fs::symlink;

        let workspace = temp_dir("paths");
        let outside = temp_dir("outside");
        fs::write(outside.join("private.txt"), "secret").unwrap();
        symlink(outside.join("private.txt"), workspace.join("escape.txt")).unwrap();

        assert!(validate_workspace_path(&workspace, ".env", false).is_err());
        assert!(validate_workspace_path(&workspace, ".git/config", false).is_err());
        assert!(validate_workspace_path(&workspace, "escape.txt", false).is_err());
        assert!(validate_workspace_path(&workspace, "notes/new.md", true).is_ok());

        fs::remove_dir_all(workspace).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn sandbox_profiles_are_fail_closed_and_split_network_access() {
        let workspace = PathBuf::from("/tmp/research folder");
        let private = PathBuf::from("/tmp/boya private");
        let package = PathBuf::from("/Applications/Boya Desktop.app/Contents/Resources/pi");
        let runtime = runtime_sandbox_profile(&workspace, &private, &package);
        let shell = shell_sandbox_profile(&workspace);

        assert!(runtime.contains("(deny default)"));
        assert!(runtime.contains("(allow network-outbound)"));
        assert!(runtime.contains("(allow file-read*)"));
        assert!(runtime.contains("deny file-read* (subpath (param \"USER_HOME\"))"));
        assert!(runtime.contains("param \"WORKSPACE\""));
        assert!(runtime.contains("param \"PRIVATE\""));
        assert!(runtime.contains("param \"EXTENSION\""));
        assert!(shell.contains("(deny network*)"));
        assert!(!shell.contains("boya private"));
    }

    #[test]
    fn parses_session_title_and_archives_recoverably() {
        let root = temp_dir("sessions");
        let session = root.join("session.jsonl");
        fs::write(
            &session,
            concat!(
                "{\"type\":\"session\",\"version\":3,\"id\":\"abc\",\"timestamp\":\"2026-08-13T00:00:00Z\",\"cwd\":\"/tmp/research\"}\n",
                "{\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"timestamp\":\"2026-08-13T00:01:00Z\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"First research question\\nwith detail\"}]}}\n",
                "{\"type\":\"session_info\",\"id\":\"i1\",\"parentId\":\"m1\",\"timestamp\":\"2026-08-13T00:02:00Z\",\"name\":\"Named session\"}\n"
            ),
        )
        .unwrap();

        let summary = parse_session_summary(&session).unwrap();
        assert_eq!(summary.id, "abc");
        assert_eq!(summary.title, "Named session");
        assert_eq!(summary.workspace, "/tmp/research");

        let archive = root.join("archive");
        let archived = archive_session_file(&session, &archive).unwrap();
        assert!(!session.exists());
        assert!(archived.exists());
        assert!(archived.starts_with(archive));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn redacts_provider_secrets_and_auth_headers() {
        let text = "OPENAI_API_KEY=sk-test Authorization: Bearer token-value";
        let clean = sanitize_runtime_text(text, Some("sk-test"));
        assert!(!clean.contains("sk-test"));
        assert!(!clean.contains("token-value"));
        assert!(clean.contains("[REDACTED]"));
    }

    #[test]
    fn completed_messages_without_frame_ids_remain_distinct() {
        let first = serde_json::json!({
            "type": "message_end",
            "message": {
                "role": "assistant",
                "timestamp": 100,
                "content": [{ "type": "text", "text": "First" }]
            }
        });
        let second = serde_json::json!({
            "type": "message_end",
            "message": {
                "role": "assistant",
                "timestamp": 101,
                "content": [{ "type": "text", "text": "Second" }]
            }
        });

        let first_id = normalize_message(&first).unwrap()["message"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let second_id = normalize_message(&second).unwrap()["message"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        assert_ne!(first_id, second_id);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn shell_sandbox_allows_workspace_and_denies_sensitive_access() {
        use std::process::Command;

        let workspace = temp_dir("shell-sandbox-workspace").canonicalize().unwrap();
        let outside = temp_dir("shell-sandbox-outside").canonicalize().unwrap();
        fs::write(workspace.join(".env"), "OPENAI_API_KEY=sk-hidden").unwrap();
        fs::write(outside.join("private.txt"), "private").unwrap();
        let profile = workspace.join("shell.sb");
        fs::write(&profile, shell_sandbox_profile(&workspace)).unwrap();

        let allowed = Command::new("/usr/bin/sandbox-exec")
            .args(["-f", profile.to_str().unwrap(), "-D"])
            .arg(format!("WORKSPACE={}", workspace.display()))
            .args(["/bin/zsh", "-f", "-c"])
            .arg("printf allowed > note.txt && cat note.txt")
            .current_dir(&workspace)
            .env_clear()
            .env("HOME", &workspace)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .output()
            .unwrap();
        assert!(
            allowed.status.success(),
            "{}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&allowed.stdout), "allowed");

        for command in [
            format!("cat '{}'", outside.join("private.txt").display()),
            "cat .env".to_string(),
            "/usr/bin/security find-generic-password -s dev.dylanchiang.boya.openai -a openai -w"
                .to_string(),
            "/usr/bin/curl --connect-timeout 1 https://example.com".to_string(),
            "ssh -o ConnectTimeout=1 example.com true".to_string(),
            "npm install left-pad".to_string(),
        ] {
            let denied = Command::new("/usr/bin/sandbox-exec")
                .args(["-f", profile.to_str().unwrap(), "-D"])
                .arg(format!("WORKSPACE={}", workspace.display()))
                .args(["/bin/zsh", "-f", "-c"])
                .arg(command)
                .current_dir(&workspace)
                .env_clear()
                .env("HOME", &workspace)
                .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
                .output()
                .unwrap();
            assert!(!denied.status.success());
        }

        fs::remove_dir_all(workspace).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
