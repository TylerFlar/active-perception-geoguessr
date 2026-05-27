import type { AgentProvider, ProviderRunInput } from "./provider";

export class MockProvider implements AgentProvider {
  name = "mock" as const;
  model = "mock-active-perception";

  async run(input: ProviderRunInput) {
    const turnCount = input.request.history.length;
    const hasMoveTargets = input.request.view.moves.length > 0;

    if (turnCount >= 2) {
      return {
        status: "final" as const,
        navigator: {
          observation:
            "Mock visual pass: the loop has sampled multiple headings. Replace GEO_AGENT_PROVIDER with openai or codex for real image reasoning.",
          perceptionCalls: [
            {
              tool: "visual_inspection",
              purpose: "Smoke-test the active perception contract.",
              resultSummary: "No external vision provider was called.",
              confidence: 1
            }
          ],
          action: { type: "hold" as const, reason: "Mock provider is ready to stop after proving the loop." }
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
        uiMessage: "Mock run complete. Configure a real provider to geolocate from the snapshot."
      };
    }

    return {
      status: "continue" as const,
      navigator: {
        observation:
          "Mock visual pass: current frame accepted. The next action intentionally changes viewpoint so UI control plumbing can be checked.",
        perceptionCalls: [
          {
            tool: "visual_inspection",
            purpose: "Exercise navigator observation and action wiring.",
            resultSummary: input.snapshotPath ? "Snapshot file was captured." : "No snapshot was captured.",
            confidence: input.snapshotPath ? 0.9 : 0.2
          }
        ],
        action: hasMoveTargets && turnCount === 1
          ? { type: "move" as const, linkIndex: 0, reason: "Verify that a navigator move action clicks a Google Maps target." }
          : { type: "pan" as const, headingDelta: 90, pitchDelta: 0, reason: "Verify that a navigator pan action updates the camera." }
      },
      geographer: {
        hypotheses: [
          {
            country: "Unknown",
            confidence: 0.05,
            evidence: ["Mock provider has not inspected the image."]
          }
        ],
        instructionToNavigator: "Sample another heading and look for signage, bollards, lane markings, plates, and vegetation."
      },
      uiMessage: "Mock navigator chose a camera action."
    };
  }
}
