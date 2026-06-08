import { describe, expect, it } from "vitest";
import type { AgentStepRequest } from "../../src/agent/types";
import { buildGeographerPrompt, buildVerifierPrompt, geographerSurvey, overlayClueTexts } from "./prompt";
import type { AgentModelOutput } from "./schema";

const request: AgentStepRequest = {
  view: { source: "google_maps", heading: 0, pitch: 0, zoom: 0, moves: [] },
  history: []
};

function navigatorWith(
  overrides: Partial<AgentModelOutput["navigator"]>
): AgentModelOutput {
  return {
    status: "continue",
    navigator: {
      observation: "A quiet intersection.",
      visibleText: [],
      roadClues: [],
      placeClues: [],
      environmentClues: [],
      uncertainty: [],
      surveySteps: [],
      evidence: [],
      ...overrides
    },
    geographer: { hypotheses: [], instructionToNavigator: undefined, finalGuess: undefined },
    verifier: { decision: "continue", reasoning: "Verifier role has not run yet.", concerns: [], finalGuess: undefined },
    uiMessage: "Navigator survey complete."
  };
}

describe("overlayClueTexts", () => {
  it("collects overlay and uncertain clue texts (normalized) and ignores physical/inferred", () => {
    const nav = navigatorWith({
      evidence: [
        { type: "road", source: "overlay", text: "  Main St  ", confidence: 0.9, useForGuess: false },
        { type: "place", source: "uncertain", text: "Maybe Joe's Diner", confidence: 0.5, useForGuess: false },
        { type: "place", source: "physical", text: "Boulangerie Paul", confidence: 0.9, useForGuess: true },
        { type: "summary", source: "inferred", text: "European façades", confidence: 0.8, useForGuess: true }
      ]
    }).navigator;
    const set = overlayClueTexts(nav);
    expect(set.has("main st")).toBe(true);
    expect(set.has("maybe joe's diner")).toBe(true);
    expect(set.has("boulangerie paul")).toBe(false);
    expect(set.has("european façades")).toBe(false);
    expect(set.size).toBe(2);
  });
});

describe("geographerSurvey", () => {
  it("drops clues the Navigator flagged as overlay/uncertain across all clue arrays", () => {
    const nav = navigatorWith({
      visibleText: ["Main St", "STOP"],
      roadClues: ["Main St", "two-lane road"],
      placeClues: ["Maybe Joe's Diner", "red-brick church"],
      evidence: [
        { type: "road", source: "overlay", text: "Main St", confidence: 0.95, useForGuess: false },
        { type: "place", source: "uncertain", text: "Maybe Joe's Diner", confidence: 0.5, useForGuess: false }
      ]
    }).navigator;
    const survey = geographerSurvey(nav);
    expect(survey.roadClues).toEqual(["two-lane road"]);       // "Main St" removed
    expect(survey.visibleText).toEqual(["STOP"]);              // overlay "Main St" removed, real sign kept
    expect(survey.placeClues).toEqual(["red-brick church"]);   // uncertain entry removed, physical kept
  });

  it("is a no-op when the Navigator did not classify evidence (safe fallback)", () => {
    const nav = navigatorWith({
      visibleText: ["Main St"],
      roadClues: ["Main St", "two-lane road"],
      placeClues: ["Joe's Diner"],
      evidence: []
    }).navigator;
    const survey = geographerSurvey(nav);
    expect(survey.visibleText).toEqual(["Main St"]);
    expect(survey.roadClues).toEqual(["Main St", "two-lane road"]);
    expect(survey.placeClues).toEqual(["Joe's Diner"]);
  });

  it("matches case- and whitespace-insensitively but keeps non-matching clues", () => {
    const nav = navigatorWith({
      roadClues: ["  main st ", "Highway 9"],
      evidence: [{ type: "road", source: "overlay", text: "MAIN ST", confidence: 0.9, useForGuess: false }]
    }).navigator;
    const survey = geographerSurvey(nav);
    expect(survey.roadClues).toEqual(["Highway 9"]);
  });

  it("preserves observation, environmentClues, uncertainty, and surveySteps untouched", () => {
    const nav = navigatorWith({
      observation: "Overlay says Main St near a school.",
      environmentClues: ["temperate vegetation"],
      uncertainty: ["school sign unreadable"],
      surveySteps: [{ tool: "google_maps_look", purpose: "scan", resultSummary: "panned east", confidence: 0.7 }],
      evidence: [{ type: "road", source: "overlay", text: "Main St", confidence: 0.9, useForGuess: false }]
    }).navigator;
    const survey = geographerSurvey(nav);
    expect(survey.observation).toBe("Overlay says Main St near a school.");
    expect(survey.environmentClues).toEqual(["temperate vegetation"]);
    expect(survey.uncertainty).toEqual(["school sign unreadable"]);
    expect(survey.surveySteps).toHaveLength(1);
  });
});

describe("leak boundary: Geographer is filtered, Verifier is not", () => {
  const nav = navigatorWith({
    roadClues: ["Overlay Boulevard", "two-lane road"],
    evidence: [{ type: "road", source: "overlay", text: "Overlay Boulevard", confidence: 0.95, useForGuess: false }]
  });

  it("Geographer prompt withholds the overlay-flagged clue", () => {
    const prompt = buildGeographerPrompt({ request, navigatorOutput: nav });
    expect(prompt).not.toContain("Overlay Boulevard");
    expect(prompt).toContain("two-lane road");
    expect(prompt).toContain("have been withheld");
  });

  it("Verifier prompt still shows the overlay clue so it can audit overlay influence", () => {
    const prompt = buildVerifierPrompt({ request, navigatorOutput: nav, geographerOutput: nav });
    expect(prompt).toContain("Overlay Boulevard");
  });

  it("Geographer no longer advertises road overlays as usable evidence", () => {
    const prompt = buildGeographerPrompt({ request, navigatorOutput: nav });
    expect(prompt).not.toContain("road overlays, business clusters");
    expect(prompt).toContain("Google-rendered map overlays and text flagged as uncertain are not");
  });
});
