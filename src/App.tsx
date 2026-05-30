import { AlertCircle, Camera, Image as ImageIcon, LocateFixed, Map as MapIcon, MapPinned, Minus, Navigation, Play, Plus, Square, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStepResponse, AgentTurn, ExplorationGraphSummary, StreetViewState } from "./agent/types";

interface AppConfig {
  googleMapsStartUrl: string;
  provider: string;
  providerModel?: string;
  mcpServers: string[];
}

interface GoogleMapsStatus {
  open: boolean;
  streetView: boolean;
  currentUrl?: string;
  state: StreetViewState;
  lastSnapshotUrl?: string;
  message?: string;
}

interface RunLogEvent {
  id: string;
  at: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: unknown;
}

const MAX_AUTO_TURNS = 8;

export default function App() {
  const autoRunRef = useRef(false);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [mapsStatus, setMapsStatus] = useState<GoogleMapsStatus | null>(null);
  const [latestSnapshotUrl, setLatestSnapshotUrl] = useState("");
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [runId, setRunId] = useState("");
  const [logs, setLogs] = useState<RunLogEvent[]>([]);
  const [status, setStatus] = useState("Idle");
  const [isRunning, setIsRunning] = useState(false);
  const [mainView, setMainView] = useState<"street" | "map">("street");
  const [liveGraph, setLiveGraph] = useState<ExplorationGraphSummary | undefined>();

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((payload: AppConfig) => setConfig(payload))
      .catch((error: Error) => setConfigError(error.message));
  }, []);

  const refreshMapsStatus = useCallback(async () => {
    const response = await fetch("/api/maps/status");
    const payload = (await response.json()) as GoogleMapsStatus;
    setMapsStatus(payload);
    if (payload.lastSnapshotUrl) {
      setLatestSnapshotUrl(payload.lastSnapshotUrl);
    }
    return payload;
  }, []);

  useEffect(() => {
    void refreshMapsStatus().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshMapsStatus().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshMapsStatus]);

  useEffect(() => {
    if (!runId) {
      return;
    }
    const events = new EventSource(`/api/runs/${encodeURIComponent(runId)}/logs`);
    events.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RunLogEvent;
      setLogs((current) => [...current, parsed].slice(-160));
    };
    events.onerror = () => {
      setLogs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          source: "browser",
          level: "warn" as const,
          message: "Log stream disconnected"
        }
      ].slice(-160));
      events.close();
    };
    return () => events.close();
  }, [runId]);

  useEffect(() => {
    if (!runId || (!isRunning && mainView !== "map")) {
      return;
    }

    let cancelled = false;
    const loadGraph = async () => {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/graph`);
      const payload = (await response.json()) as { ok: boolean; graph?: ExplorationGraphSummary };
      if (!cancelled && payload.graph) {
        setLiveGraph(payload.graph);
      }
    };

    void loadGraph().catch(() => undefined);
    const timer = window.setInterval(() => {
      void loadGraph().catch(() => undefined);
    }, 900);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, isRunning, mainView]);

  const latestGuess = useMemo(() => {
    const final = [...history].reverse().find((turn) => turn.geographer.finalGuess);
    return final?.geographer.finalGuess ?? [...history].reverse()[0]?.geographer.hypotheses[0];
  }, [history]);

  const latestTurnGraph = useMemo(() => {
    return [...history].reverse().find((turn) => turn.explorationGraph)?.explorationGraph;
  }, [history]);
  const latestGraph = liveGraph ?? latestTurnGraph;

  const openMaps = useCallback(async () => {
    setStatus("Opening Maps");
    const response = await postJson("/api/maps/open", { url: config?.googleMapsStartUrl });
    const payload = (await response.json()) as GoogleMapsStatus;
    setMapsStatus(payload);
    setStatus(payload.streetView ? "Street View ready" : payload.message || "Maps ready");
  }, [config?.googleMapsStartUrl]);

  const capturePreview = useCallback(async () => {
    if (!mapsStatus?.streetView) {
      setStatus(mapsStatus?.message || "Street View not selected");
      return;
    }
    setStatus("Capturing");
    const response = await postJson("/api/maps/snapshot", {});
    const payload = (await response.json()) as {
      publicUrl?: string;
      warning?: string;
      state: StreetViewState;
      graph?: ExplorationGraphSummary;
    };
    if (payload.publicUrl) {
      setLatestSnapshotUrl(payload.publicUrl);
    }
    if (payload.graph) {
      setLiveGraph(payload.graph);
    }
    setMapsStatus((current) => current ? { ...current, state: payload.state, lastSnapshotUrl: payload.publicUrl } : current);
    setStatus(payload.warning || "Captured");
  }, [mapsStatus?.message, mapsStatus?.streetView]);

  const runOneStep = useCallback(
    async (nextHistory: AgentTurn[], options?: { runId?: string }) => {
      if (!mapsStatus?.streetView) {
        setStatus(mapsStatus?.message || "Street View not selected");
        return nextHistory;
      }

      setStatus("Thinking");
      const response = await fetch("/api/agent/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          view: mapsStatus.state,
          history: nextHistory,
          runId: options?.runId,
          maxTurns: MAX_AUTO_TURNS
        })
      });
      const payload = (await response.json()) as AgentStepResponse;
      const updatedHistory = [...nextHistory, payload.turn];
      setHistory(updatedHistory);
      if (payload.turn.explorationGraph) {
        setLiveGraph(payload.turn.explorationGraph);
      }
      if (payload.turn.snapshotUrl) {
        setLatestSnapshotUrl(payload.turn.snapshotUrl);
      }
      setMapsStatus((current) => current ? { ...current, state: payload.turn.view, lastSnapshotUrl: payload.turn.snapshotUrl } : current);
      setStatus(payload.turn.status === "continue" ? "Navigating" : payload.turn.status);
      void refreshMapsStatus().catch(() => undefined);

      return updatedHistory;
    },
    [mapsStatus?.message, mapsStatus?.state, mapsStatus?.streetView, refreshMapsStatus]
  );

  const startLoop = useCallback(async () => {
    if (isRunning || !mapsStatus?.streetView) {
      return;
    }
    setHistory([]);
    const nextRunId = crypto.randomUUID();
    setRunId(nextRunId);
    setLogs([]);
    setLiveGraph(undefined);
    setIsRunning(true);
    autoRunRef.current = true;
    let nextHistory: AgentTurn[] = [];

    try {
      for (let i = 0; i < MAX_AUTO_TURNS && autoRunRef.current; i += 1) {
        nextHistory = await runOneStep(nextHistory, { runId: nextRunId });
        const last = nextHistory[nextHistory.length - 1];
        if (!last || last.status !== "continue") {
          break;
        }
        await wait(900);
      }
    } finally {
      autoRunRef.current = false;
      setIsRunning(false);
      setStatus((current) => (current === "Navigating" || current === "Thinking" ? "Idle" : current));
    }
  }, [isRunning, mapsStatus?.streetView, runOneStep]);

  const stopLoop = useCallback(() => {
    autoRunRef.current = false;
    setIsRunning(false);
    setStatus("Stopped");
  }, []);

  const stepOnce = useCallback(async () => {
    if (isRunning || !mapsStatus?.streetView) {
      return;
    }
    setIsRunning(true);
    const nextRunId = history.length > 0 && runId ? runId : crypto.randomUUID();
    setRunId(nextRunId);
    if (history.length === 0) {
      setLogs([]);
      setLiveGraph(undefined);
    }
    try {
      await runOneStep(history, { runId: nextRunId });
    } finally {
      setIsRunning(false);
      setStatus("Idle");
    }
  }, [history, isRunning, mapsStatus?.streetView, runId, runOneStep]);

  const canUseMaps = Boolean(mapsStatus?.streetView) && !isRunning;

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="titleBlock">
          <h1>Geo Loop</h1>
          <span>{status}</span>
        </div>

        <div className="mapControls">
          <button type="button" onClick={openMaps} title="Open Google Maps">
            <MapPinned size={18} />
          </button>
          <button type="button" onClick={capturePreview} disabled={!canUseMaps} title="Capture current Maps frame">
            <Camera size={18} />
          </button>
        </div>

        <div className="runControls">
          <button className="primaryButton" type="button" onClick={startLoop} disabled={!canUseMaps} title="Go">
            <Play size={18} />
            <span>Go</span>
          </button>
          <button type="button" onClick={stepOnce} disabled={!canUseMaps} title="Step">
            <StepForward size={18} />
          </button>
          <button type="button" onClick={stopLoop} disabled={!isRunning} title="Stop">
            <Square size={18} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="capturePane" aria-label="Latest evaluated Google Maps frame">
          <div className="viewSwitch" role="tablist" aria-label="Main view">
            <button
              className={mainView === "street" ? "active" : ""}
              type="button"
              onClick={() => setMainView("street")}
              title="Street View frame"
              aria-label="Street View frame"
              aria-selected={mainView === "street"}
            >
              <ImageIcon size={17} />
            </button>
            <button
              className={mainView === "map" ? "active" : ""}
              type="button"
              onClick={() => setMainView("map")}
              title="Scene map"
              aria-label="Scene map"
              aria-selected={mainView === "map"}
            >
              <MapIcon size={17} />
            </button>
          </div>

          {mainView === "map" ? (
            <SceneMap graph={latestGraph} view={mapsStatus?.state} />
          ) : latestSnapshotUrl ? (
            <img className="captureImage" src={latestSnapshotUrl} alt="" />
          ) : (
            <MissingKey message={configError || "No Maps frame yet"} />
          )}
          <div className="captureHud">
            <span><Navigation size={15} /> {formatView(mapsStatus?.state)}</span>
            <span>{mapsStatus?.streetView ? "Street View" : mapsStatus?.open ? "Maps open" : "Maps closed"}</span>
          </div>
        </section>

        <aside className="analysisPane">
          <section className="guessPanel">
            <h2>Current Guess</h2>
            {latestGuess ? (
              <div className="guessText">
                <strong>{formatGuess(latestGuess)}</strong>
                <span>{Math.round(latestGuess.confidence * 100)}%</span>
              </div>
            ) : (
              <div className="emptyState">No guess yet</div>
            )}
          </section>

          <section className="turnPanel">
            <h2>Run Logs</h2>
            <div className="logList">
              {logs.length === 0 ? (
                <div className="emptyState">{isRunning ? "Connecting log stream..." : "No logs yet"}</div>
              ) : (
                logs.map((entry) => <LogView key={entry.id} entry={entry} />)
              )}
            </div>
          </section>

          <section className="turnPanel">
            <h2>Loop</h2>
            <div className="turnList">
              {history.length === 0 ? (
                <div className="emptyState">{isRunning ? "Thinking..." : "Waiting"}</div>
              ) : (
                [...history].reverse().map((turn) => <TurnView key={turn.id} turn={turn} />)
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function LogView({ entry }: { entry: RunLogEvent }) {
  const detail = formatLogDetail(entry.detail);

  return (
    <article className={`logItem ${entry.level}`}>
      <span>{new Date(entry.at).toLocaleTimeString()}</span>
      <strong>{entry.source}</strong>
      <p>{entry.message}</p>
      {detail ? (
        <details>
          <summary>details</summary>
          <pre>{detail}</pre>
        </details>
      ) : null}
    </article>
  );
}

function formatLogDetail(detail: unknown): string {
  if (!detail) {
    return "";
  }
  try {
    const text = JSON.stringify(detail, null, 2);
    return text.length > 1600 ? `${text.slice(0, 1597)}...` : text;
  } catch {
    return String(detail);
  }
}

function TurnView({ turn }: { turn: AgentTurn }) {
  const hypothesis = turn.geographer.finalGuess ?? turn.geographer.hypotheses[0];
  const graphFrames = turn.explorationGraph?.nodes
    .slice(-3)
    .flatMap((node) =>
      node.frames
        .filter((frame) => frame.publicUrl)
        .map((frame) => ({
          id: `${node.id}-${frame.id}`,
          src: frame.publicUrl,
          title: `${node.label}: ${frame.label} (${Math.round(frame.heading)} deg / z${Math.round(frame.zoom * 10) / 10})`
        }))
    )
    .slice(-8) ?? [];
  const graphEvidence = turn.explorationGraph?.evidence.slice(-5) ?? [];
  return (
    <article className={`turnItem ${turn.status}`}>
      <div className="turnHeader">
        <span>#{turn.index}</span>
        <span>{turn.status}</span>
      </div>
      <p>{turn.navigator.observation}</p>
      {graphFrames.length ? (
        <div className="graphStrip" aria-label="Recent explored frames">
          {graphFrames.map((frame) => (
            <img key={frame.id} src={frame.src} title={frame.title} alt="" />
          ))}
        </div>
      ) : null}
      {graphEvidence.length ? (
        <div className="evidenceLine">
          {graphEvidence.map((entry) => `${entry.type}: ${entry.text}`).join(" | ")}
        </div>
      ) : null}
      {turn.verifier ? (
        <div className="verifierLine">verify {turn.verifier.decision}: {turn.verifier.reasoning}</div>
      ) : null}
      {hypothesis ? <div className="hypothesisLine">{formatGuess(hypothesis)}</div> : null}
    </article>
  );
}

function SceneMap({ graph, view }: { graph?: ExplorationGraphSummary; view?: StreetViewState }) {
  const dragRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const layout = useMemo(() => buildSceneMapLayout(graph), [graph]);
  const currentNode = layout.nodes.find((node) => node.isCurrent) ?? layout.nodes.at(-1);
  const [viewport, setViewport] = useState({ centerX: 0, centerY: 0, scale: 1 });

  useEffect(() => {
    const center = currentNode ?? layout.center;
    setViewport({
      centerX: center?.x ?? 0,
      centerY: center?.y ?? 0,
      scale: 1
    });
  }, [currentNode?.id, layout.center.x, layout.center.y, layout.nodes.length]);

  if (!graph?.nodes.length) {
    return (
      <div className="sceneMap">
        <MissingKey message="No scene map yet" />
      </div>
    );
  }

  const viewWidth = Math.max(520, layout.bounds.width + 220);
  const viewHeight = Math.max(340, layout.bounds.height + 180);
  const viewBox = [
    viewport.centerX - viewWidth / (2 * viewport.scale),
    viewport.centerY - viewHeight / (2 * viewport.scale),
    viewWidth / viewport.scale,
    viewHeight / viewport.scale
  ].join(" ");
  const currentFrame = currentNode?.node.frames.at(-1);
  const heading = currentFrame?.heading ?? view?.heading ?? 0;

  const zoomBy = (factor: number) => {
    setViewport((current) => ({
      ...current,
      scale: clamp(current.scale * factor, 0.45, 4)
    }));
  };

  const resetView = () => {
    const center = currentNode ?? layout.center;
    setViewport({
      centerX: center?.x ?? 0,
      centerY: center?.y ?? 0,
      scale: 1
    });
  };

  return (
    <div className="sceneMap">
      <div className="sceneMapTools">
        <button type="button" onClick={() => zoomBy(1.18)} title="Zoom in" aria-label="Zoom in">
          <Plus size={16} />
        </button>
        <button type="button" onClick={() => zoomBy(0.85)} title="Zoom out" aria-label="Zoom out">
          <Minus size={16} />
        </button>
        <button type="button" onClick={resetView} title="Center current camera" aria-label="Center current camera">
          <LocateFixed size={16} />
        </button>
      </div>
      <svg
        className="sceneMapSvg"
        viewBox={viewBox}
        role="img"
        aria-label="Generated scene map"
        onPointerDown={(event) => {
          dragRef.current = { clientX: event.clientX, clientY: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = dragRef.current;
          if (!previous) {
            return;
          }
          const dx = event.clientX - previous.clientX;
          const dy = event.clientY - previous.clientY;
          dragRef.current = { clientX: event.clientX, clientY: event.clientY };
          setViewport((current) => ({
            ...current,
            centerX: current.centerX - dx / current.scale,
            centerY: current.centerY - dy / current.scale
          }));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.12 : 0.9);
        }}
      >
        <defs>
          <pattern id="scene-grid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M 42 0 L 0 0 0 42" fill="none" stroke="rgba(31,37,40,0.09)" strokeWidth="1" />
          </pattern>
          <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#1f2528" floodOpacity="0.22" />
          </filter>
          {layout.nodes.map((node) => node.thumbUrl ? (
            <pattern key={node.id} id={thumbPatternId(node.id)} width="1" height="1" patternContentUnits="objectBoundingBox">
              <image href={node.thumbUrl} x="-0.08" y="0" width="1.16" height="1" preserveAspectRatio="xMidYMid slice" />
            </pattern>
          ) : null)}
        </defs>

        <rect
          x={layout.bounds.minX - 420}
          y={layout.bounds.minY - 320}
          width={layout.bounds.width + 840}
          height={layout.bounds.height + 640}
          fill="url(#scene-grid)"
        />

        <g className="sceneEdges">
          {layout.edges.map((edge) => (
            <path key={edge.id} d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`} />
          ))}
        </g>

        <g className="sceneCameraRays">
          {layout.nodes.flatMap((node) =>
            node.node.frames.map((frame, index) => (
              <path
                key={`${node.id}-${frame.id}-${index}`}
                className={node.isCurrent && index === node.node.frames.length - 1 ? "current" : ""}
                d={cameraConePath(node.x, node.y, frame.heading, node.isCurrent ? 110 : 72, node.isCurrent ? 36 : 20)}
              />
            ))
          )}
        </g>

        {currentNode ? (
          <path
            className="liveCameraCone"
            d={cameraConePath(currentNode.x, currentNode.y, heading, 132, 44)}
          />
        ) : null}

        <g className="sceneNodes">
          {layout.nodes.map((node) => (
            <g key={node.id} className={node.isCurrent ? "sceneNode current" : "sceneNode"} transform={`translate(${node.x} ${node.y})`}>
              <circle className="nodeHalo" r={node.isCurrent ? 45 : 38} />
              <circle className="nodeThumb" r="30" fill={node.thumbUrl ? `url(#${thumbPatternId(node.id)})` : "#f8faf9"} />
              <circle className="nodeRing" r="30" />
              <text className="nodeIndex" x="0" y="48">{node.shortLabel}</text>
              {node.evidenceCount ? (
                <>
                  <circle className="nodeEvidenceBadge" cx="0" cy="-45" r="14" />
                  <text className="nodeEvidence" x="0" y="-40">{node.evidenceCount}</text>
                </>
              ) : null}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

type SceneGraphNode = ExplorationGraphSummary["nodes"][number];

interface SceneMapNodeLayout {
  id: string;
  node: SceneGraphNode;
  x: number;
  y: number;
  isCurrent: boolean;
  shortLabel: string;
  thumbUrl?: string;
  evidenceCount: number;
}

interface SceneMapEdgeLayout {
  id: string;
  from: SceneMapNodeLayout;
  to: SceneMapNodeLayout;
}

interface SceneMapLayout {
  nodes: SceneMapNodeLayout[];
  edges: SceneMapEdgeLayout[];
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  center: {
    x: number;
    y: number;
  };
}

function buildSceneMapLayout(graph: ExplorationGraphSummary | undefined): SceneMapLayout {
  if (!graph?.nodes.length) {
    return {
      nodes: [],
      edges: [],
      bounds: { minX: -240, minY: -160, width: 480, height: 320 },
      center: { x: 0, y: 0 }
    };
  }

  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  for (const [index, node] of graph.nodes.entries()) {
    if (index > 0) {
      const previous = graph.nodes[index - 1];
      const heading = node.frames[0]?.heading ?? previous.frames.at(-1)?.heading ?? index * 35;
      const point = advancePoint(x, y, heading, 180);
      x = point.x;
      y = point.y;
      if ([...positions.values()].some((position) => distance(position.x, position.y, x, y) < 90)) {
        const offset = advancePoint(0, 0, heading + 90, 72 + index * 8);
        x += offset.x;
        y += offset.y;
      }
    }
    positions.set(node.id, { x, y });
  }

  const evidenceCounts = new Map<string, number>();
  for (const evidence of graph.evidence) {
    if (evidence.nodeId) {
      evidenceCounts.set(evidence.nodeId, (evidenceCounts.get(evidence.nodeId) ?? 0) + 1);
    }
  }

  const nodes: SceneMapNodeLayout[] = graph.nodes.map((node, index) => {
    const position = positions.get(node.id) ?? { x: index * 180, y: 0 };
    const thumbUrl = node.frames.findLast((frame) => frame.publicUrl)?.publicUrl ?? node.publicUrl;
    return {
      id: node.id,
      node,
      x: position.x,
      y: position.y,
      isCurrent: node.id === graph.currentNodeId,
      shortLabel: `T${node.turnIndex}.${index + 1}`,
      thumbUrl,
      evidenceCount: evidenceCounts.get(node.id) ?? 0
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge, index) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return from && to ? [{ id: `${edge.from}-${edge.to}-${index}`, from, to }] : [];
  });
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const current = nodes.find((node) => node.isCurrent) ?? nodes.at(-1);

  return {
    nodes,
    edges,
    bounds: {
      minX,
      minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    },
    center: {
      x: current?.x ?? (minX + maxX) / 2,
      y: current?.y ?? (minY + maxY) / 2
    }
  };
}

function advancePoint(x: number, y: number, heading: number, distanceValue: number): { x: number; y: number } {
  const radians = degreesToRadians(heading);
  return {
    x: x + Math.sin(radians) * distanceValue,
    y: y - Math.cos(radians) * distanceValue
  };
}

function cameraConePath(x: number, y: number, heading: number, length: number, width: number): string {
  const radians = degreesToRadians(heading);
  const vx = Math.sin(radians);
  const vy = -Math.cos(radians);
  const px = Math.cos(radians);
  const py = Math.sin(radians);
  const tipX = x + vx * length;
  const tipY = y + vy * length;
  return [
    `M ${x} ${y}`,
    `L ${tipX + px * width} ${tipY + py * width}`,
    `L ${tipX - px * width} ${tipY - py * width}`,
    "Z"
  ].join(" ");
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function thumbPatternId(id: string): string {
  return `thumb-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function MissingKey({ message }: { message: string }) {
  return (
    <div className="missingKey">
      <AlertCircle size={28} />
      <strong>{message}</strong>
    </div>
  );
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function formatView(view: StreetViewState | undefined): string {
  if (!view) {
    return "No view";
  }
  return `${Math.round(view.heading)} deg / z${Math.round(view.zoom * 10) / 10}`;
}

function formatGuess(guess: { city?: string; region?: string; country?: string }): string {
  return [guess.city, guess.region, guess.country].filter(Boolean).join(", ") || "Unknown";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
