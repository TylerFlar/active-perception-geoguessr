import { describe, expect, it } from "vitest";
import type { AgentStepRequest } from "../../src/agent/types";
import { buildNavigatorGeographerPrompt } from "./prompt";

const request: AgentStepRequest = {
  pano: {
    source: "panoramax",
    lat: 1,
    lng: 2,
    heading: 0,
    pitch: 0,
    zoom: 0,
    links: []
  },
  history: []
};

describe("navigator/geographer prompt", () => {
  it("does not present failed pre-pass readers as negative evidence", () => {
    const prompt = buildNavigatorGeographerPrompt({
      request,
      snapshotPath: "snapshot.jpg",
      mcpConfig: { mcpServers: {} },
      perception: {
        ok: false,
        elapsedSec: 1.2,
        ocrTexts: [{ text: "A12", confidence: 0.9 }],
        plates: [],
        plateError: "fast-alpr backend unavailable"
      }
    });

    expect(prompt).toContain('- OCR text detections: [{"text":"A12","confidence":0.9}]');
    expect(prompt).toContain("- License plate detections: unavailable (fast-alpr backend unavailable)");
    expect(prompt).toContain("Only call a failed/unavailable reader");
    expect(prompt).not.toContain("the plate reader detected no readable plate");
  });
});
