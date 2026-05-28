import { describe, expect, it } from "vitest";
import { extractResultTextFromJsonl, parseAgentOutput } from "./json";

const validOutput = {
  status: "final",
  navigator: {
    observation: "A French civic building and French text are visible.",
    visibleText: ["French text"],
    roadClues: [],
    placeClues: ["French civic building"],
    environmentClues: [],
    uncertainty: [],
    surveySteps: []
  },
  geographer: {
    hypotheses: [
      {
        country: "France",
        region: "Ile-de-France",
        city: "Paris",
        lat: 48.8566,
        lng: 2.3522,
        confidence: 0.82,
        evidence: ["French text", "Parisian civic architecture"]
      }
    ],
    instructionToNavigator: null,
    finalGuess: {
      country: "France",
      region: "Ile-de-France",
      city: "Paris",
      lat: 48.8566,
      lng: 2.3522,
      confidence: 0.82,
      evidence: ["French text", "Parisian civic architecture"]
    }
  },
  verifier: {
    decision: "accept",
    reasoning: "The final guess is supported by independent city-specific cues.",
    concerns: [],
    finalGuess: {
      country: "France",
      region: "Ile-de-France",
      city: "Paris",
      lat: 48.8566,
      lng: 2.3522,
      confidence: 0.82,
      evidence: ["French text", "Parisian civic architecture"]
    }
  },
  uiMessage: "Final guess: Paris, France."
};

describe("provider JSON extraction", () => {
  it("extracts Codex agent_message payloads from item.completed JSONL", () => {
    const payload = JSON.stringify(validOutput);
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "thread_1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          id: "item_0",
          text: payload
        }
      }),
      JSON.stringify({ type: "turn.completed", status: "completed" })
    ].join("\n");

    const text = extractResultTextFromJsonl(stream);
    expect(text).toBe(payload);
    expect(parseAgentOutput(text).status).toBe("final");
  });

  it("extracts text from content arrays", () => {
    const payload = JSON.stringify(validOutput);
    const stream = JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ type: "output_text", text: payload }]
      }
    });

    expect(extractResultTextFromJsonl(stream)).toBe(payload);
  });
});
