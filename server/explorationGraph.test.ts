import { describe, expect, it } from "vitest";
import { addEvidenceToGraph, addFrameToGraph, resetExplorationGraph } from "./explorationGraph";

describe("exploration graph", () => {
  it("stores physical nodes and camera directions for captured frames", () => {
    const runId = "graph-test";
    resetExplorationGraph(runId);

    const start = addFrameToGraph({
      runId,
      turnIndex: 1,
      currentUrl: "https://maps.example/start",
      frame: {
        id: "front",
        label: "Initial frame",
        publicUrl: "/snapshots/start.jpg",
        heading: 12,
        pitch: -4,
        zoom: 1.2
      }
    });
    const startNodeId = start.currentNodeId;

    const turned = addFrameToGraph({
      runId,
      turnIndex: 1,
      currentUrl: "https://maps.example/start",
      frame: {
        id: "zoomed-sign",
        label: "Zoomed sign",
        publicUrl: "/snapshots/sign.jpg",
        heading: 40,
        pitch: 2,
        zoom: 2.4
      }
    });

    expect(turned.nodes).toHaveLength(1);
    expect(turned.nodes[0].frames).toHaveLength(2);
    expect(turned.nodes[0].frames[1]).toMatchObject({ heading: 40, pitch: 2, zoom: 2.4 });

    const moved = addFrameToGraph({
      runId,
      turnIndex: 1,
      arrivedVia: "move link 0: continue ahead",
      currentUrl: "https://maps.example/next",
      frame: {
        id: "next",
        label: "Next node frame",
        publicUrl: "/snapshots/next.jpg",
        heading: 85,
        pitch: 0,
        zoom: 1
      }
    });

    expect(moved.nodes).toHaveLength(2);
    expect(moved.edges).toEqual([{ from: startNodeId, to: moved.currentNodeId, action: "move link 0: continue ahead" }]);

    const withEvidence = addEvidenceToGraph({
      runId,
      turnIndex: 1,
      evidence: [
        {
          type: "road",
          source: "visual",
          text: "Road overlay says Main St",
          confidence: 0.8
        }
      ]
    });

    expect(withEvidence?.evidence).toHaveLength(1);
    expect(withEvidence?.evidence[0]).toMatchObject({
      nodeId: moved.currentNodeId,
      frameId: "next",
      type: "road",
      source: "visual"
    });
  });
});
