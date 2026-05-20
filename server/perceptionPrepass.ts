import { spawn } from "node:child_process";
import path from "node:path";
import type { RunLogger } from "./runLogs";

export interface PrepassOcrText {
  text: string;
  confidence: number | null;
}

export interface PerceptionPrepass {
  ok: boolean;
  elapsedSec?: number;
  ocrTexts: PrepassOcrText[];
  plates: unknown[];
  note?: string;
}

const ANALYZE_TIMEOUT_MS = 120_000;

// Runs OCR + ALPR once, server-side, before the model call. This replaces the
// per-turn agentic tool round-trips: the model gets perception evidence handed
// to it instead of spending LLM turns deciding to call (and waiting on) MCP tools.
export async function runPerceptionPrepass(params: {
  imagePath: string;
  rootDir: string;
  log?: RunLogger;
}): Promise<PerceptionPrepass> {
  const mcpDir = path.join(params.rootDir, "mcps", "perception");
  params.log?.({ source: "mcp", level: "info", message: "Perception pre-pass: running OCR + ALPR" });
  try {
    const stdout = await spawnAnalyze(mcpDir, params.imagePath);
    const parsed = JSON.parse(lastJsonLine(stdout)) as Record<string, unknown>;
    const result = normalize(parsed);
    params.log?.({
      source: "mcp",
      level: "info",
      message: `Perception pre-pass done in ${result.elapsedSec ?? "?"}s: ${result.ocrTexts.length} text(s), ${result.plates.length} plate(s)`,
      detail: result
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.log?.({ source: "mcp", level: "warn", message: `Perception pre-pass unavailable: ${message}` });
    return { ok: false, ocrTexts: [], plates: [], note: message };
  }
}

function spawnAnalyze(mcpDir: string, imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "uv",
      ["--directory", mcpDir, "run", "python", "-m", "perception_mcp", "--analyze", imagePath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`analyze timed out after ${ANALYZE_TIMEOUT_MS}ms`));
    }, ANALYZE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"));
      } else {
        reject(new Error(`analyze exited ${code}: ${Buffer.concat(stderr).toString("utf-8").slice(0, 300)}`));
      }
    });
  });
}

function lastJsonLine(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith("{")) {
      return lines[i];
    }
  }
  throw new Error("analyze produced no JSON output");
}

function normalize(parsed: Record<string, unknown>): PerceptionPrepass {
  const ocr = isRecord(parsed.ocr) ? parsed.ocr : {};
  const plate = isRecord(parsed.plate) ? parsed.plate : {};
  const ocrTexts = Array.isArray(ocr.texts)
    ? ocr.texts.flatMap((entry) =>
        isRecord(entry) && typeof entry.text === "string"
          ? [{ text: entry.text, confidence: typeof entry.confidence === "number" ? entry.confidence : null }]
          : []
      )
    : [];
  const plates = Array.isArray(plate.raw) ? plate.raw : [];
  return {
    ok: parsed.ok === true,
    elapsedSec: typeof parsed.elapsed_sec === "number" ? parsed.elapsed_sec : undefined,
    ocrTexts,
    plates
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
