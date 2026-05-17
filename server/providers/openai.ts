import fs from "node:fs/promises";
import { AgentModelOutputSchema, agentOutputJsonSchema } from "./schema";
import type { AgentProvider, ProviderRunInput } from "./provider";
import { parseAgentOutput } from "./json";

export class OpenAiProvider implements AgentProvider {
  name = "openai" as const;

  get model() {
    return process.env.OPENAI_MODEL || "configured-openai-model";
  }

  async run(input: ProviderRunInput) {
    if (!input.settings.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required when GEO_AGENT_PROVIDER=openai.");
    }

    const model = input.settings.openaiModel || "gpt-5.2";
    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: input.prompt
      }
    ];

    if (input.snapshotPath) {
      const image = await fs.readFile(input.snapshotPath);
      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${image.toString("base64")}`,
        detail: "high"
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "active_geolocation_step",
            schema: agentOutputJsonSchema
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI provider failed with ${response.status}: ${detail.slice(0, 800)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOpenAiText(payload);
    const parsed = parseAgentOutput(outputText);
    return AgentModelOutputSchema.parse(parsed);
  }
}

function extractOpenAiText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const pieces: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }

  if (pieces.length) {
    return pieces.join("\n");
  }

  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
