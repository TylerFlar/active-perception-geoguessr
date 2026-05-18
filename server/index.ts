import express from "express";
import path from "node:path";
import { nanoid } from "nanoid";
import { createServer as createViteServer } from "vite";
import type { AgentStepRequest, AgentStepResponse, AgentTurn, PanoLinkState, PanoState } from "../src/agent/types";
import { DEFAULT_PERCEPTION_TOOLS } from "../src/mcp/perceptionContracts";
import { loadSettings } from "./config";
import { createAgentProvider } from "./providers";
import { buildNavigatorGeographerPrompt } from "./providers/prompt";
import { capturePanoramaxSnapshot } from "./panoramaxSnapshot";
import { appendRunLog, createRunLogger, getRunLogs, subscribeRunLogs } from "./runLogs";

const settings = loadSettings();
const provider = createAgentProvider(settings);
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
    panoramaxEndpoint: settings.panoramaxEndpoint,
    provider: settings.provider,
    providerModel: provider.model,
    mcpServers: Object.keys(settings.mcpConfig.mcpServers),
    perceptionTools: DEFAULT_PERCEPTION_TOOLS
  });
});

app.get("/api/panoramax/image", async (request, response) => {
  const url = typeof request.query.url === "string" ? request.query.url : "";
  const upstreamUrl = parseAllowedPanoramaxUrl(url);
  if (!upstreamUrl) {
    response.status(400).send("Invalid Panoramax image URL.");
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      response.status(upstream.status).send(`Panoramax image fetch failed with ${upstream.status}.`);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.includes("image")) {
      response.status(415).send("Panoramax URL did not return an image.");
      return;
    }

    response.setHeader("content-type", contentType);
    response.setHeader("cache-control", "public, max-age=86400");
    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(502).send(`Panoramax image proxy failed: ${message}`);
  }
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
  const snapshot = await capturePanoramaxSnapshot({
    snapshotDir: settings.snapshotDir,
    snapshotDataUrl: stepRequest.snapshotDataUrl
  });
  if (snapshot.filePath) {
    log({ source: "server", level: "info", message: "Captured Panoramax snapshot", detail: { path: snapshot.filePath } });
  }
  if (snapshot.warning) {
    log({ source: "server", level: "warn", message: snapshot.warning });
  }

  try {
    if (settings.provider !== "mock" && !snapshot.filePath) {
      throw new Error(snapshot.warning || "A Panoramax image snapshot is required for the selected provider.");
    }

    const prompt = buildNavigatorGeographerPrompt({
      request: stepRequest,
      snapshotPath: snapshot.filePath,
      snapshotWarning: snapshot.warning,
      mcpConfig: settings.mcpConfig
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
    pano: request.pano,
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
    pano: request.pano,
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
    pano: normalizePanoState(value.pano),
    history: Array.isArray(value.history) ? (value.history as AgentTurn[]) : [],
    runGoal: typeof value.runGoal === "string" ? value.runGoal : undefined,
    runId: typeof value.runId === "string" ? value.runId : undefined,
    maxTurns: typeof value.maxTurns === "number" ? value.maxTurns : undefined,
    snapshotDataUrl: typeof value.snapshotDataUrl === "string" ? value.snapshotDataUrl : undefined
  };
}

function normalizePanoState(value: unknown): PanoState {
  if (!isRecord(value)) {
    throw new Error("pano must be an object.");
  }
  return {
    panoId: typeof value.panoId === "string" ? value.panoId : undefined,
    sequenceId: typeof value.sequenceId === "string" ? value.sequenceId : undefined,
    source: "panoramax",
    lat: numberValue(value.lat, "pano.lat"),
    lng: numberValue(value.lng, "pano.lng"),
    heading: numberValue(value.heading, "pano.heading"),
    pitch: numberValue(value.pitch, "pano.pitch"),
    zoom: numberValue(value.zoom, "pano.zoom"),
    links: Array.isArray(value.links) ? value.links.map(normalizeLinkState) : []
  };
}

function normalizeLinkState(value: unknown, index: number): PanoLinkState {
  if (!isRecord(value)) {
    return { index, heading: 0 };
  }
  return {
    index: typeof value.index === "number" ? value.index : index,
    heading: typeof value.heading === "number" ? value.heading : 0,
    description: typeof value.description === "string" ? value.description : undefined,
    pano: typeof value.pano === "string" ? value.pano : undefined,
    sequenceId: typeof value.sequenceId === "string" ? value.sequenceId : undefined
  };
}

function numberValue(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`${label} must be a finite number.`);
}

function parseAllowedPanoramaxUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const allowed = new URL(settings.panoramaxEndpoint);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== allowed.origin) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
