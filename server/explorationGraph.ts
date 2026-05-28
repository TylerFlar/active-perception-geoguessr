import type { ExplorationEvidence, ExplorationEvidenceSource, ExplorationFrame, ExplorationGraphNode, ExplorationGraphSummary } from "../src/agent/types";
import type { NavigatorFrame } from "./providers/prompt";

interface StoredFrame extends ExplorationFrame {
  filePath?: string;
}

interface StoredExplorationNode extends Omit<ExplorationGraphNode, "frames"> {
  filePath?: string;
  url?: string;
  frames: StoredFrame[];
}

interface MutableExplorationGraph extends Omit<ExplorationGraphSummary, "nodes"> {
  nodes: StoredExplorationNode[];
  createdAt: number;
  updatedAt: number;
}

const MAX_GRAPHS = 24;
const MAX_NODES_PER_GRAPH = 40;
const MAX_EDGES_PER_GRAPH = 60;
const MAX_FRAMES_PER_NODE = 12;
const MAX_EVIDENCE_PER_GRAPH = 80;

const graphs = new Map<string, MutableExplorationGraph>();

export function resetExplorationGraph(runId: string): void {
  graphs.delete(runId);
}

export function addFrameToGraph(params: {
  runId: string;
  turnIndex: number;
  frame: NavigatorFrame;
  arrivedVia?: string;
  currentUrl?: string;
}): ExplorationGraphSummary {
  const graph = ensureGraph(params.runId);
  const previous = graph.currentNodeId;
  const shouldCreateNode = !graph.currentNodeId || Boolean(params.arrivedVia);
  const frame = storedFrame(params.frame);

  if (shouldCreateNode) {
    const id = nodeId(params.turnIndex, graph.nodes.length);
    graph.nodes.push({
      id,
      label: params.arrivedVia ? `Street View node after ${params.arrivedVia}` : "Starting Street View node",
      turnIndex: params.turnIndex,
      filePath: frame.filePath,
      url: params.currentUrl,
      publicUrl: frame.publicUrl,
      arrivedVia: params.arrivedVia,
      frames: [frame]
    });
    if (previous) {
      graph.edges.push({
        from: previous,
        to: id,
        action: params.arrivedVia || "move"
      });
    }
    graph.currentNodeId = id;
  } else {
    const current = graph.nodes.find((node) => node.id === graph.currentNodeId);
    if (current) {
      current.turnIndex = params.turnIndex;
      current.frames.push(frame);
      current.frames = current.frames.slice(-MAX_FRAMES_PER_NODE);
      current.filePath = frame.filePath ?? current.filePath;
      current.url = params.currentUrl ?? current.url;
      current.publicUrl = frame.publicUrl ?? current.publicUrl;
    }
  }

  trimGraph(graph);
  return snapshotGraph(graph);
}

export function getExplorationGraph(runId: string | undefined): ExplorationGraphSummary | undefined {
  if (!runId) {
    return undefined;
  }
  const graph = graphs.get(runId);
  return graph ? snapshotGraph(graph) : undefined;
}

export function addEvidenceToGraph(params: {
  runId: string;
  turnIndex: number;
  evidence: Array<{
    type: ExplorationEvidence["type"];
    source: ExplorationEvidenceSource;
    text: string;
    confidence: number;
    nodeId?: string;
    frameId?: string;
  }>;
}): ExplorationGraphSummary | undefined {
  const graph = graphs.get(params.runId);
  if (!graph || params.evidence.length === 0) {
    return graph ? snapshotGraph(graph) : undefined;
  }

  const currentNode = graph.nodes.find((node) => node.id === graph.currentNodeId);
  const latestFrame = currentNode?.frames.at(-1);
  const existingKeys = new Set(graph.evidence.map(evidenceKey));
  for (const entry of params.evidence) {
    const text = entry.text.trim();
    if (!text) {
      continue;
    }
    const item: ExplorationEvidence = {
      id: evidenceId(params.turnIndex, graph.evidence.length),
      turnIndex: params.turnIndex,
      nodeId: entry.nodeId ?? currentNode?.id,
      frameId: entry.frameId ?? latestFrame?.id,
      type: entry.type,
      source: entry.source,
      text,
      confidence: clamp01(entry.confidence)
    };
    const key = evidenceKey(item);
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    graph.evidence.push(item);
  }

  trimGraph(graph);
  return snapshotGraph(graph);
}

export function explorationImagePaths(runId: string, maxNodes: number): string[] {
  const graph = graphs.get(runId);
  if (!graph) {
    return [];
  }
  return graph.nodes
    .slice(-maxNodes)
    .flatMap((node) => node.frames.flatMap((frame) => frame.filePath ? [frame.filePath] : []));
}

function storedFrame(frame: NavigatorFrame): StoredFrame {
  return {
    id: frame.id,
    label: frame.label,
    filePath: frame.filePath,
    publicUrl: frame.publicUrl,
    heading: frame.heading,
    pitch: frame.pitch,
    zoom: frame.zoom
  };
}

function ensureGraph(runId: string): MutableExplorationGraph {
  const existing = graphs.get(runId);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const graph: MutableExplorationGraph = {
    nodes: [],
    edges: [],
    evidence: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  graphs.set(runId, graph);
  trimGraphs();
  return graph;
}

function trimGraph(graph: MutableExplorationGraph): void {
  graph.updatedAt = Date.now();
  const removed = Math.max(0, graph.nodes.length - MAX_NODES_PER_GRAPH);
  if (removed > 0) {
    const removedIds = new Set(graph.nodes.slice(0, removed).map((node) => node.id));
    graph.nodes = graph.nodes.slice(removed);
    graph.edges = graph.edges.filter((edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to));
    if (graph.currentNodeId && removedIds.has(graph.currentNodeId)) {
      graph.currentNodeId = graph.nodes.at(-1)?.id;
    }
  }
  if (graph.edges.length > MAX_EDGES_PER_GRAPH) {
    graph.edges = graph.edges.slice(-MAX_EDGES_PER_GRAPH);
  }
  if (graph.evidence.length > MAX_EVIDENCE_PER_GRAPH) {
    graph.evidence = graph.evidence.slice(-MAX_EVIDENCE_PER_GRAPH);
  }
}

function trimGraphs(): void {
  if (graphs.size <= MAX_GRAPHS) {
    return;
  }
  const oldest = [...graphs.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
  if (oldest) {
    graphs.delete(oldest[0]);
  }
}

function snapshotGraph(graph: MutableExplorationGraph): ExplorationGraphSummary {
  return {
    nodes: graph.nodes.map(({ filePath: _filePath, url: _url, frames, ...node }) => ({
      ...node,
      frames: frames.map(({ filePath: _framePath, ...frame }) => ({ ...frame }))
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    evidence: graph.evidence.map((entry) => ({ ...entry })),
    currentNodeId: graph.currentNodeId
  };
}

function nodeId(turnIndex: number, offset: number): string {
  return `t${turnIndex}-node-${offset}`;
}

function evidenceId(turnIndex: number, offset: number): string {
  return `t${turnIndex}-evidence-${offset}`;
}

function evidenceKey(entry: Pick<ExplorationEvidence, "type" | "source" | "text" | "nodeId">): string {
  return [entry.type, entry.source, entry.nodeId || "", entry.text.toLowerCase()].join("|");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}
