import type { Clock } from "../../../workflow/types.ts";

export const DEFAULT_CONSECUTIVE_CRASH_THRESHOLD = 3;

export interface LastPulseRecord {
  readonly at: string;
  readonly pulse_id: string | null;
  readonly outcome: string | null;
  readonly next_wake_at: string | null;
}

export type LastPulsePayload = LastPulseRecord;

export interface PulseReclaimOptions {
  readonly actor?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly clock?: Clock | undefined;
  readonly graceSeconds?: number | undefined;
  readonly pulseId?: string | undefined;
  readonly expectedPulseId?: string | undefined;
  readonly deterministicCrashThreshold?: number | undefined;
}

export interface PulseReclaimResult {
  readonly reclaimed: boolean;
  readonly pulseId?: string | undefined;
  readonly consecutiveCrashes: number;
  readonly halted: boolean;
  readonly haltReason?: string | undefined;
  readonly deadlinePassedByMs?: number | undefined;
  readonly evidence?: string | undefined;
  readonly reason?: string | undefined;
  readonly outcome?: "crashed" | "completed" | undefined;
}
