import type {
  ExplorationGraphSummary,
  ExplorationGraphNode,
} from "../src/agent/types";

export function buildCoveragePrompt(
  graph: ExplorationGraphSummary | undefined,
): string {
  if (!graph?.nodes.length || !graph.currentNodeId) {
    return [
      "Coverage-aware exploration:",
      "- No graph coverage yet. Inspect the current view for distinctive evidence.",
      "- If evidence is weak, move or pan to build spatial coverage.",
      "",
    ].join("\n");
  }

  const current = graph.nodes.find((n) => n.id === graph.currentNodeId);
  if (!current) return "";

  const outgoing = graph.edges.filter((e) => e.from === current.id);
  const incoming = graph.edges.filter((e) => e.to === current.id);

  const frontierNodes = graph.nodes.filter((node) =>
    isFrontierNode(graph, node),
  );

  const lowInfoCurrent =
    current.frames.length >= 2 &&
    graph.evidence.length <= 1;

  const likelyDeadEnd =
    outgoing.length === 0 ||
    (outgoing.length <= 1 && current.frames.length >= 2 && lowInfoCurrent);

  const currentHeadingBins = headingBinsForNode(current);
  const unseenHeadings = unseenHeadingBins(currentHeadingBins).slice(0, 3);

  const recommendations: string[] = [];

  if (likelyDeadEnd) {
    recommendations.push(
      "Current node appears to be a low-information dead end. Backtracking is allowed; return toward the nearest frontier/intersection rather than repeatedly inspecting this node.",
    );
  }

  if (frontierNodes.length > 0) {
    recommendations.push(
      `There are ${frontierNodes.length} frontier node(s) in the graph. Prefer moving toward a frontier with unexplored paths if the current view has weak evidence.`,
    );
  }

  if (!likelyDeadEnd && unseenHeadings.length > 0) {
    recommendations.push(
      `Before leaving this node, consider checking unseen headings: ${unseenHeadings
        .map((h) => `~${h}°`)
        .join(", ")}.`,
    );
  }

  if (outgoing.length === 0 && incoming.length > 0) {
    recommendations.push(
      "No new outgoing move has been recorded from this node; consider moving back along the incoming path.",
    );
  }

  recommendations.push(
    "Do not avoid all revisits: revisiting is useful when it returns to an intersection or frontier.",
  );

  return [
    "Coverage-aware exploration:",
    `- Graph coverage: ${graph.nodes.length} node(s), ${graph.edges.length} move edge(s), ${graph.evidence.length} evidence item(s).`,
    `- Current node: ${current.id}; frames here: ${current.frames.length}; outgoing edges: ${outgoing.length}; incoming edges: ${incoming.length}.`,
    `- Frontier nodes available: ${frontierNodes.length}.`,
    "- Recommended exploration priorities:",
    ...recommendations.slice(0, 5).map((r) => `  - ${r}`),
    "- Prefer frontier expansion over repeatedly inspecting a low-information dead end.",
    "- Backtracking is allowed when it helps reach an unexplored branch.",
    "",
  ].join("\n");
}

function isFrontierNode(
  graph: ExplorationGraphSummary,
  node: ExplorationGraphNode,
): boolean {
  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const incoming = graph.edges.filter((e) => e.to === node.id);

  // Heuristic: node may be useful if it has few explored outgoing moves,
  // especially if it is an intersection-like point reached from somewhere else.
  return incoming.length > 0 && outgoing.length <= 1;
}

function headingBinsForNode(node: ExplorationGraphNode): Set<number> {
  return new Set(node.frames.map((f) => headingBin(f.heading)));
}

function headingBin(heading: number): number {
  const normalized = ((heading % 360) + 360) % 360;
  return Math.round(normalized / 45) * 45 % 360;
}

function unseenHeadingBins(seen: Set<number>): number[] {
  return [0, 45, 90, 135, 180, 225, 270, 315].filter((h) => !seen.has(h));
}