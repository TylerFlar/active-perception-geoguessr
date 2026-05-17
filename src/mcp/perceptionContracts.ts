export type McpServerTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: McpServerTransport;
  headers?: Record<string, string>;
  tool_timeout_sec?: number;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface PerceptionToolCapability {
  id: string;
  displayName: string;
  category:
    | "text"
    | "vehicle"
    | "crop"
    | "map-context";
  preferredBackend: string;
  whyUseful: string;
  expectedSignal: string[];
  mcpToolNames: string[];
  evidenceSources: string[];
}

export const DEFAULT_PERCEPTION_TOOLS: PerceptionToolCapability[] = [
  {
    id: "crop.make",
    displayName: "Crop Extractor",
    category: "crop",
    preferredBackend: "Pillow MCP utility",
    whyUseful: "Creates exact image crops for downstream text or plate readers.",
    expectedSignal: ["crop path", "pixel box", "crop size"],
    mcpToolNames: ["make_crops"],
    evidenceSources: ["local deterministic image crop"]
  },
  {
    id: "ocr.read_text",
    displayName: "Fast OCR",
    category: "text",
    preferredBackend: "RapidOCR ONNX",
    whyUseful: "Extracts text, scripts, diacritics, place names, and road numbers from signs and markings.",
    expectedSignal: ["visible text", "language/script", "diacritics", "place names", "road numbers"],
    mcpToolNames: ["ocr_read_text"],
    evidenceSources: ["https://github.com/RapidAI/RapidOCR"]
  },
  {
    id: "alpr.read_plate",
    displayName: "License Plate Reader",
    category: "vehicle",
    preferredBackend: "FastALPR ONNX",
    whyUseful: "Reads visible license plates and returns plate text or format cues.",
    expectedSignal: ["plate color", "format", "country/state hints", "vehicle side"],
    mcpToolNames: ["read_plate"],
    evidenceSources: ["https://github.com/ankandrew/fast-alpr"]
  },
  {
    id: "place.lookup",
    displayName: "Visible Text Place Lookup",
    category: "map-context",
    preferredBackend: "Nominatim",
    whyUseful: "Looks up visible names from signs, roads, businesses, or landmarks as candidate places.",
    expectedSignal: ["candidate places", "administrative hierarchy", "approximate coordinates"],
    mcpToolNames: ["place_lookup"],
    evidenceSources: ["https://nominatim.org/release-docs/latest/api/Search/"]
  }
];

export function summarizeToolCatalog(tools: PerceptionToolCapability[] = DEFAULT_PERCEPTION_TOOLS): string {
  return tools
    .map((tool) => {
      const signals = tool.expectedSignal.join(", ");
      const mcpNames = tool.mcpToolNames.join(", ");
      return `- ${tool.displayName} (${tool.id}): ${tool.whyUseful} Expected signals: ${signals}. MCP tools: ${mcpNames}.`;
    })
    .join("\n");
}

export function parseMcpConfig(
  raw: string | undefined,
  readFile?: (path: string) => string
): McpConfigFile {
  if (!raw?.trim()) {
    return { mcpServers: {} };
  }

  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : readFile?.(trimmed) ?? fail(`PERCEPTION_MCP_CONFIG points to ${trimmed}, but no file reader was provided.`);

  const parsed = JSON.parse(jsonText) as unknown;
  return normalizeMcpConfig(parsed);
}

export function normalizeMcpConfig(value: unknown): McpConfigFile {
  if (!isRecord(value)) {
    throw new Error("MCP config must be a JSON object.");
  }

  const mcpServersValue = isRecord(value.mcpServers) ? value.mcpServers : value;
  const mcpServers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(mcpServersValue)) {
    if (!isRecord(server)) {
      throw new Error(`MCP server ${name} must be an object.`);
    }
    if (!server.command && !server.url) {
      throw new Error(`MCP server ${name} needs either command or url.`);
    }
    mcpServers[sanitizeMcpServerName(name)] = {
      command: stringOrUndefined(server.command),
      args: stringArrayOrUndefined(server.args),
      env: recordOfStringsOrUndefined(server.env),
      url: stringOrUndefined(server.url),
      transport: transportOrUndefined(server.transport),
      headers: recordOfStringsOrUndefined(server.headers),
      tool_timeout_sec: numberOrUndefined(server.tool_timeout_sec)
    };
  }

  return { mcpServers };
}

export function buildCodexMcpArgs(config: McpConfigFile): string[] {
  const args: string[] = ["--ignore-user-config", "--ignore-rules", "--ephemeral"];

  for (const [name, server] of Object.entries(config.mcpServers)) {
    const prefix = `mcp_servers.${name}`;
    if (server.command) {
      args.push("-c", `${prefix}.command=${tomlValue(server.command)}`);
    }
    if (server.args) {
      args.push("-c", `${prefix}.args=${tomlValue(server.args)}`);
    }
    if (server.url) {
      args.push("-c", `${prefix}.url=${tomlValue(server.url)}`);
    }
    if (server.transport) {
      args.push("-c", `${prefix}.transport=${tomlValue(server.transport)}`);
    }
    if (server.tool_timeout_sec) {
      args.push("-c", `${prefix}.tool_timeout_sec=${tomlValue(server.tool_timeout_sec)}`);
    }
    if (server.env) {
      for (const [key, value] of Object.entries(server.env).sort()) {
        args.push("-c", `${prefix}.env.${key}=${tomlValue(value)}`);
      }
    }
    if (server.headers) {
      for (const [key, value] of Object.entries(server.headers).sort()) {
        args.push("-c", `${prefix}.headers.${key}=${tomlValue(value)}`);
      }
    }
  }

  return args;
}

export function buildClaudeMcpConfig(config: McpConfigFile): string {
  return JSON.stringify({ mcpServers: config.mcpServers });
}

function sanitizeMcpServerName(name: string): string {
  const sanitized = name.trim().replace(/[^A-Za-z0-9_-]/g, "-");
  if (!sanitized) {
    throw new Error("MCP server names cannot be empty.");
  }
  return sanitized;
}

function tomlValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("MCP args must be an array of strings.");
  }
  return value;
}

function recordOfStringsOrUndefined(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("MCP env/headers must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`MCP env/header ${key} must be a string.`);
    }
    result[key] = entry;
  }
  return result;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("MCP tool_timeout_sec must be a finite number.");
  }
  return value;
}

function transportOrUndefined(value: unknown): McpServerTransport | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "stdio" || value === "http" || value === "sse") {
    return value;
  }
  throw new Error("MCP transport must be stdio, http, or sse.");
}

function fail(message: string): never {
  throw new Error(message);
}
