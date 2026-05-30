import { describe, expect, it } from "vitest";
import type { AgentStepRequest } from "../../src/agent/types";
import { buildGeographerPrompt, buildNavigatorPrompt, buildVerifierPrompt } from "./prompt";
import type { AgentModelOutput } from "./schema";

const request: AgentStepRequest = {
  view: {
    source: "google_maps",
    heading: 0,
    pitch: 0,
    zoom: 0,
    moves: []
  },
  history: []
};

const navigatorOutput: AgentModelOutput = {
  status: "continue" as const,
  navigator: {
    observation: "Surveyed a suburban intersection. A road overlay may read Main or Maine; a school sign is visible but unreadable.",
    visibleText: ["Possible road overlay: Main or Maine"],
    roadClues: ["Suburban intersection"],
    placeClues: [],
    environmentClues: [],
    uncertainty: ["School sign unreadable"],
    surveySteps: []
  },
  geographer: {
    hypotheses: [],
    instructionToNavigator: undefined,
    finalGuess: undefined
  },
  verifier: {
    decision: "continue" as const,
    reasoning: "Navigator role only.",
    concerns: [],
    finalGuess: undefined
  },
  uiMessage: "Navigator survey complete."
};

describe("role prompts", () => {
  it("keeps Maps tools scoped to the navigator", () => {
    const navigatorPrompt = buildNavigatorPrompt({
      request: { ...request, maxTurns: 8 },
      snapshotPath: "snapshot.jpg",
      mcpConfig: { mcpServers: { "google-maps": { command: "python", args: [] } } }
    });
    const geographerPrompt = buildGeographerPrompt({
      request: { ...request, maxTurns: 8 },
      navigatorOutput
    });
    const verifierPrompt = buildVerifierPrompt({
      request: { ...request, maxTurns: 8 },
      navigatorOutput,
      geographerOutput: {
        ...navigatorOutput,
        status: "final",
        geographer: {
          hypotheses: [
            {
              country: "United States",
              region: "Example Region",
              city: "Example City",
              confidence: 0.62,
              evidence: ["Repeated local institution clue", "Road network clue"]
            }
          ],
          instructionToNavigator: undefined,
          finalGuess: {
            country: "United States",
            region: "Example Region",
            city: "Example City",
            confidence: 0.62,
            evidence: ["Repeated local institution clue", "Road network clue"]
          }
        }
      }
    });

    expect(navigatorPrompt).toContain("Available Google Maps MCP tools");
    expect(navigatorPrompt).toContain("google_maps_look");
    expect(navigatorPrompt).toContain("google_maps_screenshot");
    expect(navigatorPrompt).toContain("google_maps_pan");
    expect(navigatorPrompt).toContain("google_maps_zoom");
    expect(navigatorPrompt).toContain("Movement is optional");
    expect(navigatorPrompt).toContain("Move only if it seems useful");
    expect(navigatorPrompt).not.toContain("Tool budget");
    expect(navigatorPrompt).not.toContain("google_maps_pano");
    expect(navigatorPrompt).not.toContain("google_maps_explore");
    expect(navigatorPrompt).toContain("The Geographer handles location reasoning");
    expect(navigatorPrompt).toContain("no web search");
    expect(navigatorPrompt).toContain("GeoGuessr-style run");
    expect(navigatorPrompt).not.toContain("Native web search or model tools may be used");
    expect(navigatorPrompt).not.toContain("public searches grounded in visible clues");
    expect(navigatorPrompt).not.toContain("external OCR");
    expect(navigatorPrompt).not.toContain("pre-pass");
    expect(geographerPrompt).toContain("Google Maps tools, image access, and web search are unavailable");
    expect(verifierPrompt).toContain("Google Maps tools, image access, and web search are unavailable");
    expect(geographerPrompt).not.toContain("google_maps_");
    expect(verifierPrompt).not.toContain("google_maps_");
  });

  it("uses generic city-verification guidance", () => {
    const prompt = buildGeographerPrompt({
      request: { ...request, maxTurns: 8 },
      navigatorOutput
    });

    expect(prompt).toContain("Submit the best current result every turn");
    expect(prompt).toContain("One strong clue or a cluster of weaker visual clues");
    expect(prompt).toContain("Return status=final");
    expect(prompt).not.toContain("server skips verification");
    expect(prompt).not.toContain("California");
    expect(prompt).not.toContain("COMMIT EARLY");
  });

  it("tells the verifier to treat low city confidence as provisional", () => {
    const prompt = buildVerifierPrompt({
      request: { ...request, maxTurns: 8 },
      navigatorOutput,
      geographerOutput: {
        ...navigatorOutput,
        status: "final",
        geographer: {
          hypotheses: [
            {
              country: "United States",
              region: "Example Region",
              city: "Tentative City",
              confidence: 0.68,
              evidence: ["Regional clue"]
            }
          ],
          instructionToNavigator: undefined,
          finalGuess: {
            country: "United States",
            region: "Example Region",
            city: "Tentative City",
            confidence: 0.68,
            evidence: ["Regional clue"]
          }
        }
      }
    });

    expect(prompt).toContain("Moderate-confidence city-level guesses are still provisional");
    expect(prompt).toContain("one disambiguating clue");
    expect(prompt).not.toContain("85");
    expect(prompt).not.toContain("90");
  });
});
