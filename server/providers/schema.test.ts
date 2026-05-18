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
        perceptionCalls: [],
        action: {
          type: "pan",
          headingDelta: 45,
          pitchDelta: null,
          zoomDelta: null,
          linkIndex: null,
          target: null,
          heading: null,
          pitch: null,
          zoom: null,
          reason: "Check the next heading."
        }
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
      uiMessage: "Continue."
    });

    expect(parsed.navigator.action.type).toBe("pan");
    expect(parsed.geographer.hypotheses[0].country).toBeUndefined();
    expect(parsed.geographer.finalGuess).toBeUndefined();
  });

  it("coerces null headingDelta/zoomDelta on pan and zoom actions", () => {
    const panParsed = AgentModelOutputSchema.parse({
      status: "continue",
      navigator: {
        observation: "Model returned a pan but did not specify a heading delta.",
        perceptionCalls: [],
        action: {
          type: "pan",
          headingDelta: null,
          pitchDelta: null,
          zoomDelta: null,
          linkIndex: null,
          target: null,
          heading: null,
          pitch: null,
          zoom: null,
          reason: "Try a small pan."
        }
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
      uiMessage: "Continue."
    });

    expect(panParsed.navigator.action).toMatchObject({ type: "pan", headingDelta: 0 });

    const zoomParsed = AgentModelOutputSchema.parse({
      status: "continue",
      navigator: {
        observation: "Model returned a zoom but did not specify a delta.",
        perceptionCalls: [],
        action: {
          type: "zoom",
          headingDelta: null,
          pitchDelta: null,
          zoomDelta: null,
          linkIndex: null,
          target: null,
          heading: null,
          pitch: null,
          zoom: null,
          reason: "Try zooming."
        }
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
      uiMessage: "Continue."
    });

    expect(zoomParsed.navigator.action).toMatchObject({ type: "zoom", zoomDelta: 0 });
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
