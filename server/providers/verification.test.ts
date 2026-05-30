import { describe, expect, it } from "vitest";
import type { AgentModelOutput } from "./schema";
import { applyVerifierGate } from "./verification";

describe("verifier gate", () => {
  it("uses a verifier revision as the final guess", () => {
    const output = applyVerifierGate({
      ...baseFinalOutput(),
      verifier: {
        decision: "revise",
        reasoning: "The visible institution name and road shield fit the revised city better than the original guess.",
        concerns: ["The original guess relied on one likely misread road label."],
        finalGuess: {
          country: "United States",
          region: "Example Region",
          city: "Revised City",
          lat: 40.12,
          lng: -75.34,
          confidence: 0.88,
          evidence: ["Local institution clue", "Road shield clue"]
        }
      }
    });

    expect(output.status).toBe("final");
    expect(output.geographer.finalGuess?.city).toBe("Revised City");
    expect(output.uiMessage).toContain("Verifier revised");
  });

  it("keeps a geographer final guess when the verifier asks for extra caution", () => {
    const output = applyVerifierGate({
      ...baseFinalOutput(),
      verifier: {
        decision: "continue",
        reasoning: "A single street-name reading does not support a city-level final.",
        concerns: ["Need another sign or local institution before choosing the city."]
      }
    });

    expect(output.status).toBe("final");
    expect(output.geographer.finalGuess?.city).toBe("Original City");
  });

  it("continues when the verifier accepts a low-confidence city guess", () => {
    const fixture = baseFinalOutput();
    const output = applyVerifierGate({
      ...fixture,
      geographer: {
        ...fixture.geographer,
        hypotheses: [
          {
            country: "United States",
            region: "Example Region",
            city: "Tentative City",
            confidence: 0.68,
            evidence: ["Regional advertisement clue"]
          }
        ],
        finalGuess: {
          country: "United States",
          region: "Example Region",
          city: "Tentative City",
          confidence: 0.68,
          evidence: ["Regional advertisement clue"]
        }
      },
      verifier: {
        decision: "accept",
        reasoning: "The proposal is plausible but not strongly confirmed.",
        concerns: []
      }
    });

    expect(output.status).toBe("continue");
    expect(output.geographer.finalGuess).toBeUndefined();
    expect(output.geographer.instructionToNavigator).toContain("68% confident");
  });

  it("continues instead of overriding verifier caution when confidence is low", () => {
    const fixture = baseFinalOutput();
    const output = applyVerifierGate({
      ...fixture,
      geographer: {
        ...fixture.geographer,
        finalGuess: {
          country: "United States",
          region: "Example Region",
          city: "Tentative City",
          confidence: 0.68,
          evidence: ["Regional clue"]
        }
      },
      verifier: {
        decision: "continue",
        reasoning: "The city is still provisional.",
        concerns: ["Look for a cross street or local business cluster."]
      }
    });

    expect(output.status).toBe("continue");
    expect(output.geographer.finalGuess).toBeUndefined();
    expect(output.geographer.instructionToNavigator).toContain("Look for a cross street");
  });

  it("forces another navigation turn only when no final guess is present", () => {
    const fixture = baseFinalOutput();
    const output = applyVerifierGate({
      ...fixture,
      status: "continue",
      geographer: {
        ...fixture.geographer,
        finalGuess: undefined
      },
      verifier: {
        decision: "continue",
        reasoning: "There is no usable city guess yet.",
        concerns: ["Need any local clue."]
      }
    });

    expect(output.status).toBe("continue");
    expect(output.geographer.finalGuess).toBeUndefined();
    expect(output.geographer.instructionToNavigator).toContain("Need any local clue");
  });

  it("does not accept an unknown placeholder when the verifier continues", () => {
    const fixture = baseFinalOutput();
    const output = applyVerifierGate({
      ...fixture,
      geographer: {
        ...fixture.geographer,
        finalGuess: {
          country: "Unknown",
          confidence: 0.05,
          evidence: ["Placeholder result."]
        }
      },
      verifier: {
        decision: "continue",
        reasoning: "The result is only a placeholder.",
        concerns: ["Need a real visible place clue."]
      }
    });

    expect(output.status).toBe("continue");
    expect(output.geographer.finalGuess).toBeUndefined();
    expect(output.geographer.instructionToNavigator).toContain("Need a real visible");
  });
});

function baseFinalOutput(): AgentModelOutput {
  return {
    status: "final",
    navigator: {
      observation: "A suburban intersection with street signs.",
      visibleText: [],
      roadClues: ["Suburban intersection"],
      placeClues: [],
      environmentClues: [],
      uncertainty: [],
      surveySteps: []
    },
    geographer: {
      hypotheses: [
        {
          country: "United States",
          region: "Example Region",
        city: "Original City",
        lat: 40.01,
        lng: -75.01,
        confidence: 0.88,
        evidence: ["Possible road label"]
      }
    ],
      instructionToNavigator: undefined,
      finalGuess: {
        country: "United States",
        region: "Example Region",
        city: "Original City",
        lat: 40.01,
        lng: -75.01,
        confidence: 0.88,
        evidence: ["Possible road label"]
      }
    },
    verifier: {
      decision: "accept",
      reasoning: "Base fixture accepts the proposed guess.",
      concerns: []
    },
    uiMessage: "Final guess: Original City."
  };
}
