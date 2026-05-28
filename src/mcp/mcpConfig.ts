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

export function buildGoogleMapsMcpConfig(serverUrl: string): McpConfigFile {
  return {
    mcpServers: {
      "google-maps": {
        command: "uv",
        args: [
          "--directory",
          "mcps/google_maps",
          "run",
          "python",
          "-m",
          "google_maps_mcp"
        ],
        env: {
          ACTIVE_GEO_SERVER_URL: serverUrl
        },
        tool_timeout_sec: 90
      }
    }
  };
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

function tomlValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
