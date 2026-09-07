import { HarnessError } from "../../core/errors/index.ts";
import { isValidAgentId } from "./mailbox-paths.ts";

export const DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS = 10_000;
export const DEFAULT_LISTENER_STALE_THRESHOLD_MS = 10_000;
export const DEFAULT_DELIVERY_TIMEOUT_MS = 30_000;

export type ListenerLivenessStatus =
  | "running_and_delivering"
  | "wedged"
  | "stopped"
  | "no_messages";

export type ListenerLivenessState = "RUNNING_AND_DELIVERING" | "WEDGED" | "STOPPED" | "NO_MESSAGES";

export interface ListenerHeartbeat {
  readonly actor: string;
  readonly pid: number;
  readonly timestamp: string;
  readonly last_delivered_timestamp: string | null;
  readonly lastDeliveredTimestamp?: string | null;
  readonly status?: string;
  readonly stopped_at?: string | null;
  readonly stoppedAt?: string | null;
  readonly reason?: string | null;
  readonly exit_code?: number | null;
  readonly exitCode?: number | null;
}

export interface RecordListenerHeartbeatOptions {
  readonly actor?: string;
  readonly pid?: number;
  readonly timestamp?: string;
  readonly lastDeliveredTimestamp?: string | null;
  readonly last_delivered_timestamp?: string | null;
  readonly status?: string;
  readonly runRoot?: string;
  readonly baseDir?: string;
}

export interface RecordListenerStoppedOptions {
  readonly actor?: string;
  readonly baseDir?: string;
  readonly runRoot?: string;
  readonly reason?: string | null;
  readonly exitCode?: number | null;
  readonly exit_code?: number | null;
  readonly stoppedAt?: string;
  readonly stopped_at?: string;
  readonly pid?: number;
}

export interface InspectListenerLivenessOptions {
  readonly actor?: string;
  readonly runRoot?: string;
  readonly baseDir?: string;
  readonly staleThresholdMs?: number;
  readonly deliveryThresholdMs?: number;
  readonly nowMs?: number;
  readonly heartbeat?: ListenerHeartbeat | null;
  readonly hasPendingMessages?: boolean;
  readonly unreadCount?: number;
}

export interface ListenerLivenessResult {
  readonly status: ListenerLivenessStatus;
  readonly state: ListenerLivenessState;
  readonly isRunning: boolean;
  readonly isDelivering: boolean;
  readonly isWedged: boolean;
  readonly isStopped: boolean;
  readonly hasNoMessages: boolean;
  readonly heartbeat: ListenerHeartbeat | null;
  readonly pid: number | null;
  readonly isProcessAlive: boolean;
  readonly heartbeatAgeMs: number | null;
  readonly lastDeliveredAgeMs: number | null;
  readonly reason: string;
}

export type LivenessTarget = string | InspectListenerLivenessOptions;
export type LivenessTargetOpt = InspectListenerLivenessOptions | string;

export function requireValidActor(actor: unknown): string {
  if (typeof actor !== "string" || actor.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "actor must be a non-empty string");
  }
  if (!isValidAgentId(actor)) throw new HarnessError("PATH_SAFETY", `Invalid actor '${actor}'`);
  return actor;
}

export function requireValidPid(pid: unknown): number {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", "pid must be a positive integer");
  }
  return pid;
}

export function parseIsoOrThrow(value: unknown, name: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HarnessError("INVALID_ARGUMENT", `Invalid ${name} '${String(value)}'`);
  }
  return value;
}

export function isValidListenerHeartbeat(value: unknown): value is ListenerHeartbeat {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const h = value as Record<string, unknown>;
  if (typeof h.actor !== "string" || h.actor.trim().length === 0) return false;
  if (typeof h.pid !== "number" || !Number.isInteger(h.pid) || h.pid <= 0) return false;
  if (typeof h.timestamp !== "string" || Number.isNaN(Date.parse(h.timestamp))) return false;
  const lastDelivered = h.last_delivered_timestamp ?? h.lastDeliveredTimestamp;
  if (lastDelivered !== null && lastDelivered !== undefined) {
    if (typeof lastDelivered !== "string" || Number.isNaN(Date.parse(lastDelivered))) return false;
  }
  const stoppedAt = h.stopped_at ?? h.stoppedAt;
  if (stoppedAt !== null && stoppedAt !== undefined) {
    if (typeof stoppedAt !== "string" || Number.isNaN(Date.parse(stoppedAt))) return false;
  }
  if (h.status !== undefined && typeof h.status !== "string") return false;
  if (h.reason !== null && h.reason !== undefined && typeof h.reason !== "string") return false;
  const code = h.exit_code ?? h.exitCode;
  return !(
    code !== null &&
    code !== undefined &&
    (typeof code !== "number" || !Number.isInteger(code))
  );
}
