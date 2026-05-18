import { AlertCircle, LocateFixed, Navigation, Play, RotateCcw, Search, Square, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStepResponse, AgentTurn, PanoAction, PanoState } from "./agent/types";
import { PanoramaViewer, type PanoramaViewerHandle } from "./PanoramaViewer";

interface AppConfig {
  panoramaxEndpoint: string;
}

interface PanoramaxAsset {
  href: string;
  type?: string;
  roles?: string[];
}

interface PanoramaxLink {
  rel?: string;
  type?: string;
  id?: string;
  href?: string;
  geometry?: {
    coordinates?: [number, number];
  };
}

interface PanoramaxFeature {
  id: string;
  collection?: string;
  geometry: {
    coordinates: [number, number];
  };
  assets?: Record<string, PanoramaxAsset>;
  links?: PanoramaxLink[];
  properties?: Record<string, unknown>;
}

interface ImageView {
  heading: number;
  pitch: number;
  zoom: number;
}

interface RunLogEvent {
  id: string;
  at: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: unknown;
}

const DEFAULT_LOCATION = { lat: 48.8566, lng: 2.3522 };
const MAX_AUTO_TURNS = 8;

export default function App() {
  const autoRunRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; view: ImageView } | null>(null);
  const viewerRef = useRef<PanoramaViewerHandle | null>(null);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [feature, setFeature] = useState<PanoramaxFeature | null>(null);
  const [view, setView] = useState<ImageView>({ heading: 0, pitch: 0, zoom: 1 });
  const [pano, setPano] = useState<PanoState | null>(null);
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [runId, setRunId] = useState("");
  const [logs, setLogs] = useState<RunLogEvent[]>([]);
  const [locationText, setLocationText] = useState(`${DEFAULT_LOCATION.lat}, ${DEFAULT_LOCATION.lng}`);
  const [status, setStatus] = useState("Idle");
  const [isRunning, setIsRunning] = useState(false);
  const [isViewerReady, setIsViewerReady] = useState(false);

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((payload: AppConfig) => setConfig(payload))
      .catch((error: Error) => setConfigError(error.message));
  }, []);

  useEffect(() => {
    if (!config?.panoramaxEndpoint) {
      return;
    }
    void loadNearestFeature(config.panoramaxEndpoint, DEFAULT_LOCATION)
      .then((nextFeature) => {
        setFeature(nextFeature);
        setStatus("Location loaded");
      })
      .catch((error: Error) => setStatus(error.message || "No Panoramax imagery nearby"));
  }, [config?.panoramaxEndpoint]);

  useEffect(() => {
    setPano(feature ? featureToPanoState(feature, view) : null);
  }, [feature, view]);

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

  const latestGuess = useMemo(() => {
    const final = [...history].reverse().find((turn) => turn.geographer.finalGuess);
    return final?.geographer.finalGuess ?? [...history].reverse()[0]?.geographer.hypotheses[0];
  }, [history]);

  const imageUrl = feature ? displayImageUrl(feature) : undefined;
  const viewerImageUrl = imageUrl ? proxiedImageUrl(imageUrl) : undefined;

  useEffect(() => {
    setIsViewerReady(false);
  }, [viewerImageUrl]);

  const loadLocation = useCallback(() => {
    const parsed = parseLatLng(locationText);
    if (!parsed || !config?.panoramaxEndpoint) {
      setStatus("Enter lat, lng");
      return;
    }
    setHistory([]);
    setStatus("Searching");
    void loadNearestFeature(config.panoramaxEndpoint, parsed)
      .then((nextFeature) => {
        setFeature(nextFeature);
        setView({ heading: 0, pitch: 0, zoom: 1 });
        setStatus("Location loaded");
      })
      .catch((error: Error) => setStatus(error.message || "No Panoramax imagery nearby"));
  }, [config?.panoramaxEndpoint, locationText]);

  const runOneStep = useCallback(
    async (nextHistory: AgentTurn[], options?: { applyAction?: boolean; runId?: string }) => {
      const current = feature ? featureToPanoState(feature, view) : pano;
      if (!current?.panoId) {
        setStatus("No picture");
        return nextHistory;
      }

      setStatus("Thinking");
      const snapshotDataUrl = await captureCurrentView(viewerRef.current);
      const response = await fetch("/api/agent/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pano: current,
          history: nextHistory,
          runId: options?.runId,
          maxTurns: MAX_AUTO_TURNS,
          snapshotDataUrl
        })
      });
      const payload = (await response.json()) as AgentStepResponse;
      const updatedHistory = [...nextHistory, payload.turn];
      setHistory(updatedHistory);
      setStatus(payload.turn.status === "continue" ? "Navigating" : payload.turn.status);

      if (options?.applyAction !== false && payload.turn.status === "continue") {
        await applyNavigatorAction(payload.turn.navigator.action);
      }

      return updatedHistory;
    },
    [feature, pano, view]
  );

  const startLoop = useCallback(async () => {
    if (isRunning) {
      return;
    }
    setHistory([]);
    const nextRunId = crypto.randomUUID();
    setRunId(nextRunId);
    setLogs([]);
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
  }, [isRunning, runOneStep]);

  const stopLoop = useCallback(() => {
    autoRunRef.current = false;
    setIsRunning(false);
    setStatus("Stopped");
  }, []);

  const stepOnce = useCallback(async () => {
    if (isRunning) {
      return;
    }
    setIsRunning(true);
    const nextRunId = crypto.randomUUID();
    setRunId(nextRunId);
    setLogs([]);
    try {
      await runOneStep(history, { runId: nextRunId });
    } finally {
      setIsRunning(false);
      setStatus("Idle");
    }
  }, [history, isRunning, runOneStep]);

  const resetView = useCallback(() => {
    setView({ heading: 0, pitch: 0, zoom: 1 });
    setStatus("View reset");
  }, []);

  async function applyNavigatorAction(action: PanoAction) {
    if (action.type === "pan") {
      setView((current) => ({
        heading: normalizeHeading(current.heading + action.headingDelta),
        pitch: clamp(current.pitch + (action.pitchDelta ?? 0), -90, 90),
        zoom: current.zoom
      }));
    } else if (action.type === "zoom") {
      setView((current) => ({ ...current, zoom: clamp(current.zoom + action.zoomDelta, 0, 4) }));
    } else if (action.type === "move") {
      const current = feature ? featureToPanoState(feature, view) : null;
      const link = current?.links[action.linkIndex];
      if (link?.pano) {
        await loadFeatureFromLink(link.pano)
          .then((nextFeature) => {
            setFeature(nextFeature);
            setView({ heading: 0, pitch: 0, zoom: 1 });
          })
          .catch((error: Error) => setStatus(error.message || "Move failed"));
      }
    } else if (action.type === "inspect") {
      setView((current) => ({
        heading: action.heading ?? current.heading,
        pitch: action.pitch ?? current.pitch,
        zoom: typeof action.zoom === "number" ? clamp(action.zoom, 0, 4) : current.zoom
      }));
    }

    await wait(700);
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="titleBlock">
          <h1>Geo Loop</h1>
          <span>{status}</span>
        </div>

        <div className="locationControls">
          <input
            aria-label="Latitude and longitude"
            value={locationText}
            onChange={(event) => setLocationText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                loadLocation();
              }
            }}
          />
          <button type="button" onClick={loadLocation} title="Load nearest Panoramax image">
            <Search size={18} />
          </button>
        </div>

        <div className="runControls">
          <button className="primaryButton" type="button" onClick={startLoop} disabled={isRunning || !feature || !isViewerReady} title="Go">
            <Play size={18} />
            <span>Go</span>
          </button>
          <button type="button" onClick={stepOnce} disabled={isRunning || !feature || !isViewerReady} title="Step">
            <StepForward size={18} />
          </button>
          <button type="button" onClick={stopLoop} disabled={!isRunning} title="Stop">
            <Square size={18} />
          </button>
          <button type="button" onClick={resetView} disabled={!feature} title="Reset view">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <section
          className="panoPane"
          aria-label="Panoramax image viewer"
          onWheel={(event) => {
            event.preventDefault();
            setView((current) => ({ ...current, zoom: clamp(current.zoom + (event.deltaY < 0 ? 0.25 : -0.25), 0, 4) }));
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, view };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) {
              return;
            }
            const dx = event.clientX - dragRef.current.x;
            const dy = event.clientY - dragRef.current.y;
            setView({
              heading: normalizeHeading(dragRef.current.view.heading - dx * 0.25),
              pitch: clamp(dragRef.current.view.pitch + dy * 0.2, -90, 90),
              zoom: dragRef.current.view.zoom
            });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
        >
          {viewerImageUrl ? (
            <PanoramaViewer
              ref={viewerRef}
              imageUrl={viewerImageUrl}
              view={view}
              onReadyChange={setIsViewerReady}
            />
          ) : (
            <MissingKey message={configError || "No Panoramax image loaded"} />
          )}
          <div className="panoHud">
            <span><Navigation size={15} /> {formatPano(pano)}</span>
            <span><LocateFixed size={15} /> {pano?.links.length ?? 0}</span>
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
  const action = turn.navigator.action;
  const hypothesis = turn.geographer.finalGuess ?? turn.geographer.hypotheses[0];
  return (
    <article className={`turnItem ${turn.status}`}>
      <div className="turnHeader">
        <span>#{turn.index}</span>
        <span>{turn.status}</span>
      </div>
      <p>{turn.navigator.observation}</p>
      <div className="actionLine">{action.type}: {action.reason}</div>
      {hypothesis ? <div className="hypothesisLine">{formatGuess(hypothesis)}</div> : null}
    </article>
  );
}

function MissingKey({ message }: { message: string }) {
  return (
    <div className="missingKey">
      <AlertCircle size={28} />
      <strong>{message}</strong>
    </div>
  );
}

async function loadNearestFeature(endpoint: string, location: { lat: number; lng: number }): Promise<PanoramaxFeature> {
  const base = normalizeEndpoint(endpoint);
  for (const factor of [0.0005, 0.002, 0.01, 0.05]) {
    const bbox = [
      location.lng - factor,
      location.lat - factor,
      location.lng + factor,
      location.lat + factor
    ].map((value) => value.toFixed(7)).join(",");
    const response = await fetch(`${base}/search?bbox=${bbox}&limit=1`);
    if (!response.ok) {
      throw new Error(`Panoramax search failed with ${response.status}`);
    }
    const payload = (await response.json()) as { features?: PanoramaxFeature[] };
    if (payload.features?.[0]) {
      return payload.features[0];
    }
  }
  throw new Error("No Panoramax imagery nearby");
}

async function loadFeatureFromLink(href: string): Promise<PanoramaxFeature> {
  const response = await fetch(href);
  if (!response.ok) {
    throw new Error(`Panoramax picture fetch failed with ${response.status}`);
  }
  return (await response.json()) as PanoramaxFeature;
}

function featureToPanoState(feature: PanoramaxFeature, view: ImageView): PanoState {
  const [lng, lat] = feature.geometry.coordinates;
  return {
    source: "panoramax",
    panoId: feature.id,
    sequenceId: feature.collection,
    lat,
    lng,
    heading: view.heading,
    pitch: view.pitch,
    zoom: view.zoom,
    links: walkableLinks(feature).map((link, index) => ({
      index,
      heading: link.geometry?.coordinates ? bearing([lng, lat], link.geometry.coordinates) : 0,
      description: link.rel,
      pano: link.href,
      sequenceId: feature.collection
    }))
  };
}

function walkableLinks(feature: PanoramaxFeature): PanoramaxLink[] {
  return (feature.links || []).filter(
    (link) => ["next", "prev", "related"].includes(link.rel || "") && link.type === "application/geo+json" && link.href
  );
}

function displayImageUrl(feature: PanoramaxFeature): string | undefined {
  return findAsset(feature, "visual", "image/webp")?.href
    || findAsset(feature, "visual", "image/jpeg")?.href
    || agentImageUrl(feature);
}

function agentImageUrl(feature: PanoramaxFeature): string | undefined {
  return findAsset(feature, "data", "image/jpeg")?.href
    || findAsset(feature, "visual", "image/jpeg")?.href
    || findAsset(feature, "visual", "image/webp")?.href
    || Object.values(feature.assets || {})[0]?.href;
}

function findAsset(feature: PanoramaxFeature, role: string, type: string): PanoramaxAsset | undefined {
  return Object.values(feature.assets || {}).find((asset) => asset.roles?.includes(role) && asset.type === type);
}

function proxiedImageUrl(url: string): string {
  return `/api/panoramax/image?url=${encodeURIComponent(url)}`;
}

async function captureCurrentView(viewer: PanoramaViewerHandle | null): Promise<string | undefined> {
  if (!viewer) {
    return undefined;
  }
  try {
    return await viewer.captureJpeg();
  } catch {
    return undefined;
  }
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, "");
}

function parseLatLng(value: string): { lat: number; lng: number } | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

function bearing(from: [number, number], to: [number, number]): number {
  const [lng1, lat1] = from.map(degToRad);
  const [lng2, lat2] = to.map(degToRad);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function formatPano(pano: PanoState | null): string {
  if (!pano) {
    return "No picture";
  }
  return `${Math.round(pano.heading)} deg / z${Math.round(pano.zoom * 10) / 10}`;
}

function formatGuess(guess: { city?: string; region?: string; country?: string }): string {
  return [guess.city, guess.region, guess.country].filter(Boolean).join(", ") || "Unknown";
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
