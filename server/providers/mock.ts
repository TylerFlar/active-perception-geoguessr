import type { AgentProvider, ProviderRunInput } from "./provider";

export class MockProvider implements AgentProvider {
  name = "mock" as const;
  model = "mock-active-perception";

  async run(input: ProviderRunInput) {
    const turnCount = input.request.history.length;
    const placeholderGuess = {
      country: "Unknown",
      confidence: 0.05,
      evidence: ["Mock provider does not inspect pixels."]
    };
    const navigator = {
      observation:
        "Mock visual pass: current frame accepted. Replace GEO_AGENT_PROVIDER with openai or codex for real image reasoning and navigation.",
      visibleText: [],
      roadClues: [],
      placeClues: [],
      environmentClues: ["Mock provider does not inspect pixels."],
      uncertainty: ["No real visual evidence was gathered."],
      surveySteps: [
        {
          tool: "visual_inspection",
          purpose: "Exercise navigator observation wiring.",
          resultSummary: input.snapshotPath ? "Snapshot file was captured." : "Snapshot was unavailable.",
          confidence: input.snapshotPath ? 0.9 : 0.2
        }
      ],
      evidence: []
    };

    if (input.agentRole === "navigator") {
      return {
        status: "continue" as const,
        navigator,
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
        uiMessage: "Mock navigator survey complete."
      };
    }

    if (input.agentRole === "geographer") {
      return {
        status: "final" as const,
        navigator,
        geographer: {
          hypotheses: [placeholderGuess],
          instructionToNavigator: "Move to a new Street View link target and look for signage, road names, stores, landmarks, and institutions.",
          finalGuess: placeholderGuess
        },
        verifier: {
          decision: "continue" as const,
          reasoning: "Verifier role runs next.",
          concerns: [],
          finalGuess: undefined
        },
        uiMessage: "Mock geographer submitted a placeholder result."
      };
    }

    if (input.agentRole === "verifier") {
      const shouldEnd = turnCount >= 2;
      return {
        status: shouldEnd ? "final" as const : "continue" as const,
        navigator,
        geographer: {
          hypotheses: [placeholderGuess],
          instructionToNavigator: shouldEnd
            ? undefined
            : "Move to a new Street View link target and look for signage, road names, stores, landmarks, and institutions.",
          finalGuess: placeholderGuess
        },
        verifier: shouldEnd
          ? {
              decision: "accept" as const,
              reasoning: "The mock provider is intentionally ending after proving the three-agent plumbing.",
              concerns: ["Mock provider does not inspect pixels."],
              finalGuess: placeholderGuess
            }
          : {
              decision: "continue" as const,
              reasoning: "The mock result is only a placeholder.",
              concerns: ["Need a real visible place clue."],
              finalGuess: undefined
            },
        uiMessage: shouldEnd
          ? "Mock run complete. Configure a real provider to geolocate from the snapshot."
          : "Mock verifier requested another navigation turn."
      };
    }

    if (turnCount >= 2) {
      return {
        status: "final" as const,
        navigator: {
          observation:
            "Mock visual pass: the loop has sampled multiple Street View nodes. Replace GEO_AGENT_PROVIDER with openai or codex for real image reasoning.",
          visibleText: [],
          roadClues: [],
          placeClues: [],
          environmentClues: ["Mock provider does not inspect pixels."],
          uncertainty: ["No real visual evidence was gathered."],
          surveySteps: [
            {
              tool: "visual_inspection",
              purpose: "Smoke-test the navigator survey contract.",
              resultSummary: "No external vision provider was called.",
              confidence: 1
            }
          ],
          evidence: []
        },
        geographer: {
          hypotheses: [
            {
              country: "Unknown",
              confidence: 0.05,
              evidence: ["Mock provider does not inspect pixels."]
            }
          ],
          finalGuess: {
            country: "Unknown",
            confidence: 0.05,
            evidence: ["Use a real provider for evaluation runs."]
          }
        },
        verifier: {
          decision: "accept" as const,
          reasoning: "The mock provider is intentionally ending after proving the loop plumbing, not because it found visual evidence.",
          concerns: ["Mock provider does not inspect pixels."],
          finalGuess: {
            country: "Unknown",
            confidence: 0.05,
            evidence: ["Use a real provider for evaluation runs."]
          }
        },
        uiMessage: "Mock run complete. Configure a real provider to geolocate from the snapshot."
      };
    }

    return {
      status: "continue" as const,
      navigator: {
        observation:
          "Mock visual pass: current frame accepted. Replace GEO_AGENT_PROVIDER with openai or codex for real image reasoning and navigation.",
        visibleText: [],
        roadClues: [],
        placeClues: [],
        environmentClues: ["Mock provider does not inspect pixels."],
        uncertainty: ["No real visual evidence was gathered."],
        surveySteps: [
          {
            tool: "visual_inspection",
            purpose: "Exercise navigator observation wiring.",
            resultSummary: input.snapshotPath ? "Snapshot file was captured." : "No snapshot was captured.",
            confidence: input.snapshotPath ? 0.9 : 0.2
          }
        ],
        evidence: []
      },
      geographer: {
        hypotheses: [
          {
            country: "Unknown",
            confidence: 0.05,
            evidence: ["Mock provider has not inspected the image."]
          }
        ],
        instructionToNavigator: "Move to a new Street View link target and look for signage, bollards, lane markings, plates, and vegetation."
      },
      verifier: {
        decision: "continue" as const,
        reasoning: "The mock provider has not collected enough evidence for a final guess.",
        concerns: ["No real image reasoning has been performed."]
      },
      uiMessage: "Mock navigator survey complete."
    };
  }
}
