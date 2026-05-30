import { z } from "zod";

const OptionalStringSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value === null ? undefined : value,
  z.string().optional()
);
const RequiredStringSchema = (fallback: string) =>
  z.preprocess(
    (value) => typeof value === "string" && value.trim() ? value : fallback,
    z.string().min(1)
  );
const OptionalLatitudeSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-90).max(90).optional()
);
const OptionalLongitudeSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-180).max(180).optional()
);
export const SurveyStepSchema = z.object({
  tool: RequiredStringSchema("role_handoff"),
  purpose: RequiredStringSchema("Placeholder role handoff."),
  resultSummary: RequiredStringSchema("No survey result was provided for this placeholder step."),
  confidence: z.number().min(0).max(1)
});

export const GeoHypothesisSchema = z.object({
  country: OptionalStringSchema,
  region: OptionalStringSchema,
  city: OptionalStringSchema,
  lat: OptionalLatitudeSchema,
  lng: OptionalLongitudeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([])
});

const OptionalGeoHypothesisSchema = z.preprocess(
  (value) => isBlankGeoHypothesisInput(value) ? undefined : value,
  GeoHypothesisSchema.optional()
);

export const VerifierReviewSchema = z.object({
  decision: z.enum(["accept", "revise", "continue"]),
  reasoning: RequiredStringSchema("Verifier role has not run yet."),
  concerns: z.array(z.string()).default([]),
  finalGuess: OptionalGeoHypothesisSchema
});

export const AgentModelOutputSchema = z.object({
  status: z.enum(["continue", "final", "error"]),
  navigator: z.object({
    observation: RequiredStringSchema("No navigator observation was provided."),
    visibleText: z.array(z.string()).default([]),
    roadClues: z.array(z.string()).default([]),
    placeClues: z.array(z.string()).default([]),
    environmentClues: z.array(z.string()).default([]),
    uncertainty: z.array(z.string()).default([]),
    surveySteps: z.array(SurveyStepSchema).default([])
  }),
  geographer: z.object({
    hypotheses: z.array(GeoHypothesisSchema).default([]),
    instructionToNavigator: OptionalStringSchema,
    finalGuess: OptionalGeoHypothesisSchema
  }),
  verifier: VerifierReviewSchema,
  uiMessage: RequiredStringSchema("Agent step complete.")
});

export type AgentModelOutput = z.infer<typeof AgentModelOutputSchema>;

const geoHypothesisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["country", "region", "city", "lat", "lng", "confidence", "evidence"],
  properties: {
    country: { type: ["string", "null"] },
    region: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    lat: { type: ["number", "null"], minimum: -90, maximum: 90 },
    lng: { type: ["number", "null"], minimum: -180, maximum: 180 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", items: { type: "string" } }
  }
} as const;

export const agentOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "navigator", "geographer", "verifier", "uiMessage"],
  properties: {
    status: { type: "string", enum: ["continue", "final", "error"] },
    navigator: {
      type: "object",
      additionalProperties: false,
      required: [
        "observation",
        "visibleText",
        "roadClues",
        "placeClues",
        "environmentClues",
        "uncertainty",
        "surveySteps"
      ],
      properties: {
        observation: { type: "string" },
        visibleText: { type: "array", items: { type: "string" } },
        roadClues: { type: "array", items: { type: "string" } },
        placeClues: { type: "array", items: { type: "string" } },
        environmentClues: { type: "array", items: { type: "string" } },
        uncertainty: { type: "array", items: { type: "string" } },
        surveySteps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["tool", "purpose", "resultSummary", "confidence"],
            properties: {
              tool: { type: "string" },
              purpose: { type: "string" },
              resultSummary: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 }
            }
          }
        }
      }
    },
    geographer: {
      type: "object",
      additionalProperties: false,
      required: ["hypotheses", "instructionToNavigator", "finalGuess"],
      properties: {
        hypotheses: { type: "array", items: geoHypothesisJsonSchema },
        instructionToNavigator: { type: ["string", "null"] },
        finalGuess: geoHypothesisJsonSchema
      }
    },
    verifier: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "reasoning", "concerns", "finalGuess"],
      properties: {
        decision: { type: "string", enum: ["accept", "revise", "continue"] },
        reasoning: { type: "string" },
        concerns: { type: "array", items: { type: "string" } },
        finalGuess: geoHypothesisJsonSchema
      }
    },
    uiMessage: { type: "string" }
  }
} as const;

function isBlankGeoHypothesisInput(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const hasPlace = ["country", "region", "city", "lat", "lng"].some((key) => candidate[key] !== null && candidate[key] !== undefined);
  const evidence = candidate.evidence;
  return !hasPlace && candidate.confidence === 0 && Array.isArray(evidence) && evidence.length === 0;
}
