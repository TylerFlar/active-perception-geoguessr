import path from "node:path";
import dotenv from "dotenv";
import { buildGoogleMapsMcpConfig, type McpConfigFile } from "../src/mcp/mcpConfig";

dotenv.config({ quiet: true });

export interface RuntimeSettings {
  host: string;
  port: number;
  rootDir: string;
  snapshotDir: string;
  googleMapsStartUrl: string;
  provider: "mock" | "openai" | "codex" | "claude";
  openaiApiKey?: string;
  openaiModel?: string;
  codexModel?: string;
  claudeModel?: string;
  mcpConfig: McpConfigFile;
}

export function loadSettings(): RuntimeSettings {
  const rootDir = process.cwd();
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 5173);
  const serverUrl = nonEmpty(process.env.ACTIVE_GEO_SERVER_URL) || `http://${host}:${port}`;
  const mcpConfig = buildGoogleMapsMcpConfig(serverUrl);

  return {
    host,
    port,
    rootDir,
    snapshotDir: path.join(rootDir, ".active-perception", "snapshots"),
    googleMapsStartUrl: nonEmpty(process.env.GOOGLE_MAPS_START_URL) || "https://www.google.com/maps",
    provider: parseProvider(process.env.GEO_AGENT_PROVIDER),
    openaiApiKey: nonEmpty(process.env.OPENAI_API_KEY),
    openaiModel: nonEmpty(process.env.OPENAI_MODEL),
    codexModel: nonEmpty(process.env.CODEX_MODEL),
    claudeModel: nonEmpty(process.env.CLAUDE_MODEL),
    mcpConfig
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
