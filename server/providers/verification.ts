import type { RunLogger } from "../runLogs";
import type { AgentModelOutput } from "./schema";

type FinalGuess = NonNullable<AgentModelOutput["geographer"]["finalGuess"]>;

const CITY_FINAL_CONFIDENCE_FLOOR = 0.85;
const REGION_FINAL_CONFIDENCE_FLOOR = 0.55;
const COUNTRY_FINAL_CONFIDENCE_FLOOR = 0.5;

export function applyVerifierGate(output: AgentModelOutput, log?: RunLogger): AgentModelOutput {
  const { verifier } = output;

  if (verifier.decision === "revise") {
    if (verifier.finalGuess) {
      if (!isAcceptableFinalGuess(verifier.finalGuess)) {
        return continueForLowConfidence(output, verifier.finalGuess, log);
      }
      log?.({
        source: "server",
        level: "warn",
        message: "Verifier revised the final guess",
        detail: {
          reasoning: verifier.reasoning,
          concerns: verifier.concerns,
          original: output.geographer.finalGuess,
          revised: verifier.finalGuess
        }
      });
      return {
        ...output,
        status: "final",
        geographer: {
          ...output.geographer,
          finalGuess: verifier.finalGuess
        },
        uiMessage: `Verifier revised final guess: ${formatGuess(verifier.finalGuess)}.`
      };
    }

    logVerifierContinue("Verifier requested revision without a replacement guess", output, log);
    return forceContinue(output);
  }

  if (verifier.decision === "continue") {
    if (output.geographer.finalGuess && isAcceptableFinalGuess(output.geographer.finalGuess)) {
      log?.({
        source: "server",
        level: "warn",
        message: "Verifier requested another look, but a plausible final guess is present; accepting geographer guess",
        detail: {
          reasoning: verifier.reasoning,
          concerns: verifier.concerns,
          proposedFinalGuess: output.geographer.finalGuess
        }
      });
      return {
        ...output,
        status: "final",
        uiMessage: output.uiMessage || `Final guess: ${formatGuess(output.geographer.finalGuess)}.`
      };
    }
    logVerifierContinue("Verifier requested another navigation step", output, log);
    return forceContinue(output);
  }

  const acceptedGuess = output.geographer.finalGuess || verifier.finalGuess;
  if (!acceptedGuess || !isAcceptableFinalGuess(acceptedGuess)) {
    return continueForLowConfidence(output, acceptedGuess, log);
  }

  if (output.status === "final" && !output.geographer.finalGuess && verifier.finalGuess) {
    return {
      ...output,
      geographer: {
        ...output.geographer,
        finalGuess: verifier.finalGuess
      }
    };
  }

  return output;
}

function continueForLowConfidence(output: AgentModelOutput, guess: FinalGuess | undefined, log?: RunLogger): AgentModelOutput {
  const concern = guess ? confidenceConcern(guess) : "Verifier accepted without a usable final guess.";
  const adjustedOutput: AgentModelOutput = {
    ...output,
    verifier: {
      ...output.verifier,
      decision: "continue",
      reasoning: guess
        ? `Accepted guess confidence is below the floor for this specificity. ${output.verifier.reasoning}`
        : output.verifier.reasoning,
      concerns: uniqueStrings([...output.verifier.concerns, concern])
    }
  };
  logVerifierContinue("Verifier acceptance was held for low confidence", adjustedOutput, log);
  return forceContinue(adjustedOutput);
}

function forceContinue(output: AgentModelOutput): AgentModelOutput {
  const instructionToNavigator = output.geographer.instructionToNavigator || nextInstruction(output);

  return {
    ...output,
    status: "continue",
    geographer: {
      ...output.geographer,
      instructionToNavigator,
      finalGuess: undefined
    },
    uiMessage: `Verifier requested another look: ${shorten(output.verifier.reasoning)}`
  };
}

function nextInstruction(output: AgentModelOutput): string {
  const concern = output.verifier.concerns.find((entry) => entry.trim());
  if (concern) {
    return `Seek evidence that resolves verifier concern: ${concern}`;
  }
  return "Seek another independent clue before finalizing the city or region.";
}

function logVerifierContinue(message: string, output: AgentModelOutput, log?: RunLogger): void {
  log?.({
    source: "server",
    level: "warn",
    message,
    detail: {
      reasoning: output.verifier.reasoning,
      concerns: output.verifier.concerns,
      proposedFinalGuess: output.geographer.finalGuess
    }
  });
}

function isUsableFinalGuess(guess: { city?: string; region?: string; country?: string; confidence: number }): boolean {
  const place = [guess.city, guess.region, guess.country].some((value) => {
    return isKnownPlaceName(value);
  });
  return place && guess.confidence > 0;
}

function isAcceptableFinalGuess(guess: FinalGuess): boolean {
  return isUsableFinalGuess(guess) && guess.confidence >= confidenceFloor(guess);
}

function confidenceFloor(guess: FinalGuess): number {
  if (isKnownPlaceName(guess.city)) {
    return CITY_FINAL_CONFIDENCE_FLOOR;
  }
  if (isKnownPlaceName(guess.region)) {
    return REGION_FINAL_CONFIDENCE_FLOOR;
  }
  if (isKnownPlaceName(guess.country)) {
    return COUNTRY_FINAL_CONFIDENCE_FLOOR;
  }
  return 1;
}

function confidenceConcern(guess: FinalGuess): string {
  const percent = Math.round(guess.confidence * 100);
  const specificity = isKnownPlaceName(guess.city)
    ? "city"
    : isKnownPlaceName(guess.region)
    ? "region"
    : "country";
  return `Current ${specificity}-level guess is only ${percent}% confident; seek one disambiguating clue before accepting it.`;
}

function isKnownPlaceName(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "unknown" && normalized !== "unclear" && normalized !== "unsure";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatGuess(guess: { city?: string; region?: string; country?: string }): string {
  return [guess.city, guess.region, guess.country].filter(Boolean).join(", ") || "Unknown";
}

function shorten(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
