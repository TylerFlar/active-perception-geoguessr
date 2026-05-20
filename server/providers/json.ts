import { AgentModelOutputSchema, type AgentModelOutput } from "./schema";

export function parseAgentOutput(text: string): AgentModelOutput & { rawText?: string } {
  const parsed = parseJsonCandidate(text);
  const output = AgentModelOutputSchema.parse(parsed);
  return { ...output, rawText: text };
}

export function parseAgentOutputObject(value: unknown): AgentModelOutput & { rawText?: string } {
  const output = AgentModelOutputSchema.parse(value);
  return { ...output, rawText: JSON.stringify(value) };
}

// The Claude CLI puts the schema-conforming object in `structured_output` on the
// final result event; its `result` field is only a prose chat summary.
export function extractStructuredOutputFromJsonl(stream: string): unknown {
  let found: unknown;
  for (const line of stream.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = tryParseJson(line);
    if (
      isRecord(parsed) &&
      parsed.type === "result" &&
      parsed.structured_output !== undefined &&
      parsed.structured_output !== null
    ) {
      found = parsed.structured_output;
    }
  }
  return found;
}

export function parseJsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Provider returned empty output.");
  }

  const direct = tryParseJson(trimmed);
  if (direct !== undefined) {
    return direct;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const objectText = extractLastObject(trimmed);
  const parsed = objectText ? tryParseJson(objectText) : undefined;
  if (parsed !== undefined) {
    return parsed;
  }

  throw new Error(`Could not parse provider JSON output: ${trimmed.slice(0, 500)}`);
}

export function extractResultTextFromJsonl(stream: string): string {
  let lastText = "";

  for (const line of stream.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = tryParseJson(line);
    if (!isRecord(parsed)) {
      continue;
    }

    const text = textFromJsonlEvent(parsed);
    if (text) {
      lastText = text;
    }
  }

  return lastText || stream;
}

function textFromJsonlEvent(event: Record<string, unknown>): string | undefined {
  const direct = stringFromRecord(event, ["result", "text", "message", "output", "content"]);
  if (direct) {
    return direct;
  }

  if (isRecord(event.item)) {
    const itemText = stringFromRecord(event.item, ["result", "text", "message", "output", "content"]);
    if (itemText) {
      return itemText;
    }
  }

  if (Array.isArray(event.content)) {
    const text = textFromContentArray(event.content);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const text = textFromContentArray(value);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function textFromContentArray(content: unknown[]): string | undefined {
  const parts = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (isRecord(entry)) {
        return stringFromRecord(entry, ["text", "message", "output", "content"]);
      }
      return undefined;
    })
    .filter((entry): entry is string => Boolean(entry?.trim()));
  return parts.length ? parts.join("\n") : undefined;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractLastObject(text: string): string | undefined {
  let depth = 0;
  let end = -1;

  for (let i = text.length - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === "}") {
      if (end === -1) {
        end = i;
      }
      depth += 1;
    } else if (char === "{") {
      depth -= 1;
      if (depth === 0 && end !== -1) {
        return text.slice(i, end + 1);
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
