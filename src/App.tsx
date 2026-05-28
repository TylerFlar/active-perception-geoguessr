import { AlertCircle, Camera, MapPinned, Navigation, Play, Square, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStepResponse, AgentTurn, StreetViewState } from "./agent/types";

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

  const latestGuess = useMemo(() => {
    const final = [...history].reverse().find((turn) => turn.geographer.finalGuess);
    return final?.geographer.finalGuess ?? [...history].reverse()[0]?.geographer.hypotheses[0];
  }, [history]);

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
    const payload = (await response.json()) as { publicUrl?: string; warning?: string; state: StreetViewState };
    if (payload.publicUrl) {
      setLatestSnapshotUrl(payload.publicUrl);
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
    const nextRunId = crypto.randomUUID();
    setRunId(nextRunId);
    setLogs([]);
    try {
      await runOneStep(history, { runId: nextRunId });
    } finally {
      setIsRunning(false);
      setStatus("Idle");
    }
  }, [history, isRunning, mapsStatus?.streetView, runOneStep]);

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
          {latestSnapshotUrl ? (
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
