import { resolve } from "node:path";
import { identifyExecutionContext } from "../../authority/thread/index.ts";
import {
  inspectListenerLiveness,
  type ListenerHeartbeat,
  type ListenerLivenessResult,
  type ListenerLivenessState,
  type ListenerLivenessStatus,
} from "../../communication/mailbox/index.ts";

export interface MsgHealthContext {
  readonly authenticatedCaller?: {
    readonly actor: string;
    readonly role: string;
    readonly verified: boolean;
  };
}

export type MsgHealthFlagValue = string | boolean;
export type MsgHealthFlagValues = MsgHealthFlagValue | readonly MsgHealthFlagValue[];
export type MsgHealthFlags = Readonly<Record<string, MsgHealthFlagValues>>;

function readFlag(flags: MsgHealthFlags, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export interface MsgHealthResult {
  readonly markdown: string;
  readonly actor: string;
  readonly status: ListenerLivenessStatus;
  readonly state: ListenerLivenessState;
  readonly listener_state: ListenerLivenessStatus;
  readonly listenerState: ListenerLivenessStatus;
  readonly isRunning: boolean;
  readonly isDelivering: boolean;
  readonly isWedged: boolean;
  readonly isStopped: boolean;
  readonly hasNoMessages: boolean;
  readonly pid: number | null;
  readonly lastHeartbeat: string | null;
  readonly last_heartbeat: string | null;
  readonly lastDeliveryTimestamp: string | null;
  readonly last_delivery_timestamp: string | null;
  readonly lastDeliveredTimestamp: string | null;
  readonly isProcessAlive: boolean;
  readonly heartbeatAgeMs: number | null;
  readonly lastDeliveredAgeMs: number | null;
  readonly heartbeat: ListenerHeartbeat | null;
  readonly liveness: ListenerLivenessResult;
  readonly reason: string;
  readonly [key: string]: unknown;
}

export function msgHealthCommand(
  flags: MsgHealthFlags,
  context?: MsgHealthContext,
): MsgHealthResult {
  const actor = readFlag(flags, "actor");
  const baseDir = readFlag(flags, "base-dir");
  const effectiveBase = baseDir !== undefined ? resolve(baseDir) : process.cwd();

  let targetActor = actor;
  if (
    targetActor === undefined &&
    context !== undefined &&
    context.authenticatedCaller !== undefined &&
    Boolean(context.authenticatedCaller.actor)
  ) {
    targetActor = context.authenticatedCaller.actor;
  }
  if (targetActor === undefined) {
    const thread = identifyExecutionContext({ cwd: effectiveBase });
    targetActor =
      thread.agent_id !== undefined && thread.agent_id !== null ? thread.agent_id : "operator";
  }

  const liveness = inspectListenerLiveness(targetActor, {
    baseDir: effectiveBase,
  });

  const lastHeartbeat = liveness.heartbeat ? liveness.heartbeat.timestamp : null;
  const lastDeliveryTimestamp = liveness.heartbeat
    ? (liveness.heartbeat.last_delivered_timestamp ??
      liveness.heartbeat.lastDeliveredTimestamp ??
      null)
    : null;

  const lines: string[] = [
    "### Mailbox Listener Health (`msg:health`)",
    `- **Actor**: \`${targetActor}\``,
    `- **Status**: \`${liveness.status}\``,
    `- **State**: \`${liveness.state}\``,
    `- **PID**: \`${liveness.pid !== null ? String(liveness.pid) : "none"}\``,
    `- **Process Alive**: \`${String(liveness.isProcessAlive)}\``,
    `- **Last Heartbeat**: \`${lastHeartbeat ?? "none"}\``,
    `- **Last Delivery**: \`${lastDeliveryTimestamp ?? "none"}\``,
    `- **Reason**: ${liveness.reason}`,
  ];

  return {
    markdown: lines.join("\n"),
    actor: targetActor,
    status: liveness.status,
    state: liveness.state,
    listener_state: liveness.status,
    listenerState: liveness.status,
    isRunning: liveness.isRunning,
    isDelivering: liveness.isDelivering,
    isWedged: liveness.isWedged,
    isStopped: liveness.isStopped,
    hasNoMessages: liveness.hasNoMessages,
    pid: liveness.pid,
    lastHeartbeat,
    last_heartbeat: lastHeartbeat,
    lastDeliveryTimestamp,
    last_delivery_timestamp: lastDeliveryTimestamp,
    lastDeliveredTimestamp: lastDeliveryTimestamp,
    isProcessAlive: liveness.isProcessAlive,
    heartbeatAgeMs: liveness.heartbeatAgeMs,
    lastDeliveredAgeMs: liveness.lastDeliveredAgeMs,
    heartbeat: liveness.heartbeat,
    liveness,
    reason: liveness.reason,
  };
}
