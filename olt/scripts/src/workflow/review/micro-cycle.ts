import { HarnessError } from "../../core/errors/index.ts";
import type { MicroCycleRecord } from "../../core/contracts/index.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import {
  systemClock,
  type Clock,
  type TaskRecord,
  type TransactionPort,
  type WorkflowState,
} from "../types.ts";

export const DEFAULT_MAX_MICRO_CYCLES = 3;
export const DEFAULT_REPAIR_LEASE_SECONDS = 1_200;

export interface RecordMicroCycleOptions {
  remediation?: string;
  defect?: string;
  maxRounds?: number;
  leaseSeconds?: number;
  clock?: Clock;
}

export interface MicroCycleCritiqueResult extends WorkflowState {
  repairToken?: string;
}

export function getOpenMicroCycles(task: TaskRecord): MicroCycleRecord[] {
  const raw = task.micro_cycles as MicroCycleRecord[] | undefined;
  const records = raw === undefined ? [] : raw;
  return records.filter((rec) => rec.status === "open");
}

export function getLatestMicroCycle(task: TaskRecord): MicroCycleRecord | undefined {
  const raw = task.micro_cycles as MicroCycleRecord[] | undefined;
  const records = raw === undefined ? [] : raw;
  return records.at(-1);
}

export function recordMicroCycleCritique(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  critique: string,
  options?: RecordMicroCycleOptions,
): MicroCycleCritiqueResult {
  validatorId = requireText(validatorId, "validator_id");
  critique = requireText(critique, "critique");
  const clock = options?.clock === undefined ? systemClock : options.clock;
  const now = clock.now();
  const maxRounds = options?.maxRounds === undefined ? DEFAULT_MAX_MICRO_CYCLES : options.maxRounds;
  const leaseSeconds =
    options?.leaseSeconds === undefined ? DEFAULT_REPAIR_LEASE_SECONDS : options.leaseSeconds;
  let mintedRepairToken: string | undefined;

  const currentState = port.read();
  const currentTask = taskIn(currentState, taskId);
  if (!["leased", "validating", "submitted"].includes(currentTask.status)) {
    throw new HarnessError(
      "INVALID_STATE",
      `task ${taskId} is in status ${currentTask.status}, cannot record micro-cycle critique; must be leased, validating, or submitted`,
    );
  }

  const currentRound =
    typeof currentTask.micro_cycle_round === "number" ? currentTask.micro_cycle_round : 0;
  const nextRound = currentRound + 1;
  if (nextRound > maxRounds) {
    throw new HarnessError(
      "INVALID_STATE",
      `MAX_MICRO_CYCLES_EXCEEDED: task ${taskId} exceeded maximum micro-cycle rounds (${maxRounds})`,
    );
  }

  const state = port.transact(
    validatorId,
    "micro-cycle-critique-recorded",
    { task_id: taskId, round: nextRound, validator_id: validatorId },
    (draft) => {
      const task = taskIn(draft, taskId);
      if (!["leased", "validating", "submitted"].includes(task.status)) {
        throw new HarnessError(
          "INVALID_STATE",
          `task ${taskId} changed status to ${task.status} during transaction; cannot record micro-cycle critique`,
        );
      }

      const activeRound = typeof task.micro_cycle_round === "number" ? task.micro_cycle_round : 0;
      const computedRound = activeRound + 1;
      if (computedRound > maxRounds) {
        throw new HarnessError(
          "INVALID_STATE",
          `MAX_MICRO_CYCLES_EXCEEDED: task ${taskId} reached maximum micro-cycle rounds (${maxRounds})`,
        );
      }

      const record: MicroCycleRecord = {
        round: computedRound,
        validator_id: validatorId,
        critique: critique.trim(),
        ...(options?.remediation ? { suggested_remediation: options.remediation.trim() } : {}),
        ...(options?.defect ? { observed_defect: options.defect.trim() } : {}),
        created_at: utc(now),
        status: "open",
      };

      const rawCycles = task.micro_cycles as MicroCycleRecord[] | undefined;
      const existingCycles = rawCycles === undefined ? [] : rawCycles;
      const updatedCycles = [...existingCycles, record];
      task.micro_cycles = updatedCycles;
      task.micro_cycle_round = computedRound;

      if (task.lease) {
        task.lease.micro_cycles = updatedCycles;
        task.lease.micro_cycle_round = computedRound;
      } else {
        const repairAgentId = task.original_implementer;
        if (typeof repairAgentId !== "string") {
          throw new HarnessError(
            "INVALID_STATE",
            `task ${taskId} has no original_implementer to attribute a repair lease to; cannot re-open an in-lease repair attempt`,
          );
        }
        if (repairAgentId.trim().length === 0) {
          throw new HarnessError(
            "INVALID_STATE",
            `task ${taskId} has a blank original_implementer; cannot re-open an in-lease repair attempt`,
          );
        }
        const lastAttempt = task.attempts.at(-1);
        const priorRole =
          lastAttempt !== undefined &&
          typeof lastAttempt.role === "string" &&
          lastAttempt.role.trim().length > 0
            ? lastAttempt.role
            : "implementer";
        const attemptNumber = task.attempts.length + 1;
        const token = newLeaseToken();
        mintedRepairToken = token;

        task.attempts.push({
          attempt: attemptNumber,
          agent_id: repairAgentId,
          role: priorRole,
          started_at: utc(now),
          kind: "repair",
        });

        const rawResourceScope = task.resource_scope;
        const resourceScope = rawResourceScope === undefined ? [] : [...rawResourceScope];

        task.lease = {
          agent_id: repairAgentId,
          role: priorRole,
          attempt: attemptNumber,
          token_digest: tokenDigest(token),
          issued_at: utc(now),
          heartbeat_at: utc(now),
          expires_at: utc(new Date(now.valueOf() + leaseSeconds * 1_000)),
          duration_seconds: leaseSeconds,
          write_scope: [...task.write_scope],
          resource_scope: resourceScope,
          micro_cycles: updatedCycles,
          micro_cycle_round: computedRound,
        };
      }

      if (task.status !== "leased") {
        transition(
          task,
          "leased",
          validatorId,
          now,
          `micro-cycle round ${computedRound} feedback: ${critique.trim()}`,
        );
      }
    },
  );

  return mintedRepairToken === undefined ? state : { ...state, repairToken: mintedRepairToken };
}

export function markMicroCycleAddressed(
  port: TransactionPort,
  taskId: string,
  agentId = "system",
  clock: Clock = systemClock,
): WorkflowState {
  agentId = requireText(agentId, "agent_id");
  const now = clock.now();

  return port.transact(
    agentId,
    "micro-cycle-addressed",
    { task_id: taskId, addressed_at: utc(now) },
    (draft) => {
      const task = taskIn(draft, taskId);
      const cycles = task.micro_cycles as MicroCycleRecord[] | undefined;
      if (cycles && Array.isArray(cycles)) {
        for (const mc of cycles) {
          if (mc.status === "open") {
            mc.status = "addressed";
          }
        }
      }
      const leaseCycles = task.lease?.micro_cycles;
      if (leaseCycles && Array.isArray(leaseCycles)) {
        for (const mc of leaseCycles) {
          if (mc.status === "open") {
            mc.status = "addressed";
          }
        }
      }
    },
  );
}

export function formatMicroCycleFeedback(
  taskId: string,
  record: MicroCycleRecord,
  maxRounds: number = DEFAULT_MAX_MICRO_CYCLES,
  repairToken?: string,
): string {
  const lines: string[] = [
    `### 🔄 Micro-Cycle Feedback (Round ${record.round}/${maxRounds})`,
    "",
    `- **Task**: \`${taskId}\``,
    `- **Validator**: \`${record.validator_id}\``,
    `- **Status**: \`${record.status}\``,
  ];

  if (record.observed_defect) {
    lines.push(`- **Observed Defect**: ${record.observed_defect}`);
  }

  lines.push("", "#### 📋 Critique & Issues Identified", record.critique);

  if (record.suggested_remediation) {
    lines.push("", "#### 💡 Suggested Remediation", record.suggested_remediation);
  }

  if (repairToken !== undefined) {
    lines.push(
      "",
      "#### 🔑 Repair Lease Token",
      `\`${repairToken}\``,
      "> This token was minted because the task had no active lease to re-open for repair. It is the only credential that can act on this task now (task:submit, task:review, task:release) and it is shown here once — it is not persisted anywhere, so copy it now.",
    );
  }

  lines.push(
    "",
    "> [!IMPORTANT]",
    "> **Action Required**: Address the feedback above in-place without releasing your lease. Run file-scoped tests to verify your fix, and re-submit.",
  );

  return lines.join("\n");
}
