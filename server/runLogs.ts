import { nanoid } from "nanoid";

export interface RunLogEvent {
  id: string;
  runId: string;
  at: string;
  source: "server" | "provider" | "codex" | "claude" | "mcp";
  level: "info" | "warn" | "error";
  message: string;
  detail?: unknown;
}

export type RunLogger = (event: Omit<RunLogEvent, "id" | "runId" | "at">) => void;

const MAX_EVENTS_PER_RUN = 250;
const logs = new Map<string, RunLogEvent[]>();
const listeners = new Map<string, Set<(event: RunLogEvent) => void>>();

export function appendRunLog(runId: string, event: Omit<RunLogEvent, "id" | "runId" | "at">): RunLogEvent {
  const entry: RunLogEvent = {
    id: nanoid(),
    runId,
    at: new Date().toISOString(),
    ...event
  };
  const entries = logs.get(runId) ?? [];
  entries.push(entry);
  if (entries.length > MAX_EVENTS_PER_RUN) {
    entries.splice(0, entries.length - MAX_EVENTS_PER_RUN);
  }
  logs.set(runId, entries);

  for (const listener of listeners.get(runId) ?? []) {
    listener(entry);
  }
  return entry;
}

export function getRunLogs(runId: string): RunLogEvent[] {
  return logs.get(runId) ?? [];
}

export function subscribeRunLogs(runId: string, listener: (event: RunLogEvent) => void): () => void {
  const runListeners = listeners.get(runId) ?? new Set<(event: RunLogEvent) => void>();
  runListeners.add(listener);
  listeners.set(runId, runListeners);

  return () => {
    runListeners.delete(listener);
    if (runListeners.size === 0) {
      listeners.delete(runId);
    }
  };
}

export function createRunLogger(runId: string): RunLogger {
  return (event) => {
    appendRunLog(runId, event);
  };
}
