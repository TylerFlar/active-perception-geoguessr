import type { AgentStepRequest, AgentTurn, StreetViewState } from "../../src/agent/types";
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
  const redactedView = redactedViewForPrompt(params.request.view);
  const mcpServerNames = Object.keys(params.mcpConfig.mcpServers);

  return [
    "You are running an active visual geolocation loop over a live Google Maps Street View browser window.",
    "",
    "Roles:",
    "- Navigator: inspect the current visual frame, use available perception and Google Maps MCP tools when useful, and choose exactly one next camera/navigation action.",
    "- Geographer: maintain location hypotheses from visual evidence only, then either give a best guess or instruct the Navigator what clue to seek next.",
    "",
    "Fairness constraints:",
    "- Do not use hidden coordinates, URLs, Street View IDs, API metadata, file names, EXIF, or server-side browser state as evidence.",
    "- The screenshot itself, prior observations, visible street-view imagery, and explicit perception-tool outputs are fair evidence.",
    "- Masked black regions are HUD/copyright/search UI redactions. Treat them as unavailable pixels, not as geolocation evidence.",
    "- Prefer cautious country/region/city hypotheses over fake precision. Coordinates are optional and should be approximate unless evidence is unusually strong.",
    "",
    "Current camera state, with coordinates and URL intentionally removed:",
    JSON.stringify(redactedView, null, 2),
    "",
    params.snapshotPath
      ? `The current masked Google Maps frame is attached and also available at this local path for tools that accept image paths: ${params.snapshotPath}`
      : `No current snapshot file is available. Snapshot warning: ${params.snapshotWarning || "none"}`,
    "",
    perceptionPrepassSection(params.perception),
    "Available perception MCP tools:",
    summarizeToolCatalog(),
    "",
    "Available Google Maps MCP tools for CLI providers:",
    "- google_maps_screenshot: recaptures the current masked Google Maps frame and returns a local image path.",
    "- google_maps_pan: drags Street View by heading/pitch deltas.",
    "- google_maps_zoom: zooms the Street View frame in or out.",
    "- google_maps_move: clicks one of the available screen move targets.",
    "- google_maps_inspect: pans/zooms toward an inspection target.",
    "- google_maps_status: reports whether the controlled Google Maps window is open without revealing hidden location evidence.",
    "If you call a google_maps_* control tool during this turn, return navigator.action.type=\"hold\" unless you intentionally want the app to apply an additional action after your JSON.",
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
    "- If you can identify the country or region from architecture, vegetation, road furniture, signs, plates, or general visual cues alone, that is sufficient. Country/region with moderate confidence is useful; do not chase city-level precision at the cost of producing no answer.",
    "- Perception MCP tools (ocr_read_text, read_plate, place_lookup, make_crops) are optional aids. If the first OCR/crop attempt returns no useful text, do not retry with different coordinates; fall back to direct visual analysis and commit to a guess based on it.",
    "- If a small sign, plate, road shield, bollard, utility pole, road marking, distinctive vegetation, or architectural cue is visible, inspect or zoom toward it.",
    "- If the current frame is weak, pan to another heading before moving.",
    "- Move only when the selected screen target is likely to expose more signs, intersections, businesses, road shields, or settlement clues.",
    "- Return status=final when the evidence is strong enough for a useful guess. Useful means country-level confidence >= 0.5, not city-level certainty.",
    "- For navigator.action, include every action field. Use null only for fields that do not apply to the selected action type.",
    "- The selected action type determines which fields must be non-null:",
    "  - type=pan: headingDelta must be a number (use 0 for no horizontal change). pitchDelta is optional.",
    "  - type=zoom: zoomDelta must be a number.",
    "  - type=move: linkIndex must be a non-negative integer that matches an available move target.",
    "  - type=inspect: target must be one of sign, plate, road, vegetation, architecture, utility, sky, other.",
    "  - type=hold: only reason matters; every other field should be null.",
    "- If there is no final guess yet, set finalGuess to an object with country/region/city/lat/lng null, confidence 0, and evidence [].",
    "",
    "OUTPUT FORMAT - CRITICAL:",
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
            region: "Ile-de-France",
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
          region: "Ile-de-France",
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
  if (!perception.ok && !perception.ocrError && !perception.plateError) {
    return [
      "Perception pre-pass: unavailable this turn" + (perception.note ? ` (${perception.note})` : "") + ".",
      ""
    ].join("\n");
  }
  const ocr = perception.ocrError
    ? `unavailable (${perception.ocrError})`
    : perception.ocrTexts.length
    ? JSON.stringify(perception.ocrTexts)
    : "none - the OCR reader found no legible text in this frame";
  const plates = perception.plateError
    ? `unavailable (${perception.plateError})`
    : perception.plates.length
    ? JSON.stringify(perception.plates)
    : "none - the plate reader detected no readable plate in this frame";
  const completedTools = [
    perception.ocrError ? undefined : "ocr_read_text",
    perception.plateError ? undefined : "read_plate"
  ].filter((tool): tool is string => Boolean(tool));
  const retryGuidance = perception.ok
    ? [
        "Use these results directly as Navigator observations. Do not call ocr_read_text or read_plate again this turn;",
        "a 'none' result is a real negative, not a reason to retry. Only use make_crops/place_lookup if genuinely needed."
      ]
    : [
        "Use successful pre-pass results directly as Navigator observations.",
        completedTools.length
          ? `Do not call ${completedTools.join(" or ")} again this turn; its 'none' result is a real negative.`
          : "Unavailable reader results are not negative visual evidence.",
        "Only call a failed/unavailable reader, make_crops, or place_lookup if genuinely needed."
      ];
  return [
    `Perception pre-pass (OCR + ALPR were already run server-side on this frame in ${perception.elapsedSec ?? "?"}s):`,
    `- OCR text detections: ${ocr}`,
    `- License plate detections: ${plates}`,
    ...retryGuidance,
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

function redactedViewForPrompt(view: StreetViewState) {
  return {
    heading: round(view.heading),
    pitch: round(view.pitch),
    zoom: round(view.zoom),
    availableMoves: view.moves.map((move) => ({
      index: move.index,
      screenX: round(move.screenX),
      screenY: round(move.screenY),
      description: move.description
    }))
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
