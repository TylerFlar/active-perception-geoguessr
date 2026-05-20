import { describe, expect, it } from "vitest";
import { normalizePerceptionPrepass } from "./perceptionPrepass";

describe("perception pre-pass normalization", () => {
  it("preserves successful reader output while surfacing failed readers", () => {
    const result = normalizePerceptionPrepass({
      ok: true,
      elapsed_sec: 1.2,
      ocr: {
        ok: true,
        texts: [{ text: "A12", confidence: 0.9 }]
      },
      plate: {
        ok: false,
        error: "fast-alpr backend unavailable"
      }
    });

    expect(result).toMatchObject({
      ok: false,
      elapsedSec: 1.2,
      ocrTexts: [{ text: "A12", confidence: 0.9 }],
      plates: [],
      plateError: "fast-alpr backend unavailable",
      note: "ALPR failed: fast-alpr backend unavailable"
    });
  });
});
