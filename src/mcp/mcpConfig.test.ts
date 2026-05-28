import { describe, expect, it } from "vitest";
import { buildClaudeMcpConfig, buildCodexMcpArgs, buildGoogleMapsMcpConfig } from "./mcpConfig";

describe("MCP config", () => {
  it("uses the project-local Google Maps MCP as the only default server", () => {
    const config = buildGoogleMapsMcpConfig("http://127.0.0.1:5173");

    expect(Object.keys(config.mcpServers)).toEqual(["google-maps"]);
    expect(config.mcpServers["google-maps"]).toMatchObject({
      command: "uv",
      args: ["--directory", "mcps/google_maps", "run", "python", "-m", "google_maps_mcp"],
      env: { ACTIVE_GEO_SERVER_URL: "http://127.0.0.1:5173" },
      tool_timeout_sec: 90
    });
  });

  it("builds isolated CLI MCP config instead of relying on global config", () => {
    const config = buildGoogleMapsMcpConfig("http://127.0.0.1:5173");
    const codexArgs = buildCodexMcpArgs(config);
    const claudeConfig = JSON.parse(buildClaudeMcpConfig(config));

    expect(codexArgs).toContain("--ignore-user-config");
    expect(codexArgs).toContain("--ignore-rules");
    expect(codexArgs).toContain("--ephemeral");
    expect(codexArgs).toContain("mcp_servers.google-maps.command=\"uv\"");
    expect(codexArgs).toContain("mcp_servers.google-maps.env.ACTIVE_GEO_SERVER_URL=\"http://127.0.0.1:5173\"");
    expect(claudeConfig.mcpServers["google-maps"].command).toBe("uv");
  });
});
