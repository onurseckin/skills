import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveTelemetryPath } from "../core/shared/paths.ts";

export interface TelemetryEvent {
  readonly timestamp: string;
  readonly actor: string;
  readonly task_id?: string | undefined;
  readonly wave?: number | undefined;
  readonly action: string;
  readonly token_estimate?: number | undefined;
  readonly status: "success" | "failure" | "in_progress" | "blocked" | string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export function resolveTelemetryFilePath(repoRoot?: string, customPath?: string): string {
  return resolveTelemetryPath(repoRoot, customPath);
}

export function emitTelemetryEvent(
  event: TelemetryEvent,
  repoRoot?: string,
  customPath?: string,
): void {
  try {
    const filePath = resolveTelemetryFilePath(repoRoot, customPath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(event) + "\n";
    appendFileSync(filePath, line, "utf-8");
  } catch {
  }
}

export function readTelemetryStream(
  repoRoot?: string,
  customPath?: string,
): readonly TelemetryEvent[] {
  const filePath = resolveTelemetryFilePath(repoRoot, customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const events: TelemetryEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TelemetryEvent;
        if (parsed && typeof parsed === "object" && parsed.timestamp && parsed.actor) {
          events.push(parsed);
        }
      } catch {
      }
    }

    return events;
  } catch {
    return [];
  }
}
