import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { parseMcpConfig, type McpConfigFile } from "../src/mcp/perceptionContracts";

dotenv.config({ quiet: true });

export interface RuntimeSettings {
  host: string;
  port: number;
  rootDir: string;
  snapshotDir: string;
  panoramaxEndpoint: string;
  provider: "mock" | "openai" | "codex" | "claude";
  openaiApiKey?: string;
  openaiModel?: string;
  codexModel?: string;
  claudeModel?: string;
  mcpConfig: McpConfigFile;
}

export function loadSettings(): RuntimeSettings {
  const rootDir = process.cwd();
  return {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 5173),
    rootDir,
    snapshotDir: path.join(rootDir, ".active-perception", "snapshots"),
    panoramaxEndpoint: nonEmpty(process.env.PANORAMAX_ENDPOINT) || "https://panoramax.openstreetmap.fr/",
    provider: parseProvider(process.env.GEO_AGENT_PROVIDER),
    openaiApiKey: nonEmpty(process.env.OPENAI_API_KEY),
    openaiModel: nonEmpty(process.env.OPENAI_MODEL),
    codexModel: nonEmpty(process.env.CODEX_MODEL),
    claudeModel: nonEmpty(process.env.CLAUDE_MODEL),
    mcpConfig: parseMcpConfig(process.env.PERCEPTION_MCP_CONFIG, (filePath) =>
      fs.readFileSync(path.resolve(rootDir, filePath), "utf-8")
    )
  };
}

function parseProvider(value: string | undefined): RuntimeSettings["provider"] {
  const provider = value?.trim().toLowerCase() || "mock";
  if (provider === "mock" || provider === "openai" || provider === "codex" || provider === "claude") {
    return provider;
  }
  throw new Error("GEO_AGENT_PROVIDER must be one of: mock, openai, codex, claude.");
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
