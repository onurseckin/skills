import type { HarnessEvent } from "../../core/contracts/index.ts";
import { isHarnessEvent } from "./types.ts";

export function formatEventToNdjson(event: HarnessEvent | Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

export function formatEventsToNdjsonStream(
  events: readonly (HarnessEvent | Record<string, unknown>)[],
): string {
  if (events.length === 0) return "";
  return events.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
}

export function parseNdjsonStream(ndjson: string): HarnessEvent[] {
  const lines = ndjson.split("\n");
  const result: HarnessEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    if (isHarnessEvent(parsed)) {
      result.push(parsed);
    } else if (typeof parsed === "object" && parsed !== null) {
      result.push(parsed as unknown as HarnessEvent);
    }
  }
  return result;
}
