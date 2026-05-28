import type { AgentStepRequest, AgentTurn, ExplorationGraphSummary, StreetViewState } from "../../src/agent/types";
import type { McpConfigFile } from "../../src/mcp/mcpConfig";
import type { AgentModelOutput } from "./schema";

export interface NavigatorFrame {
  id: string;
  label: string;
  filePath?: string;
  publicUrl?: string;
  actionFromPrevious?: string;
  heading: number;
  pitch: number;
  zoom: number;
}

export function buildNavigatorPrompt(params: {
  request: AgentStepRequest;
  snapshotPath?: string;
  snapshotWarning?: string;
  mcpConfig: McpConfigFile;
  frames?: NavigatorFrame[];
  explorationGraph?: ExplorationGraphSummary;
}): string {
  const history = params.request.history.slice(-10).map(historyTurnForPrompt);
  const redactedView = redactedViewForPrompt(params.request.view);
  const mcpServerNames = Object.keys(params.mcpConfig.mcpServers);
  const instruction = navigatorInstructionFromHistory(params.request.history);

  return [
    "You are the Navigator in an active visual geolocation workflow.",
    "Your role is to inspect the live Google Maps Street View scene and report direct visual evidence. The Geographer handles location reasoning; your message stays focused on what is visible, what you checked, and what remains uncertain.",
    "",
    "Navigator behavior:",
    "Begin with the attached current Street View frame. If it already has useful clues, report them and hold position. When another view would help the city guess, use the Google Maps tools to pan, zoom, inspect, move, or capture a fresh screenshot. Movement is optional and should serve the evidence.",
    "",
    "The easiest tool is google_maps_look because it can take one camera or movement action and immediately return the resulting screenshot. The lower-level tools are available when you want finer control. Each captured frame records the current physical node, heading, pitch, and zoom, so the graph can remember where you looked.",
    "",
    "Follow Geographer or Verifier instructions when they point to a clue worth checking. Native web search or model tools may be used to check public information from visible clues; keep those search results separate from direct visual facts. Useful evidence includes visible text, road markings, signs, businesses, institutions, road shields, plates, vegetation, architecture, traffic control, and settlement clues.",
    "",
    "Evidence boundary:",
    "Evidence comes from the screenshot, prior observations, visible Street View imagery, explicit Google Maps tool outputs, and public searches grounded in visible clues. Hidden coordinates, URLs, Street View IDs, API metadata, file names, EXIF, and server-side browser state stay outside the evidence set. Masked black regions are unavailable pixels.",
    "",
    "Current camera state, with coordinates and URL intentionally removed:",
    JSON.stringify(redactedView, null, 2),
    "",
    params.snapshotPath
      ? `Initial masked Google Maps frame: ${params.snapshotPath}`
      : `Initial snapshot file unavailable. Snapshot warning: ${params.snapshotWarning || "none"}`,
    "",
    framesSection(params.frames),
    explorationGraphSection(params.explorationGraph),
    "Available Google Maps MCP tools:",
    "- google_maps_look: easiest tool. Optionally performs one action, then captures and returns the current masked Street View frame with node id, heading, pitch, and zoom.",
    "- google_maps_screenshot: captures the current masked Street View frame as image content and records node id, heading, pitch, and zoom.",
    "- google_maps_pan: changes camera heading/pitch without moving.",
    "- google_maps_zoom: changes camera zoom without moving.",
    "- google_maps_inspect: aims the camera at a specific heading/pitch/zoom when you know where you want to look.",
    "- google_maps_move: physically moves to one available Street View link target by link_index.",
    "- google_maps_status: reports whether the controlled Google Maps window is open without revealing hidden location evidence.",
    "",
    mcpServerNames.length
      ? `Injected MCP servers for this navigator call: ${mcpServerNames.join(", ")}.`
      : "External MCP servers injected for this navigator call: none. Use native visual reasoning only.",
    "",
    "Instruction from previous reasoning step:",
    instruction || "Inspect the current scene for the strongest readable and distinctive clues. Move only if it seems useful.",
    "",
    "Recent workflow history:",
    history.length ? JSON.stringify(history, null, 2) : "[]",
    "",
    "Output rules:",
    "- Return status=continue.",
    "- Fill navigator.observation with a compact but evidence-rich survey report.",
    "- Fill visibleText, roadClues, placeClues, environmentClues, and uncertainty as short arrays. Use [] for an empty category.",
    "- Fill navigator.surveySteps with visual inspection summaries, searches, and any tool action you used.",
    "- Leave geographer.finalGuess empty and verifier as decision=continue because those roles run separately.",
    outputFormatRules()
  ].join("\n");
}

export function buildGeographerPrompt(params: {
  request: AgentStepRequest;
  navigatorOutput: AgentModelOutput;
  explorationGraph?: ExplorationGraphSummary;
}): string {
  const history = params.request.history.slice(-10).map(historyTurnForPrompt);

  return [
    "You are the Geographer in an active visual geolocation workflow.",
    "Google Maps tools and image access are unavailable in this role. Reason from the Navigator's survey report and prior workflow messages.",
    "",
    "Navigator survey for this turn:",
    JSON.stringify({
      observation: params.navigatorOutput.navigator.observation,
      visibleText: params.navigatorOutput.navigator.visibleText,
      roadClues: params.navigatorOutput.navigator.roadClues,
      placeClues: params.navigatorOutput.navigator.placeClues,
      environmentClues: params.navigatorOutput.navigator.environmentClues,
      uncertainty: params.navigatorOutput.navigator.uncertainty,
      surveySteps: params.navigatorOutput.navigator.surveySteps
    }, null, 2),
    "",
    explorationGraphSection(params.explorationGraph),
    "",
    "Recent workflow history:",
    history.length ? JSON.stringify(history, null, 2) : "[]",
    "",
    "Geographer behavior:",
    "Submit the best current result every turn so the Verifier always has a concrete proposal to check. The goal is a useful city or region guess, not a proof. One strong clue or a cluster of weaker clues can be enough; road overlays, business clusters, partial text reads, and search results grounded in visible clues are all usable evidence.",
    "",
    "Use confidence and evidence notes to carry uncertainty instead of withholding the answer. If the exact city is unclear, make the best broader region/country guess and lower the confidence. If another observation would help, write that request in instructionToNavigator while still filling hypotheses and finalGuess with the current best result.",
    "",
    "Output rules:",
    "- Return status=final.",
    "- Copy the Navigator object exactly from the provided survey.",
    "- Fill hypotheses and finalGuess with the current best answer, evidence, and confidence.",
    "- Fill instructionToNavigator when one concrete next observation could improve or correct the guess.",
    "- Leave verifier as decision=continue with a short placeholder because the Verifier role runs separately after your result.",
    outputFormatRules()
  ].join("\n");
}

export function buildVerifierPrompt(params: {
  request: AgentStepRequest;
  navigatorOutput: AgentModelOutput;
  geographerOutput: AgentModelOutput;
  explorationGraph?: ExplorationGraphSummary;
}): string {
  const history = params.request.history.slice(-10).map(historyTurnForPrompt);

  return [
    "You are the Verifier in an active visual geolocation workflow.",
    "Google Maps tools and image access are unavailable in this role. Verify from the Navigator's survey and the Geographer's stated reasoning.",
    "",
    "Navigator survey:",
    JSON.stringify({
      observation: params.navigatorOutput.navigator.observation,
      visibleText: params.navigatorOutput.navigator.visibleText,
      roadClues: params.navigatorOutput.navigator.roadClues,
      placeClues: params.navigatorOutput.navigator.placeClues,
      environmentClues: params.navigatorOutput.navigator.environmentClues,
      uncertainty: params.navigatorOutput.navigator.uncertainty,
      surveySteps: params.navigatorOutput.navigator.surveySteps
    }, null, 2),
    "",
    "Geographer proposal:",
    JSON.stringify(params.geographerOutput.geographer, null, 2),
    "",
    explorationGraphSection(params.explorationGraph),
    "",
    "Recent workflow history:",
    history.length ? JSON.stringify(history, null, 2) : "[]",
    "",
    "Verifier behavior:",
    "Run a soft sanity check on the Geographer's proposal. Accept plausible guesses that are supported by the survey, including guesses based on indirect, search-derived, or imperfect evidence. Revise when the same evidence clearly supports a better final answer. Continue only when the submitted result is effectively unusable, contradicted by the evidence, or one quick observation is very likely to change the city.",
    "",
    "Confidence is part of the evidence. Moderate-confidence city-level guesses are still provisional; they should usually become a continue request for one disambiguating clue, or a revision to a broader area, unless the evidence is unusually distinctive.",
    "",
    "Movement is optional when the evidence is already strong. Google-rendered road labels, visible business clusters, search-derived business/street relationships, and missing physical cross-street signs are reasons to calibrate confidence rather than reasons to reject a plausible answer. A continue decision should name the single missing clue that would actually change the likely city.",
    "",
    "Output rules:",
    "- Copy the Navigator survey object.",
    "- Preserve or revise the Geographer fields according to your decision.",
    "- Fill verifier.decision as accept, revise, or continue with concise concerns.",
    outputFormatRules()
  ].join("\n");
}

function outputFormatRules(): string {
  return [
    "",
    "OUTPUT FORMAT:",
    "- The final assistant message is exactly one raw JSON object that matches the provided schema.",
    "- The first character is `{` and the last character is `}`.",
    "- The response body contains only the JSON object.",
    "- All schema fields are required by the transport. Use null when a value does not apply.",
    "- Empty finalGuess values use country/region/city/lat/lng null, confidence 0, and evidence []."
  ].join("\n");
}

function framesSection(frames: NavigatorFrame[] | undefined): string {
  if (!frames?.length) {
    return "";
  }
  return [
    "Attached Street View frame(s):",
    ...frames.map((frame, index) => {
      const action = frame.actionFromPrevious ? ` after ${frame.actionFromPrevious}` : "";
      const path = frame.filePath ? ` (${frame.filePath})` : "";
      const camera = `heading ${round(frame.heading)}, pitch ${round(frame.pitch)}, zoom ${round(frame.zoom)}`;
      return `- Frame ${index + 1} [${frame.id}]: ${frame.label}; ${camera}${action}${path}`;
    }),
    "Use these frames as direct visual evidence. The graph records physical nodes plus the camera direction of each captured frame.",
    ""
  ].join("\n");
}

function explorationGraphSection(graph: ExplorationGraphSummary | undefined): string {
  if (!graph?.nodes.length) {
    return "";
  }
  const nodes = graph.nodes.slice(-14).map((node) => ({
    id: node.id,
    label: node.label,
    turnIndex: node.turnIndex,
    arrivedVia: node.arrivedVia,
    capturedFrames: node.frames.map((frame) => ({
      id: frame.id,
      label: frame.label,
      heading: round(frame.heading),
      pitch: round(frame.pitch),
      zoom: round(frame.zoom)
    })),
    current: node.id === graph.currentNodeId
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .slice(-18);
  const evidence = graph.evidence.slice(-24).map((entry) => ({
    type: entry.type,
    source: entry.source,
    text: entry.text,
    confidence: round(entry.confidence),
    nodeId: entry.nodeId,
    frameId: entry.frameId
  }));
  return [
    "Persistent 2.5D/topological scene memory:",
    JSON.stringify({ nodes, edges, evidence, currentNodeId: graph.currentNodeId }, null, 2),
    "Use this memory to remember physical nodes, camera directions, and extracted evidence without relying on hidden coordinates.",
    ""
  ].join("\n");
}

function navigatorInstructionFromHistory(history: AgentTurn[]): string | undefined {
  for (const turn of [...history].reverse()) {
    const verifierConcern = turn.verifier?.decision === "continue"
      ? turn.verifier.concerns.find((concern) => concern.trim())
      : undefined;
    if (verifierConcern) {
      return turn.geographer.instructionToNavigator
        ? `${turn.geographer.instructionToNavigator} Verifier concern: ${verifierConcern}`
        : `Resolve verifier concern: ${verifierConcern}`;
    }
    if (turn.geographer.instructionToNavigator) {
      return turn.geographer.instructionToNavigator;
    }
  }
  return undefined;
}

function historyTurnForPrompt(turn: AgentTurn) {
  return {
    index: turn.index,
    status: turn.status,
    navigator: {
      observation: turn.navigator.observation,
      visibleText: turn.navigator.visibleText,
      roadClues: turn.navigator.roadClues,
      placeClues: turn.navigator.placeClues,
      environmentClues: turn.navigator.environmentClues,
      uncertainty: turn.navigator.uncertainty,
      surveySteps: turn.navigator.surveySteps
    },
    geographer: turn.geographer,
    verifier: turn.verifier,
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
