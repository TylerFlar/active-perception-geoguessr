import { describe, expect, it } from "vitest";
import { AgentModelOutputSchema, agentOutputJsonSchema } from "./schema";

describe("agent output schema", () => {
  it("marks every object property required for strict structured output", () => {
    const misses: string[] = [];
    collectMissingRequiredKeys(agentOutputJsonSchema, "$", misses);

    expect(misses).toEqual([]);
  });

  it("avoids union schema features rejected by Codex CLI structured output", () => {
    const unsupported: string[] = [];
    collectUnsupportedSchemaKeys(agentOutputJsonSchema, "$", unsupported);

    expect(unsupported).toEqual([]);
  });

  it("parses null transport values as omitted app values", () => {
    const parsed = AgentModelOutputSchema.parse({
      status: "continue",
      navigator: {
        observation: "Looking at a road.",
        visibleText: [],
        roadClues: [],
        placeClues: [],
        environmentClues: [],
        uncertainty: [],
        surveySteps: []
      },
      geographer: {
        hypotheses: [
          {
            country: null,
            region: null,
            city: null,
            lat: null,
            lng: null,
            confidence: 0.2,
            evidence: []
          }
        ],
        instructionToNavigator: null,
        finalGuess: {
          country: null,
          region: null,
          city: null,
          lat: null,
          lng: null,
          confidence: 0,
          evidence: []
        }
      },
      verifier: {
        decision: "continue",
        reasoning: "No final guess is present to verify.",
        concerns: ["The place evidence is blank."],
        finalGuess: {
          country: null,
          region: null,
          city: null,
          lat: null,
          lng: null,
          confidence: 0,
          evidence: []
        }
      },
      uiMessage: "Continue."
    });

    expect(parsed.geographer.hypotheses[0].country).toBeUndefined();
    expect(parsed.geographer.finalGuess).toBeUndefined();
  });

  it("parses navigator survey output without transport actions", () => {
    const parsed = AgentModelOutputSchema.parse({
      status: "continue",
      navigator: {
        observation: "Navigator surveyed signs and road markings.",
        visibleText: ["Possible Main St sign"],
        roadClues: ["Two-lane suburban road"],
        placeClues: [],
        environmentClues: ["Palm trees"],
        uncertainty: ["Street sign is partially occluded"],
        surveySteps: [
          {
            tool: "google_maps_move",
            purpose: "Move to a new Street View node.",
            resultSummary: "Advanced to the next link target on the current road.",
            confidence: 0.7
          }
        ]
      },
      geographer: {
        hypotheses: [],
        instructionToNavigator: null,
        finalGuess: {
          country: null,
          region: null,
          city: null,
          lat: null,
          lng: null,
          confidence: 0,
          evidence: []
        }
      },
      verifier: {
        decision: "continue",
        reasoning: "No final guess is present to verify.",
        concerns: ["The place evidence is blank."],
        finalGuess: {
          country: null,
          region: null,
          city: null,
          lat: null,
          lng: null,
          confidence: 0,
          evidence: []
        }
      },
      uiMessage: "Continue."
    });

    expect(parsed.navigator.surveySteps[0].tool).toBe("google_maps_move");
  });
});

function collectMissingRequiredKeys(value: unknown, path: string, misses: string[]): void {
  if (!isRecord(value)) {
    return;
  }

  if (hasObjectType(value.type) && isRecord(value.properties)) {
    const required = Array.isArray(value.required) ? value.required : [];
    for (const key of Object.keys(value.properties)) {
      if (!required.includes(key)) {
        misses.push(`${path}.${key}`);
      }
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref") {
      continue;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => collectMissingRequiredKeys(item, `${path}.${key}[${index}]`, misses));
    } else {
      collectMissingRequiredKeys(entry, `${path}.${key}`, misses);
    }
  }
}

function collectUnsupportedSchemaKeys(value: unknown, path: string, unsupported: string[]): void {
  if (!isRecord(value)) {
    return;
  }

  for (const key of ["oneOf", "anyOf", "allOf", "$ref", "$defs"]) {
    if (key in value) {
      unsupported.push(`${path}.${key}`);
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => collectUnsupportedSchemaKeys(item, `${path}.${key}[${index}]`, unsupported));
    } else {
      collectUnsupportedSchemaKeys(entry, `${path}.${key}`, unsupported);
    }
  }
}

function hasObjectType(type: unknown): boolean {
  return type === "object" || (Array.isArray(type) && type.includes("object"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
