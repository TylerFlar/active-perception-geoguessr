import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  buildClaudeMcpConfig,
  buildCodexMcpArgs
} from "../../src/mcp/perceptionContracts";
import { agentOutputJsonSchema } from "./schema";
import type { AgentProvider, ProviderRunInput } from "./provider";
import { extractResultTextFromJsonl, parseAgentOutput } from "./json";

export class CodexCliProvider implements AgentProvider {
  name = "codex" as const;

  get model() {
    return process.env.CODEX_MODEL || "configured-codex-model";
  }

  async run(input: ProviderRunInput) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "active-geo-codex-"));
    const schemaPath = path.join(tempDir, "schema.json");
    await fs.writeFile(schemaPath, JSON.stringify(agentOutputJsonSchema), "utf-8");
    const prompt = promptWithImagePath(input.prompt, input.snapshotPath);

    const args = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--cd",
      input.settings.rootDir,
      ...buildCodexMcpArgs(input.settings.mcpConfig)
    ];

    if (input.settings.codexModel) {
      args.push("--model", input.settings.codexModel);
    }
    if (input.snapshotPath) {
      args.push("--image", input.snapshotPath);
    }
    args.push("--output-schema", schemaPath, "-");

    try {
      input.log?.({ source: "provider", level: "info", message: "Starting Codex CLI" });
      const result = await runProcess("codex", args, prompt, process.env, "codex", input.log);
      if (result.exitCode !== 0) {
        throw new Error(`codex exited ${result.exitCode}: ${result.stderr || result.stdout}`);
      }
      input.log?.({ source: "provider", level: "info", message: "Codex CLI completed" });
      return parseAgentOutput(extractResultTextFromJsonl(result.stdout));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export class ClaudeCliProvider implements AgentProvider {
  name = "claude" as const;

  get model() {
    return process.env.CLAUDE_MODEL || "configured-claude-model";
  }

  async run(input: ProviderRunInput) {
    const prompt = promptWithImagePath(input.prompt, input.snapshotPath);
    const args = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--max-turns",
      "10",
      "--strict-mcp-config",
      "--mcp-config",
      buildClaudeMcpConfig(input.settings.mcpConfig),
      "--json-schema",
      JSON.stringify(agentOutputJsonSchema),
      prompt
    ];

    if (input.settings.claudeModel) {
      args.unshift("--model", input.settings.claudeModel);
    }

    const env = {
      ...process.env,
      MCP_TIMEOUT: "86400000",
      MCP_TOOL_TIMEOUT: "100000000"
    };
    input.log?.({ source: "provider", level: "info", message: "Starting Claude CLI" });
    const result = await runProcess("claude", args, undefined, env, "claude", input.log);
    if (result.exitCode !== 0) {
      throw new Error(`claude exited ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
    input.log?.({ source: "provider", level: "info", message: "Claude CLI completed" });
    return parseAgentOutput(extractResultTextFromJsonl(result.stdout));
  }
}

async function runProcess(
  command: string,
  args: string[],
  stdin?: string,
  env: NodeJS.ProcessEnv = process.env,
  logSource: "codex" | "claude" = "codex",
  log?: ProviderRunInput["log"]
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    log?.({ source: logSource, level: "info", message: `Spawned ${command}` });
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let lastEvent = "process start";
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      log?.({
        source: logSource,
        level: "info",
        message: `Still waiting on ${command} (${elapsedSeconds}s elapsed, last: ${lastEvent})`
      });
    }, 15_000);

    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stdout.push(buffer);
      stdoutRemainder = consumeLines(stdoutRemainder + buffer.toString("utf-8"), (line) => {
        lastEvent = logCliLine(logSource, line, log);
      });
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      stderrRemainder = consumeLines(stderrRemainder + buffer.toString("utf-8"), (line) => {
        const warning = stderrWarningMessage(line);
        if (warning) {
          log?.({ source: logSource, level: "warn", message: warning });
        }
      });
    });
    child.on("error", (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearInterval(heartbeat);
      if (stdoutRemainder.trim()) {
        lastEvent = logCliLine(logSource, stdoutRemainder.trim(), log);
      }
      if (stderrRemainder.trim()) {
        const warning = stderrWarningMessage(stderrRemainder);
        if (warning) {
          log?.({ source: logSource, level: "warn", message: warning });
        }
      }
      log?.({ source: logSource, level: exitCode === 0 ? "info" : "error", message: `${command} exited ${exitCode}` });
      resolve({
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
        exitCode
      });
    });

    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

function consumeLines(text: string, onLine: (line: string) => void): string {
  const lines = text.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim()) {
      onLine(line);
    }
  }
  return remainder;
}

function logCliLine(source: "codex" | "claude", line: string, log?: ProviderRunInput["log"]): string {
  const parsed = tryParseJson(line);
  if (isRecord(parsed)) {
    const summary = describeCliEvent(parsed);
    log?.({
      source,
      level: eventLevel(parsed),
      message: summary,
      detail: parsed
    });
    return summary;
  }

  if (line.trim()) {
    const message = trimLog(line.trim());
    log?.({ source, level: "info", message });
    return message;
  }

  return "blank output";
}

function stderrWarningMessage(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || isNoisyCliWarning(trimmed)) {
    return undefined;
  }
  return trimLog(trimmed);
}

function isNoisyCliWarning(line: string): boolean {
  const lower = line.toLowerCase();
  return line.startsWith("<")
    || lower.includes("window._cf_chl_opt")
    || lower.includes("challenge-error-text")
    || lower.includes("remote plugin sync request")
    || lower.includes("codex_core::plugins::startup_sync")
    || lower.includes("codex_core::plugins::manager")
    || lower.includes("codex_core_plugins::manifest")
    || lower.includes("codex_core_skills::loader")
    || lower.includes("codex_core::shell_snapshot");
}

function describeCliEvent(event: Record<string, unknown>): string {
  const type = typeof event.type === "string" ? event.type : "event";
  const item = isRecord(event.item) ? event.item : undefined;
  const eventText = firstString(event, ["message", "text", "delta", "result", "error"]);
  const eventName = firstString(event, ["tool", "name", "call_id", "item_id", "thread_id"]);

  if (item) {
    return describeItemEvent(type, item);
  }

  if (eventText) {
    return `${type}: ${trimLog(eventText)}`;
  }
  if (eventName) {
    return `${type}: ${eventName}`;
  }
  return type;
}

function describeItemEvent(eventType: string, item: Record<string, unknown>): string {
  const itemType = firstString(item, ["type", "kind", "role"]) ?? "item";
  const name = firstString(item, ["name", "tool", "title", "call_id", "id"]);
  const text = textFromItem(item);
  const args = firstString(item, ["arguments", "input", "command"]);
  const status = firstString(item, ["status"]);
  const label = [eventType, itemType, name].filter(Boolean).join(": ");

  if (text) {
    return `${label}: ${trimLog(text)}`;
  }
  if (args) {
    return `${label}: ${trimLog(args)}`;
  }
  if (status) {
    return `${label}: ${status}`;
  }
  return label;
}

function textFromItem(item: Record<string, unknown>): string | undefined {
  const direct = firstString(item, ["message", "text", "delta", "result", "output", "summary"]);
  if (direct) {
    return direct;
  }

  const content = item.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (isRecord(entry)) {
          return firstString(entry, ["text", "message", "output", "content"]);
        }
        return undefined;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  const summary = item.summary;
  if (Array.isArray(summary)) {
    const parts = summary
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (isRecord(entry)) {
          return firstString(entry, ["text", "message", "summary"]);
        }
        return undefined;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function eventLevel(event: Record<string, unknown>): "info" | "warn" | "error" {
  const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
  if (type.includes("error") || type.includes("failed")) {
    return "error";
  }
  if (type.includes("warn")) {
    return "warn";
  }
  return "info";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimLog(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function promptWithImagePath(prompt: string, snapshotPath?: string): string {
  if (!snapshotPath) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Image handoff:",
    `- The current Panoramax street-level image is attached when the CLI supports image attachments.`,
    `- The same snapshot is also available on disk at: ${snapshotPath}`,
    "- If a perception MCP/tool needs an image file, pass it that local path."
  ].join("\n");
}
