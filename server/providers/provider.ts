import type { AgentStepRequest } from "../../src/agent/types";
import type { RuntimeSettings } from "../config";
import type { RunLogger } from "../runLogs";
import type { AgentModelOutput } from "./schema";

export type AgentRole = "navigator" | "geographer" | "verifier";

export interface ProviderRunInput {
  prompt: string;
  request: AgentStepRequest;
  snapshotPath?: string;
  snapshotPaths?: string[];
  settings: RuntimeSettings;
  log?: RunLogger;
  agentRole?: AgentRole;
}

export interface AgentProvider {
  name: RuntimeSettings["provider"];
  model?: string;
  run(input: ProviderRunInput): Promise<AgentModelOutput & { rawText?: string }>;
}
