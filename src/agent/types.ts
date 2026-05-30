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

export interface SurveyStepSummary {
  tool: string;
  purpose: string;
  resultSummary: string;
  confidence: number;
}

export interface ExplorationFrame {
  id: string;
  label: string;
  publicUrl?: string;
  heading: number;
  pitch: number;
  zoom: number;
}

export interface ExplorationGraphNode {
  id: string;
  label: string;
  turnIndex: number;
  publicUrl?: string;
  arrivedVia?: string;
  frames: ExplorationFrame[];
}

export interface ExplorationGraphEdge {
  from: string;
  to: string;
  action: string;
}

export type ExplorationEvidenceSource = "visual" | "inferred";

export interface ExplorationEvidence {
  id: string;
  turnIndex: number;
  nodeId?: string;
  frameId?: string;
  type: "text" | "road" | "place" | "environment" | "uncertainty" | "summary";
  source: ExplorationEvidenceSource;
  text: string;
  confidence: number;
}

export interface ExplorationGraphSummary {
  nodes: ExplorationGraphNode[];
  edges: ExplorationGraphEdge[];
  evidence: ExplorationEvidence[];
  currentNodeId?: string;
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

export interface VerifierReview {
  decision: "accept" | "revise" | "continue";
  reasoning: string;
  concerns: string[];
  finalGuess?: GeoHypothesis;
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
    visibleText: string[];
    roadClues: string[];
    placeClues: string[];
    environmentClues: string[];
    uncertainty: string[];
    surveySteps: SurveyStepSummary[];
  };
  geographer: {
    hypotheses: GeoHypothesis[];
    instructionToNavigator?: string;
    finalGuess?: GeoHypothesis;
  };
  verifier?: VerifierReview;
  explorationGraph?: ExplorationGraphSummary;
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
