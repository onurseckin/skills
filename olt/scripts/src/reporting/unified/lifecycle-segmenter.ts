/**
 * Lifecycle Segmentation & Agent Matrix Processor for Unified Run Reports
 */
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  TIER_NAMES,
  type ExecutionTier,
} from "../../authority/thread-identifier.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { extractLeaseAgentId } from "../lease-agent-extractor.ts";
import type { UnifiedAgentRow } from "./types.ts";

export interface LifecycleSegResult {
  readonly implementersActive: Array<{
    taskId: string;
    agentId: string;
    role: string;
    attempt: number;
    expiresAt: string;
  }>;
  readonly validatorsActive: Array<{
    taskId: string;
    validatorId: string;
    domain: string;
    deadlineAt: string;
  }>;
  readonly submittedTaskIds: string[];
  readonly standbyTaskIds: string[];
  readonly blockedTaskIds: string[];
  readonly satisfiedTaskIds: string[];
  readonly repairTaskIds: string[];
}

export function segmentTaskLifecycle(tasks: readonly TaskRecord[]): LifecycleSegResult {
  const implementersActive: Array<{
    taskId: string;
    agentId: string;
    role: string;
    attempt: number;
    expiresAt: string;
  }> = [];
  const validatorsActive: Array<{
    taskId: string;
    validatorId: string;
    domain: string;
    deadlineAt: string;
  }> = [];
  const submittedTaskIds: string[] = [];
  const standbyTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const satisfiedTaskIds: string[] = [];
  const repairTaskIds: string[] = [];

  for (const t of tasks) {
    if (t.status === "done") {
      satisfiedTaskIds.push(t.id);
    } else if (t.status === "submitted") {
      submittedTaskIds.push(t.id);
    } else if (t.status === "changes_requested") {
      repairTaskIds.push(t.id);
      if (t.lease) {
        implementersActive.push({
          taskId: t.id,
          agentId: extractLeaseAgentId(t.lease) || "unknown",
          role:
            typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "repairer",
          attempt: typeof t.lease.attempt === "number" ? t.lease.attempt : 1,
          expiresAt: typeof t.lease.expires_at === "string" ? t.lease.expires_at : "",
        });
      }
    } else if (t.status === "validating") {
      if (Array.isArray(t.validations)) {
        for (const v of t.validations) {
          if (v.verdict === undefined) {
            validatorsActive.push({
              taskId: t.id,
              validatorId: v.validator_id,
              domain: v.domain,
              deadlineAt: v.deadline_at,
            });
          }
        }
      }
    } else if (t.status === "leased" || t.status === "running") {
      if (t.lease) {
        implementersActive.push({
          taskId: t.id,
          agentId: extractLeaseAgentId(t.lease) || "unknown",
          role:
            typeof t.lease.role === "string" && t.lease.role.length > 0
              ? t.lease.role
              : "implementer",
          attempt: typeof t.lease.attempt === "number" ? t.lease.attempt : 1,
          expiresAt: typeof t.lease.expires_at === "string" ? t.lease.expires_at : "",
        });
      }
    } else if (t.status === "ready") {
      standbyTaskIds.push(t.id);
    } else if (t.status === "proposed") {
      blockedTaskIds.push(t.id);
    }
  }

  return {
    implementersActive,
    validatorsActive,
    submittedTaskIds,
    standbyTaskIds,
    blockedTaskIds,
    satisfiedTaskIds,
    repairTaskIds,
  };
}

export function buildAgentMatrixRows(
  rawAgents: readonly Record<string, unknown>[],
  tasks: readonly TaskRecord[],
  implementersActive: readonly {
    taskId: string;
    agentId: string;
    role: string;
    attempt: number;
    expiresAt: string;
  }[],
  validatorsActive: readonly {
    taskId: string;
    validatorId: string;
    domain: string;
    deadlineAt: string;
  }[],
): UnifiedAgentRow[] {
  const agentRows: UnifiedAgentRow[] = [];

  for (const a of rawAgents) {
    if (isRecord(a) && typeof a.id === "string") {
      const agentId = a.id;
      const role = typeof a.role === "string" ? a.role : (agentIdToRole(agentId) ?? "unknown");
      const tier = (
        typeof a.tier === "number" ? a.tier : (agentIdToTier(agentId) ?? roleToTier(role))
      ) as ExecutionTier;
      const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`;
      const status = typeof a.status === "string" ? a.status : "active";

      let leasedTaskId: string | null = null;
      let attemptNum: number | null = null;
      let expAt: string | null = null;
      let issAt: string | null = null;

      for (const t of tasks) {
        if (t.lease && extractLeaseAgentId(t.lease) === agentId) {
          leasedTaskId = t.id;
          attemptNum = typeof t.lease.attempt === "number" ? t.lease.attempt : 1;
          expAt = typeof t.lease.expires_at === "string" ? t.lease.expires_at : null;
          issAt = typeof t.lease.issued_at === "string" ? t.lease.issued_at : null;
          break;
        }
      }

      agentRows.push({
        agentId,
        tier,
        tierName,
        role,
        status,
        taskId: leasedTaskId,
        attempt: attemptNum,
        issuedAt: issAt ?? undefined,
        expiresAt: expAt ?? undefined,
      });
    }
  }

  for (const imp of implementersActive) {
    if (!agentRows.some((r) => r.agentId === imp.agentId)) {
      const tier = (agentIdToTier(imp.agentId) ?? roleToTier(imp.role)) as ExecutionTier;
      agentRows.push({
        agentId: imp.agentId,
        tier,
        tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
        role: imp.role,
        status: "active",
        taskId: imp.taskId,
        attempt: imp.attempt,
        expiresAt: imp.expiresAt || undefined,
      });
    }
  }

  for (const val of validatorsActive) {
    if (!agentRows.some((r) => r.agentId === val.validatorId)) {
      const tier = 3 as ExecutionTier;
      agentRows.push({
        agentId: val.validatorId,
        tier,
        tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
        role: "validator",
        status: "active",
        taskId: val.taskId,
        attempt: 1,
        expiresAt: val.deadlineAt || undefined,
      });
    }
  }

  agentRows.sort((a, b) => a.tier - b.tier || a.agentId.localeCompare(b.agentId));
  return agentRows;
}
