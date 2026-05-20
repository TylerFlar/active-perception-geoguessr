import type { AgentStepRequest, AgentTurn, PanoState } from "../../src/agent/types";
import { summarizeToolCatalog, type McpConfigFile } from "../../src/mcp/perceptionContracts";
import type { PerceptionPrepass } from "../perceptionPrepass";

export function buildNavigatorGeographerPrompt(params: {
  request: AgentStepRequest;
  snapshotPath?: string;
  snapshotWarning?: string;
  mcpConfig: McpConfigFile;
  perception?: PerceptionPrepass;
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
    perceptionPrepassSection(params.perception),
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
    "- COMMIT EARLY: your top priority is producing the final JSON output. Never spend more than 3 perception/inspection turns before committing to an answer.",
    "- If you can identify the country or region from architecture, vegetation, or general visual cues alone, that is sufficient — country/region with moderate confidence is a useful guess, do not chase city-level precision at the cost of producing no answer at all.",
    "- Perception MCP tools (ocr_read_text, read_plate, place_lookup, make_crops) are OPTIONAL aids. If the first OCR/crop attempt returns no useful text, do not retry with different coordinates — fall back to your direct visual analysis of the image and commit to a guess based on it.",
    "- If a small sign, plate, road shield, bollard, utility pole, road marking, distinctive vegetation, or architectural cue is visible, inspect or zoom toward it.",
    "- If the current frame is weak, pan to another heading before moving.",
    "- Move only when the available link direction is likely to expose more signs, intersections, businesses, road shields, or settlement clues.",
    "- Return status=final when the evidence is strong enough for a useful guess. \"Useful\" means country-level confidence ≥ 0.5, not city-level certainty.",
    "- For navigator.action, include every action field. Use null only for fields that do not apply to the selected action type.",
    "- The selected action type determines which fields must be non-null:",
    "  - type=pan: headingDelta must be a number (use 0 for no horizontal change). pitchDelta is optional.",
    "  - type=zoom: zoomDelta must be a number.",
    "  - type=move: linkIndex must be a non-negative integer that matches an available move.",
    "  - type=inspect: target must be one of sign, plate, road, vegetation, architecture, utility, sky, other.",
    "  - type=hold: only reason matters; every other field should be null.",
    "- If there is no final guess yet, set finalGuess to an object with country/region/city/lat/lng null, confidence 0, and evidence [].",
    "",
    "OUTPUT FORMAT — CRITICAL:",
    "- Your final assistant message MUST be exactly one JSON object that matches the provided schema.",
    "- The very first character of your final message MUST be `{`. The very last character MUST be `}`.",
    "- No markdown. No bold. No headings. No bullet lists. No preamble like 'Here is the answer:'. No code fences. No explanation text before or after the JSON.",
    "- All schema fields are required by the transport. Use null when a value does not apply; do not omit fields.",
    "- Example of a valid final message (values are illustrative only):",
    JSON.stringify({
      status: "final",
      navigator: {
        observation: "French Haussmann facade visible on left; Notre-Dame spire in the distance.",
        perceptionCalls: [],
        action: {
          type: "hold",
          headingDelta: null,
          pitchDelta: null,
          zoomDelta: null,
          linkIndex: null,
          target: null,
          heading: null,
          pitch: null,
          zoom: null,
          reason: "Sufficient evidence for final guess."
        }
      },
      geographer: {
        hypotheses: [
          {
            country: "France",
            region: "Île-de-France",
            city: "Paris",
            lat: 48.8566,
            lng: 2.3522,
            confidence: 0.82,
            evidence: ["French Second Empire architecture", "Notre-Dame spire visible"]
          }
        ],
        instructionToNavigator: null,
        finalGuess: {
          country: "France",
          region: "Île-de-France",
          city: "Paris",
          lat: 48.8566,
          lng: 2.3522,
          confidence: 0.82,
          evidence: ["French Second Empire architecture", "Notre-Dame spire visible"]
        }
      },
      uiMessage: "Final guess: Paris, France (confidence 0.82)."
    })
  ].join("\n");
}

function perceptionPrepassSection(perception?: PerceptionPrepass): string {
  if (!perception) {
    return "";
  }
  if (!perception.ok) {
    return [
      "Perception pre-pass: unavailable this turn" + (perception.note ? ` (${perception.note})` : "") + ".",
      ""
    ].join("\n");
  }
  const ocr = perception.ocrTexts.length
    ? JSON.stringify(perception.ocrTexts)
    : "none — the OCR reader found no legible text in this frame";
  const plates = perception.plates.length
    ? JSON.stringify(perception.plates)
    : "none — the plate reader detected no readable plate in this frame";
  return [
    `Perception pre-pass (OCR + ALPR were already run server-side on this frame in ${perception.elapsedSec ?? "?"}s):`,
    `- OCR text detections: ${ocr}`,
    `- License plate detections: ${plates}`,
    "Use these results directly as Navigator observations. Do NOT call ocr_read_text or read_plate again this turn —",
    "a 'none' result is a real negative, not a reason to retry. Only use make_crops/place_lookup if genuinely needed.",
    ""
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
