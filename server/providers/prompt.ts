import type { AgentStepRequest, AgentTurn, PanoState } from "../../src/agent/types";
import { summarizeToolCatalog, type McpConfigFile } from "../../src/mcp/perceptionContracts";

export function buildNavigatorGeographerPrompt(params: {
  request: AgentStepRequest;
  snapshotPath?: string;
  snapshotWarning?: string;
  mcpConfig: McpConfigFile;
}): string {
  const history = params.request.history.slice(-10).map(historyTurnForPrompt);
  const redactedPano = redactedPanoForPrompt(params.request.pano);
  const mcpServerNames = Object.keys(params.mcpConfig.mcpServers);

  return [
    "You are running an active visual geolocation loop over a public street-level imagery viewer.",
    "",
    "Roles:",
    "- Navigator: inspect the current visual frame, use available perception MCP tools when useful, and choose exactly one next camera/navigation action.",
    "- Geographer: maintain location hypotheses from visual evidence only, then either give a best guess or instruct the Navigator what clue to seek next.",
    "",
    "Fairness constraints:",
    "- Do not use hidden coordinates, picture IDs, sequence IDs, API metadata, file names, EXIF, or server-side map state as evidence.",
    "- The image itself, prior observations, visible road/street-view UI content, and explicit perception-tool outputs are fair evidence.",
    "- Prefer cautious country/region/city hypotheses over fake precision. Coordinates are optional and should be approximate unless evidence is unusually strong.",
    "",
    "Current camera state, with coordinates intentionally removed:",
    JSON.stringify(redactedPano, null, 2),
    "",
    params.snapshotPath
      ? `The current street-level image is attached and also available at this local path for tools that accept image paths: ${params.snapshotPath}`
      : `No current snapshot file is available. Snapshot warning: ${params.snapshotWarning || "none"}`,
    "",
    "Available perception MCP tools:",
    summarizeToolCatalog(),
    "",
    mcpServerNames.length
      ? `Injected MCP servers for this run: ${mcpServerNames.join(", ")}.`
      : "No external MCP servers are injected for this run. Use native visual reasoning and report perceptionCalls as visual inspection summaries.",
    "",
    "Recent loop history:",
    history.length ? JSON.stringify(history, null, 2) : "[]",
    "",
    "Action policy:",
    "- If a small sign, plate, road shield, bollard, utility pole, road marking, distinctive vegetation, or architectural cue is visible, inspect or zoom toward it.",
    "- If the current frame is weak, pan to another heading before moving.",
    "- Move only when the available link direction is likely to expose more signs, intersections, businesses, road shields, or settlement clues.",
    "- Return status=final when the evidence is strong enough for a useful guess.",
    "- For navigator.action, include every action field. Use null for fields that do not apply to the selected action type.",
    "- If there is no final guess yet, set finalGuess to an object with country/region/city/lat/lng null, confidence 0, and evidence [].",
    "",
    "Return only JSON matching the provided schema. No markdown."
    + " Optional schema fields are still required by the transport; use null when a value is unknown."
  ].join("\n");
}

function historyTurnForPrompt(turn: AgentTurn) {
  return {
    index: turn.index,
    status: turn.status,
    navigator: turn.navigator,
    geographer: turn.geographer,
    uiMessage: turn.uiMessage
  };
}

function redactedPanoForPrompt(pano: PanoState) {
  return {
    heading: round(pano.heading),
    pitch: round(pano.pitch),
    zoom: round(pano.zoom),
    availableMoves: pano.links.map((link) => ({
      index: link.index,
      heading: round(link.heading)
    }))
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
