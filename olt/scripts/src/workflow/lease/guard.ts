import type { Clock, WorkflowState } from "../types.ts";
import { systemClock } from "../types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { tokenMatches } from "./token.ts";
import { loadRun } from "../../engine/store/index.ts";

export interface LeaseGuardOptions {
  readonly clock?: Clock;
  readonly allowExpired?: boolean;
}

export interface LeaseGuardResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly taskId: string;
  readonly agentId?: string;
  readonly expiresAt?: string;
}

export function checkActiveLease(
  state: Readonly<WorkflowState>,
  taskId: string,
  agentId?: string,
  token?: string,
  options: LeaseGuardOptions = {},
): LeaseGuardResult {
  const task = state.tasks[taskId];
  if (!task) {
    return {
      valid: false,
      reason: `LEASE_REQUIRED: task ${taskId} not found in capsule state`,
      taskId,
    };
  }
  if (!task.lease) {
    return {
      valid: false,
      reason: `LEASE_REQUIRED: task ${taskId} has no active lease in capsule state`,
      taskId,
    };
  }
  if (agentId !== undefined && task.lease.agent_id !== agentId) {
    return {
      valid: false,
      reason: `LEASE_REQUIRED: task ${taskId} lease held by ${task.lease.agent_id}, not ${agentId}`,
      taskId,
      agentId: task.lease.agent_id,
      expiresAt: task.lease.expires_at,
    };
  }
  if (token !== undefined && !tokenMatches(token, task.lease.token_digest)) {
    return {
      valid: false,
      reason: `LEASE_REQUIRED: task ${taskId} lease token mismatch`,
      taskId,
      agentId: task.lease.agent_id,
      expiresAt: task.lease.expires_at,
    };
  }
  if (options.allowExpired !== true) {
    const clock = options.clock !== undefined ? options.clock : systemClock;
    const now = clock.now().toISOString();
    if (task.lease.expires_at <= now) {
      return {
        valid: false,
        reason: `LEASE_REQUIRED: task ${taskId} lease expired at ${task.lease.expires_at}`,
        taskId,
        agentId: task.lease.agent_id,
        expiresAt: task.lease.expires_at,
      };
    }
  }
  return {
    valid: true,
    taskId,
    agentId: task.lease.agent_id,
    expiresAt: task.lease.expires_at,
  };
}

export function assertActiveLease(
  state: Readonly<WorkflowState>,
  taskId: string,
  agentId?: string,
  token?: string,
  options: LeaseGuardOptions = {},
): void {
  const result = checkActiveLease(state, taskId, agentId, token, options);
  if (!result.valid) {
    throw new HarnessError(
      "INVALID_STATE",
      result.reason !== undefined ? result.reason : "LEASE_REQUIRED",
    );
  }
}

export function verifyLeaseGuard(
  runOrState: string | Readonly<WorkflowState>,
  taskId: string,
  agentId?: string,
  token?: string,
  options: LeaseGuardOptions = {},
): LeaseGuardResult {
  const state =
    typeof runOrState === "string"
      ? (loadRun(runOrState).state as unknown as Readonly<WorkflowState>)
      : runOrState;
  return checkActiveLease(state, taskId, agentId, token, options);
}
