import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const workspace = process.env.BOYA_WORKSPACE;
const shellProfile = process.env.BOYA_SHELL_SANDBOX;

if (!workspace || !shellProfile || !existsSync("/usr/bin/sandbox-exec")) {
  throw new Error("BOYA security bridge is unavailable");
}

const workspaceRoot = realpathSync(workspace);
const sensitiveNames = new Set([
  ".git",
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config",
  ".docker",
  ".kube",
  ".netrc",
  ".npmrc",
  ".pypirc",
]);
const commandBoundary = "(?:^|[;&|\\n]|`|\\$\\()\\s*(?:(?:command|exec|env)\\s+)*(?:/[\\w.+-]+/)*";
const externalCommand = new RegExp(`${commandBoundary}(curl|wget|ssh|scp|sftp|rsync\\b[^;|\\n]*:|git\\s+push|launchctl|systemctl|sudo)\\b`, "i");
const dependencyInstall = new RegExp(`${commandBoundary}((npm|pnpm|yarn|bun)\\s+(i|install|add)|pip\\d*\\s+install|python\\d*(?:\\.\\d+)?\\s+-m\\s+pip\\s+install|uv\\s+(add|pip\\s+install|sync)|cargo\\s+install|gem\\s+install|brew\\s+(install|upgrade)|apt(-get)?\\s+install)\\b`, "i");

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isInsideWorkspace(path: string): boolean {
  const rel = relative(workspaceRoot, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function hasSensitiveComponent(path: string): boolean {
  return relative(workspaceRoot, path)
    .split(sep)
    .some((component) => sensitiveNames.has(component) || component === ".env" || component.startsWith(".env."));
}

function canonicalTarget(rawPath: string): string {
  const requested = isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath);
  if (!isInsideWorkspace(requested) || hasSensitiveComponent(requested)) {
    throw new Error("Path is outside the active workspace or is sensitive");
  }

  let existing = requested;
  while (!existsSync(existing)) {
    const parent = resolve(existing, "..");
    if (parent === existing) throw new Error("Path has no resolvable parent");
    existing = parent;
  }
  const realParent = realpathSync(existing);
  const suffix = relative(existing, requested);
  const target = resolve(realParent, suffix);
  if (!isInsideWorkspace(target) || hasSensitiveComponent(target)) {
    throw new Error("Resolved path escapes the active workspace");
  }
  return target;
}

function pathsFromTool(input: Record<string, unknown>): string[] {
  const paths = [input.path, input.filePath, input.cwd];
  if (Array.isArray(input.paths)) paths.push(...input.paths);
  const resolved = paths.filter((value): value is string => typeof value === "string" && !!value.trim());
  return resolved.length > 0 ? resolved : ["."];
}

function blocked(reason: string) {
  return { block: true as const, reason };
}

export default function boyaPolicy(pi: ExtensionAPI) {
  const bash = createBashTool(workspaceRoot, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command, cwd }) => {
      const checkedCwd = canonicalTarget(cwd);
      const env: NodeJS.ProcessEnv = {
        HOME: workspaceRoot,
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        PWD: checkedCwd,
      };
      return {
        cwd: checkedCwd,
        env,
        command: `exec /usr/bin/sandbox-exec -f ${shellQuote(shellProfile)} -D ${shellQuote(`WORKSPACE=${workspaceRoot}`)} /bin/zsh -f -c ${shellQuote(command)}`,
      };
    },
  });

  pi.registerTool({
    ...bash,
    executionMode: "sequential",
    async execute(id, params, signal, onUpdate, ctx) {
      return bash.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (["read", "write", "edit", "grep", "find", "ls"].includes(event.toolName)) {
      try {
        for (const rawPath of pathsFromTool(event.input)) {
          const target = canonicalTarget(rawPath);
          if (["write", "edit"].includes(event.toolName) && existsSync(target) && lstatSync(target).isFile()) {
            if (!ctx.hasUI) return blocked("BOYA approval bridge is unavailable");
            const approved = await ctx.ui.confirm(
              "覆寫既有檔案？",
              `Pi 要覆寫 ${relative(workspaceRoot, target)}。此許可只適用於這一次操作。`,
            );
            if (!approved) return blocked("Existing file overwrite was not approved");
          }
        }
      } catch (error) {
        return blocked(error instanceof Error ? error.message : "Path validation failed");
      }
    }

    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      if (externalCommand.test(command)) {
        return blocked("External, privileged, or remote shell operations are disabled in BOYA 0.2");
      }
      if (dependencyInstall.test(command)) {
        return blocked("Dependency installation is disabled in BOYA 0.2");
      }
      if (!ctx.hasUI) return blocked("BOYA approval bridge is unavailable");
      const approved = await ctx.ui.confirm(
        "允許執行 shell 命令？",
        `${command}\n\nShell 命令可能讀寫目前工作區。此許可只適用於這一次操作。`,
      );
      if (!approved) return blocked("Shell command was not approved");
    }

    return undefined;
  });

  pi.on("input", async (event) => {
    if (event.source !== "rpc") return { action: "handled" };
    if (event.text.startsWith("/") || event.text.startsWith("!")) {
      return { action: "handled" };
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nBOYA policy:\n- Access only the active workspace.\n- The user chooses research questions, sources, frameworks, methods, interpretations, arguments, venues, and final authorship.\n- Never fabricate facts, references, data, or completed verification. Preserve uncertainty and state what was actually checked.\n- Dependency installation, remote access, publishing, and external side effects are unavailable.`,
  }));
}
