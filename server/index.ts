import express from "express";
import path from "node:path";
import { nanoid } from "nanoid";
import { createServer as createViteServer } from "vite";
import type {
  AgentStepRequest,
  AgentStepResponse,
  AgentTurn,
  StreetViewAction,
  StreetViewMoveTarget,
  StreetViewState
} from "../src/agent/types";
import { DEFAULT_PERCEPTION_TOOLS } from "../src/mcp/perceptionContracts";
import { loadSettings } from "./config";
import { GoogleMapsController } from "./googleMapsController";
import { createAgentProvider } from "./providers";
import { buildNavigatorGeographerPrompt } from "./providers/prompt";
import { runPerceptionPrepass } from "./perceptionPrepass";
import { appendRunLog, createRunLogger, getRunLogs, subscribeRunLogs } from "./runLogs";

const settings = loadSettings();
const provider = createAgentProvider(settings);
const googleMaps = new GoogleMapsController({
  rootDir: settings.rootDir,
  startUrl: settings.googleMapsStartUrl
});
const app = express();

app.use(express.json({ limit: "8mb" }));
app.use("/snapshots", express.static(settings.snapshotDir));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    provider: settings.provider,
    mcpServers: Object.keys(settings.mcpConfig.mcpServers)
  });
});

app.get("/api/config", (_request, response) => {
  response.json({
    googleMapsStartUrl: settings.googleMapsStartUrl,
    provider: settings.provider,
    providerModel: provider.model,
    mcpServers: Object.keys(settings.mcpConfig.mcpServers),
    perceptionTools: DEFAULT_PERCEPTION_TOOLS
  });
});

app.get("/api/maps/status", async (_request, response) => {
  response.json(await googleMaps.status());
});

app.post("/api/maps/open", async (request, response) => {
  const url = isRecord(request.body) && typeof request.body.url === "string" ? request.body.url : undefined;
  response.json(await googleMaps.open(url));
});

app.post("/api/maps/snapshot", async (_request, response) => {
  response.json(await googleMaps.capture(settings.snapshotDir));
});

app.post("/api/maps/action", async (request, response) => {
  const action = normalizeStreetViewAction(isRecord(request.body) && "action" in request.body ? request.body.action : request.body);
  response.json(await googleMaps.applyAction(action));
});

app.get("/api/runs/:runId/logs", (request, response) => {
  const runId = request.params.runId;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });

  for (const event of getRunLogs(runId)) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = subscribeRunLogs(runId, (event) => {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  request.on("close", unsubscribe);
});

app.post("/api/agent/step", async (request, response) => {
  const stepRequest = normalizeStepRequest(request.body);
  const runId = stepRequest.runId || nanoid();
  const log = createRunLogger(runId);
  log({ source: "server", level: "info", message: `Starting turn ${stepRequest.history.length + 1}` });

  const snapshot = await googleMaps.capture(settings.snapshotDir);
  stepRequest.view = snapshot.state;
  if (snapshot.filePath) {
    log({ source: "server", level: "info", message: "Captured Google Maps screenshot", detail: { path: snapshot.filePath } });
  }
  if (snapshot.warning) {
    log({ source: "server", level: "warn", message: snapshot.warning });
  }

  try {
    if (settings.provider !== "mock" && !snapshot.filePath) {
      throw new Error(snapshot.warning || "A Google Maps Street View screenshot is required for the selected provider.");
    }

    const perception =
      settings.perceptionPrepass && settings.provider !== "mock" && snapshot.filePath
        ? await runPerceptionPrepass({ imagePath: snapshot.filePath, rootDir: settings.rootDir, log })
        : undefined;

    const prompt = buildNavigatorGeographerPrompt({
      request: stepRequest,
      snapshotPath: snapshot.filePath,
      snapshotWarning: snapshot.warning,
      mcpConfig: settings.mcpConfig,
      perception
    });

    const modelOutput = await provider.run({
      prompt,
      request: stepRequest,
      snapshotPath: snapshot.filePath,
      settings,
      log
    });
    log({ source: "server", level: "info", message: `Provider returned ${modelOutput.status}` });

    const turn = buildTurn(stepRequest, {
      ...modelOutput,
      snapshotUrl: snapshot.publicUrl
    });

    if (turn.status === "continue") {
      try {
        await googleMaps.applyAction(turn.navigator.action);
        log({
          source: "server",
          level: "info",
          message: `Applied Google Maps action: ${turn.navigator.action.type}`,
          detail: turn.navigator.action
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log({ source: "server", level: "warn", message: `Google Maps action was not applied: ${message}` });
      }
    }

    const payload: AgentStepResponse = {
      turn,
      provider: provider.name,
      model: provider.model
    };
    response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendRunLog(runId, { source: "server", level: "error", message });
    const turn = buildErrorTurn(stepRequest, snapshot.publicUrl, message);
    response.status(200).json({
      turn,
      provider: provider.name,
      model: provider.model
    } satisfies AgentStepResponse);
  }
});

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(settings.rootDir, "dist");
  app.use(express.static(distDir));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.listen(settings.port, settings.host, () => {
  console.log(`Active perception GeoGuessr running at http://${settings.host}:${settings.port}`);
  console.log(`Provider: ${settings.provider}; MCP servers: ${Object.keys(settings.mcpConfig.mcpServers).join(", ") || "none"}`);
});

function buildTurn(
  request: AgentStepRequest,
  modelOutput: Awaited<ReturnType<typeof provider.run>> & { snapshotUrl?: string }
): AgentTurn {
  const index = request.history.length + 1;
  return {
    id: nanoid(),
    index,
    createdAt: new Date().toISOString(),
    status: modelOutput.status,
    view: request.view,
    snapshotUrl: modelOutput.snapshotUrl,
    navigator: modelOutput.navigator,
    geographer: modelOutput.geographer,
    uiMessage: modelOutput.uiMessage,
    rawText: modelOutput.rawText
  };
}

function buildErrorTurn(request: AgentStepRequest, snapshotUrl: string | undefined, message: string): AgentTurn {
  return {
    id: nanoid(),
    index: request.history.length + 1,
    createdAt: new Date().toISOString(),
    status: "error",
    view: request.view,
    snapshotUrl,
    navigator: {
      observation: `Provider error: ${message}`,
      perceptionCalls: [],
      action: {
        type: "hold",
        reason: "The provider step failed before a safe navigation action was returned."
      }
    },
    geographer: {
      hypotheses: [],
      instructionToNavigator: "Fix provider configuration or try the mock provider."
    },
    uiMessage: message
  };
}

function normalizeStepRequest(value: unknown): AgentStepRequest {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }
  return {
    view: normalizeStreetViewState(value.view),
    history: Array.isArray(value.history) ? (value.history as AgentTurn[]) : [],
    runGoal: typeof value.runGoal === "string" ? value.runGoal : undefined,
    runId: typeof value.runId === "string" ? value.runId : undefined,
    maxTurns: typeof value.maxTurns === "number" ? value.maxTurns : undefined
  };
}

function normalizeStreetViewState(value: unknown): StreetViewState {
  if (!isRecord(value)) {
    return defaultStreetViewState();
  }
  return {
    source: "google_maps",
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    heading: numberOr(value.heading, 0),
    pitch: numberOr(value.pitch, 0),
    zoom: numberOr(value.zoom, 1),
    moves: Array.isArray(value.moves) ? value.moves.map(normalizeMoveTarget) : []
  };
}

function defaultStreetViewState(): StreetViewState {
  return {
    source: "google_maps",
    heading: 0,
    pitch: 0,
    zoom: 1,
    moves: []
  };
}

function normalizeMoveTarget(value: unknown, index: number): StreetViewMoveTarget {
  if (!isRecord(value)) {
    return { index, screenX: 0.5, screenY: 0.66 };
  }
  return {
    index: typeof value.index === "number" ? value.index : index,
    screenX: numberOr(value.screenX, 0.5),
    screenY: numberOr(value.screenY, 0.66),
    description: typeof value.description === "string" ? value.description : undefined,
    heading: typeof value.heading === "number" ? value.heading : undefined
  };
}

function normalizeStreetViewAction(value: unknown): StreetViewAction {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { type: "hold", reason: "No valid Google Maps action was provided." };
  }

  if (value.type === "pan") {
    return {
      type: "pan",
      headingDelta: numberOr(value.headingDelta, 0),
      pitchDelta: typeof value.pitchDelta === "number" ? value.pitchDelta : undefined,
      reason: stringOr(value.reason, "Pan Google Maps Street View.")
    };
  }
  if (value.type === "zoom") {
    return {
      type: "zoom",
      zoomDelta: numberOr(value.zoomDelta, 0),
      reason: stringOr(value.reason, "Zoom Google Maps Street View.")
    };
  }
  if (value.type === "move") {
    return {
      type: "move",
      linkIndex: Math.max(0, Math.trunc(numberOr(value.linkIndex, 0))),
      reason: stringOr(value.reason, "Move to the selected Google Maps Street View target.")
    };
  }
  if (value.type === "inspect") {
    return {
      type: "inspect",
      target: inspectTarget(value.target),
      heading: typeof value.heading === "number" ? value.heading : undefined,
      pitch: typeof value.pitch === "number" ? value.pitch : undefined,
      zoom: typeof value.zoom === "number" ? value.zoom : undefined,
      reason: stringOr(value.reason, "Inspect a visual target in Google Maps Street View.")
    };
  }
  return {
    type: "hold",
    reason: stringOr(value.reason, "No Google Maps movement requested.")
  };
}

function inspectTarget(value: unknown): Extract<StreetViewAction, { type: "inspect" }>["target"] {
  const allowed = ["sign", "plate", "road", "vegetation", "architecture", "utility", "sky", "other"] as const;
  return allowed.find((target) => target === value) ?? "other";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
