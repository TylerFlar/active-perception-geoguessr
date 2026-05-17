import type { RuntimeSettings } from "../config";
import { ClaudeCliProvider, CodexCliProvider } from "./cli";
import { MockProvider } from "./mock";
import { OpenAiProvider } from "./openai";
import type { AgentProvider } from "./provider";

export function createAgentProvider(settings: RuntimeSettings): AgentProvider {
  if (settings.provider === "openai") {
    return new OpenAiProvider();
  }
  if (settings.provider === "codex") {
    return new CodexCliProvider();
  }
  if (settings.provider === "claude") {
    return new ClaudeCliProvider();
  }
  return new MockProvider();
}
