export type PanoAction =
  | {
      type: "pan";
      headingDelta: number;
      pitchDelta?: number;
      reason: string;
    }
  | {
      type: "zoom";
      zoomDelta: number;
      reason: string;
    }
  | {
      type: "move";
      linkIndex: number;
      reason: string;
    }
  | {
      type: "inspect";
      target: "sign" | "plate" | "road" | "vegetation" | "architecture" | "utility" | "sky" | "other";
      heading?: number;
      pitch?: number;
      zoom?: number;
      reason: string;
    }
  | {
      type: "hold";
      reason: string;
    };

export interface PanoLinkState {
  index: number;
  heading: number;
  description?: string;
  pano?: string;
  sequenceId?: string;
}

export interface PanoState {
  panoId?: string;
  sequenceId?: string;
  source: "panoramax";
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  links: PanoLinkState[];
}

export interface PerceptionCallSummary {
  tool: string;
  purpose: string;
  resultSummary: string;
  confidence: number;
}

export interface GeoHypothesis {
  country?: string;
  region?: string;
  city?: string;
  lat?: number;
  lng?: number;
  confidence: number;
  evidence: string[];
}

export interface AgentTurn {
  id: string;
  index: number;
  createdAt: string;
  status: "continue" | "final" | "error";
  pano: PanoState;
  snapshotUrl?: string;
  navigator: {
    observation: string;
    perceptionCalls: PerceptionCallSummary[];
    action: PanoAction;
  };
  geographer: {
    hypotheses: GeoHypothesis[];
    instructionToNavigator?: string;
    finalGuess?: GeoHypothesis;
  };
  uiMessage: string;
  rawText?: string;
}

export interface AgentStepRequest {
  pano: PanoState;
  history: AgentTurn[];
  runGoal?: string;
  runId?: string;
  maxTurns?: number;
  snapshotDataUrl?: string;
}

export interface AgentStepResponse {
  turn: AgentTurn;
  provider: string;
  model?: string;
}
