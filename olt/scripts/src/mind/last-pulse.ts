import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { atomicWriteJson } from "../core/durable-write.ts";

export interface LastPulseRecord {
  readonly at: string;
  readonly pulse_id: string | null;
  readonly outcome: string | null;
  readonly next_wake_at: string | null;
}

/**
 * Durably writes last_pulse.json using atomicWriteJson per CONTRACTS.md §1.5.
 */
export function writeLastPulse(capsuleRoot: string, record: LastPulseRecord): void {
  const filePath = join(capsuleRoot, "last_pulse.json");
  atomicWriteJson(filePath, {
    at: record.at,
    pulse_id: record.pulse_id,
    outcome: record.outcome,
    next_wake_at: record.next_wake_at,
  } as unknown as JsonObject);
}

/**
 * Reads last_pulse.json from capsuleRoot, or returns null if not present or invalid.
 */
export function readLastPulse(capsuleRoot: string): LastPulseRecord | null {
  const filePath = join(capsuleRoot, "last_pulse.json");
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      at: typeof parsed.at === "string" ? parsed.at : new Date().toISOString(),
      pulse_id: typeof parsed.pulse_id === "string" ? parsed.pulse_id : null,
      outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
      next_wake_at: typeof parsed.next_wake_at === "string" ? parsed.next_wake_at : null,
    };
  } catch {
    return null;
  }
}

/**
 * Reconciles last_pulse.json against the authoritative state projection.
 * If last_pulse.json disagrees with the chain state, the chain wins and last_pulse.json is rewritten.
 */
export function reconcileLastPulse(
  capsuleRoot: string,
  state: RunState,
): { reconciled: boolean; record: LastPulseRecord } {
  const pulse = (state.pulse ?? {}) as Record<string, unknown>;
  const last = (pulse.last ?? null) as Record<string, unknown> | null;

  const current = readLastPulse(capsuleRoot);

  const expected: LastPulseRecord = {
    at:
      last && typeof last.closed_at === "string"
        ? last.closed_at
        : last && typeof last.armed_at === "string"
          ? last.armed_at
          : (current?.at ?? new Date().toISOString()),
    pulse_id: last && typeof last.pulse_id === "string" ? last.pulse_id : null,
    outcome: last && typeof last.outcome === "string" ? last.outcome : null,
    next_wake_at: last && typeof last.next_wake_at === "string" ? last.next_wake_at : null,
  };

  const matches =
    current !== null &&
    current.at === expected.at &&
    current.pulse_id === expected.pulse_id &&
    current.outcome === expected.outcome &&
    current.next_wake_at === expected.next_wake_at;

  if (!matches) {
    writeLastPulse(capsuleRoot, expected);
    return { reconciled: true, record: expected };
  }

  return { reconciled: false, record: current };
}
