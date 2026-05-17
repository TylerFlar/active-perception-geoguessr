import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERCEPTION_TOOLS,
  buildClaudeMcpConfig,
  buildCodexMcpArgs,
  parseMcpConfig,
  summarizeToolCatalog
} from "./perceptionContracts";

describe("perception MCP contracts", () => {
  it("keeps the lightweight cue tools in the default catalog", () => {
    const ids = DEFAULT_PERCEPTION_TOOLS.map((tool) => tool.id);

    expect(ids).toContain("crop.make");
    expect(ids).toContain("ocr.read_text");
    expect(ids).toContain("alpr.read_plate");
    expect(ids).toContain("place.lookup");
    expect(ids).not.toContain("objects.detect");
    expect(ids).not.toContain("segments.find_regions");
  });

  it("summarizes MCP tool names for the navigator prompt", () => {
    const summary = summarizeToolCatalog(DEFAULT_PERCEPTION_TOOLS);

    expect(summary).toContain("make_crops");
    expect(summary).toContain("ocr_read_text");
    expect(summary).toContain("read_plate");
    expect(summary).toContain("place_lookup");
  });

  it("parses inline and path-based MCP config", () => {
    const inline = parseMcpConfig('{"mcpServers":{"ocr":{"command":"uvx","args":["rapidocr-mcp"],"env":{"A":"B"}}}}');
    const fromPath = parseMcpConfig("perception.json", () =>
      '{"mcpServers":{"plant.net":{"url":"http://127.0.0.1:8111/mcp","transport":"http"}}}'
    );

    expect(inline.mcpServers.ocr.command).toBe("uvx");
    expect(inline.mcpServers.ocr.args).toEqual(["rapidocr-mcp"]);
    expect(fromPath.mcpServers["plant-net"].url).toBe("http://127.0.0.1:8111/mcp");
  });

  it("builds isolated CLI MCP config instead of relying on global config", () => {
    const config = parseMcpConfig('{"mcpServers":{"ocr":{"command":"uvx","args":["rapidocr-mcp"],"tool_timeout_sec":99}}}');
    const codexArgs = buildCodexMcpArgs(config);
    const claudeConfig = JSON.parse(buildClaudeMcpConfig(config));

    expect(codexArgs).toContain("--ignore-user-config");
    expect(codexArgs).toContain("--ignore-rules");
    expect(codexArgs).toContain("--ephemeral");
    expect(codexArgs).toContain("mcp_servers.ocr.command=\"uvx\"");
    expect(codexArgs).toContain("mcp_servers.ocr.args=[\"rapidocr-mcp\"]");
    expect(claudeConfig.mcpServers.ocr.command).toBe("uvx");
  });
});
