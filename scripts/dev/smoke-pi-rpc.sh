#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PI_BINARY="$ROOT_DIR/apps/desktop/src-tauri/binaries/pi-aarch64-apple-darwin"
EXTENSION="$ROOT_DIR/apps/desktop/src-tauri/agent-runtime/boya-policy.ts"
SMOKE_DIR="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"' EXIT

mkdir -p "$SMOKE_DIR/private/sessions" "$SMOKE_DIR/workspace"
SMOKE_DIR="$(cd "$SMOKE_DIR" && pwd -P)"
cp "$EXTENSION" "$SMOKE_DIR/private/boya-policy.ts"
EXTENSION="$SMOKE_DIR/private/boya-policy.ts"
cp -R "$(dirname "$PI_BINARY")" "$SMOKE_DIR/pi-runtime"
PI_BINARY="$SMOKE_DIR/pi-runtime/pi-aarch64-apple-darwin"

printf '%s\n' \
  '(version 1)' \
  '(deny default)' \
  '(allow process-exec)' \
  '(allow process-fork)' \
  '(allow signal (target self))' \
  '(allow file-read*)' \
  '(deny file-read* (subpath (param "USER_HOME")))' \
  '(allow file-read* (subpath (param "PACKAGE")) (literal (param "EXTENSION")) (subpath (param "WORKSPACE")) (subpath (param "PRIVATE")))' \
  '(allow file-write* (subpath (param "WORKSPACE")) (subpath (param "PRIVATE")))' \
  '(allow network-outbound)' \
  '(allow sysctl-read)' \
  '(allow mach-lookup)' > "$SMOKE_DIR/runtime.sb"
printf '%s\n' \
  '(version 1)' \
  '(deny default)' \
  '(deny network*)' \
  '(allow process-exec)' \
  '(allow process-fork)' \
  '(allow signal (target self))' \
  '(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath (param "WORKSPACE")))' \
  '(allow file-write* (subpath (param "WORKSPACE")))' \
  '(deny file-read* (subpath (string-append (param "WORKSPACE") "/.git")) (regex #".*\.env(\..*)?$"))' \
  '(deny file-write* (subpath (string-append (param "WORKSPACE") "/.git")) (regex #".*\.env(\..*)?$"))' \
  '(allow sysctl-read)' \
  '(allow mach-lookup)' \
  '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.trustd.agent"))' > "$SMOKE_DIR/shell.sb"
(
  cd "$SMOKE_DIR/workspace"
  {
    printf '%s\n' '{"type":"get_state","id":"smoke-state"}'
    sleep 0.1
    printf '%s\n' '{"type":"new_session","id":"smoke-new-session"}'
    sleep 0.1
    printf '%s\n' '{"type":"get_state","id":"smoke-new-state"}'
  } |
    env -i \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    HOME="$SMOKE_DIR/private" \
    PI_CODING_AGENT_DIR="$SMOKE_DIR/private" \
    PI_CODING_AGENT_SESSION_DIR="$SMOKE_DIR/private/sessions" \
    PI_OFFLINE=1 \
    PI_TELEMETRY=0 \
    BOYA_WORKSPACE="$SMOKE_DIR/workspace" \
    BOYA_SHELL_SANDBOX="$SMOKE_DIR/shell.sb" \
    /usr/bin/sandbox-exec \
      -f "$SMOKE_DIR/runtime.sb" \
      -D "WORKSPACE=$SMOKE_DIR/workspace" \
      -D "PRIVATE=$SMOKE_DIR/private" \
      -D "PACKAGE=$(dirname "$PI_BINARY")" \
      -D "EXTENSION=$EXTENSION" \
      -D "USER_HOME=$HOME" \
      "$PI_BINARY" \
        --mode rpc \
        --provider openai \
        --model gpt-5.6-terra \
        --session-dir "$SMOKE_DIR/private/sessions" \
        --tools read,bash,edit,write,grep,find,ls \
        --no-extensions \
        --extension "$EXTENSION" \
        --no-skills \
        --no-prompt-templates \
        --no-themes \
        --no-context-files \
        --no-approve \
        --offline |
    tee "$SMOKE_DIR/output.jsonl" >/dev/null
)

jq -e 'select(.id == "smoke-state" and .type == "response" and .success == true and .data.model.provider == "openai" and .data.model.id == "gpt-5.6-terra")' "$SMOKE_DIR/output.jsonl" >/dev/null
jq -e 'select(.id == "smoke-new-session" and .type == "response" and .success == true and .data.cancelled == false)' "$SMOKE_DIR/output.jsonl" >/dev/null
jq -e 'select(.id == "smoke-new-state" and .type == "response" and .success == true and .data.messageCount == 0 and (.data.sessionFile | endswith(".jsonl")))' "$SMOKE_DIR/output.jsonl" >/dev/null
test -z "$(find "$SMOKE_DIR/private/sessions" -type f -name '*.jsonl' -print -quit)"
