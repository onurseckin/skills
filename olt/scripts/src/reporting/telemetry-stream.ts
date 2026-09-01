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

let inMemoryTelemetryBuffers: Map<string, string[]> | undefined;

export function enableInMemoryTelemetrySink(
  init?: Record<string, string[]>,
): Map<string, string[]> {
  inMemoryTelemetryBuffers = new Map(Object.entries(init ?? {}));
  return inMemoryTelemetryBuffers;
}

export function disableInMemoryTelemetrySink(): void {
  inMemoryTelemetryBuffers = undefined;
}

export function clearInMemoryTelemetrySink(): void {
  inMemoryTelemetryBuffers?.clear();
}

export function isInMemoryTelemetrySinkEnabled(): boolean {
  return inMemoryTelemetryBuffers !== undefined;
}

export function getInMemoryTelemetrySink(): Map<string, string[]> | undefined {
  return inMemoryTelemetryBuffers;
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
    const line = JSON.stringify(event);
    if (inMemoryTelemetryBuffers !== undefined) {
      let buf = inMemoryTelemetryBuffers.get(filePath);
      if (!buf) {
        buf = [];
        inMemoryTelemetryBuffers.set(filePath, buf);
      }
      buf.push(line);
      return;
    }
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(filePath, line + "\n", "utf-8");
  } catch {}
}

export function readTelemetryStream(
  repoRoot?: string,
  customPath?: string,
): readonly TelemetryEvent[] {
  const filePath = resolveTelemetryFilePath(repoRoot, customPath);
  if (inMemoryTelemetryBuffers !== undefined) {
    const lines = inMemoryTelemetryBuffers.get(filePath) ?? [];
    const events: TelemetryEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as TelemetryEvent;
        if (parsed && typeof parsed === "object" && parsed.timestamp && parsed.actor) {
          events.push(parsed);
        }
      } catch {}
    }
    return events;
  }
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
      } catch {}
    }

    return events;
  } catch {
    return [];
  }
}
