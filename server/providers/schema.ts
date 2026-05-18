import { z } from "zod";

const OptionalStringSchema = z.preprocess((value) => value === null ? undefined : value, z.string().optional());
const OptionalLatitudeSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-90).max(90).optional()
);
const OptionalLongitudeSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-180).max(180).optional()
);
const OptionalHeadingSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(0).max(360).optional()
);
const OptionalPitchDeltaSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-45).max(45).optional()
);
const OptionalPitchSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(-90).max(90).optional()
);
const OptionalZoomSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().min(0).max(4).optional()
);

export const PerceptionCallSchema = z.object({
  tool: z.string().min(1),
  purpose: z.string().min(1),
  resultSummary: z.string().min(1),
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

const NullableHeadingDeltaSchema = z.preprocess(
  (value) => value === null ? 0 : value,
  z.number().min(-180).max(180)
);
const NullableZoomDeltaSchema = z.preprocess(
  (value) => value === null ? 0 : value,
  z.number().min(-4).max(4)
);

const PanActionSchema = z.object({
  type: z.literal("pan"),
  headingDelta: NullableHeadingDeltaSchema,
  pitchDelta: OptionalPitchDeltaSchema,
  reason: z.string().min(1)
});

const ZoomActionSchema = z.object({
  type: z.literal("zoom"),
  zoomDelta: NullableZoomDeltaSchema,
  reason: z.string().min(1)
});

const MoveActionSchema = z.object({
  type: z.literal("move"),
  linkIndex: z.number().int().min(0),
  reason: z.string().min(1)
});

const InspectActionSchema = z.object({
  type: z.literal("inspect"),
  target: z.enum(["sign", "plate", "road", "vegetation", "architecture", "utility", "sky", "other"]),
  heading: OptionalHeadingSchema,
  pitch: OptionalPitchSchema,
  zoom: OptionalZoomSchema,
  reason: z.string().min(1)
});

const HoldActionSchema = z.object({
  type: z.literal("hold"),
  reason: z.string().min(1)
});

export const AgentModelOutputSchema = z.object({
  status: z.enum(["continue", "final", "error"]),
  navigator: z.object({
    observation: z.string().min(1),
    perceptionCalls: z.array(PerceptionCallSchema).default([]),
    action: z.discriminatedUnion("type", [
      PanActionSchema,
      ZoomActionSchema,
      MoveActionSchema,
      InspectActionSchema,
      HoldActionSchema
    ])
  }),
  geographer: z.object({
    hypotheses: z.array(GeoHypothesisSchema).default([]),
    instructionToNavigator: OptionalStringSchema,
    finalGuess: OptionalGeoHypothesisSchema
  }),
  uiMessage: z.string().min(1)
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
  required: ["status", "navigator", "geographer", "uiMessage"],
  properties: {
    status: { type: "string", enum: ["continue", "final", "error"] },
    navigator: {
      type: "object",
      additionalProperties: false,
      required: ["observation", "perceptionCalls", "action"],
      properties: {
        observation: { type: "string" },
        perceptionCalls: {
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
        },
        action: {
          type: "object",
          additionalProperties: false,
          required: [
            "type",
            "headingDelta",
            "pitchDelta",
            "zoomDelta",
            "linkIndex",
            "target",
            "heading",
            "pitch",
            "zoom",
            "reason"
          ],
          properties: {
            type: { type: "string", enum: ["pan", "zoom", "move", "inspect", "hold"] },
            headingDelta: { type: ["number", "null"], minimum: -180, maximum: 180 },
            pitchDelta: { type: ["number", "null"], minimum: -45, maximum: 45 },
            zoomDelta: { type: ["number", "null"], minimum: -4, maximum: 4 },
            linkIndex: { type: ["integer", "null"], minimum: 0 },
            target: {
              type: ["string", "null"],
              enum: ["sign", "plate", "road", "vegetation", "architecture", "utility", "sky", "other", null]
            },
            heading: { type: ["number", "null"], minimum: 0, maximum: 360 },
            pitch: { type: ["number", "null"], minimum: -90, maximum: 90 },
            zoom: { type: ["number", "null"], minimum: 0, maximum: 4 },
            reason: { type: "string" }
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
