export type StreetViewAction =
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

export interface StreetViewMoveTarget {
  index: number;
  screenX: number;
  screenY: number;
  description?: string;
  heading?: number;
}

export interface StreetViewState {
  source: "google_maps";
  sessionId?: string;
  heading: number;
  pitch: number;
  zoom: number;
  moves: StreetViewMoveTarget[];
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
  view: StreetViewState;
  snapshotUrl?: string;
  navigator: {
    observation: string;
    perceptionCalls: PerceptionCallSummary[];
    action: StreetViewAction;
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
  view: StreetViewState;
  history: AgentTurn[];
  runGoal?: string;
  runId?: string;
  maxTurns?: number;
}

export interface AgentStepResponse {
  turn: AgentTurn;
  provider: string;
  model?: string;
}
