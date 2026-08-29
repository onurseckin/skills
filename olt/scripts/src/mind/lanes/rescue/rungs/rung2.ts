import { basename, resolve } from "node:path";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { loadRun, transact } from "../../../../engine/store/index.ts";
import { workflowPort } from "../../../../integration/store-ports.ts";
import { readAgentLedger } from "../../../../workflow/agents/ledger.ts";
import { isAttemptOpen } from "../../../../workflow/lease/attempt-state.ts";
import { abandonAttempt } from "../../../../workflow/lease/abandon.ts";
import { readWorktreeLedger } from "../../../../workflow/worktree/ledger.ts";
import { reclaimOrphanedWorktrees, recordReclaim } from "../../../../workflow/worktree/reclaim.ts";
import { getHarnessConfig } from "../../../../core/config/index.ts";
import type { Clock, TaskRecord, WorkflowState } from "../../../../workflow/types.ts";
import type { Rung2Result } from "../types.ts";

export function executeRung2(params: {
  readonly liveRunRoots: readonly string[];
  readonly actor: string;
  readonly nowMs: number;
  readonly nowIso: string;
  readonly clock: Clock;
  readonly actionsTaken: string[];
  readonly escalations: string[];
}): Rung2Result {
  const { liveRunRoots, actor, nowMs, nowIso, clock, actionsTaken, escalations } = params;

  const abandonedAttempts: { runId: string; taskId: string; agentId?: string }[] = [];
  const orphanEvidenceEscalated: { runId: string; evidenceCount: number }[] = [];
  const worktreesReclaimed: { runId: string; worktreeIds: readonly string[] }[] = [];

  for (const runPath of liveRunRoots) {
    const runId = basename(runPath);
    try {
      const loadedRun = loadRun(runPath, false);
      const state = loadedRun.state as unknown as WorkflowState;
      const agents = readAgentLedger(state);

      // 1. Open attempts whose agent is gone
      const tasks = Object.values(state.tasks ?? {});
      for (const task of tasks) {
        const taskRecord = task as TaskRecord;
        const attempts = taskRecord.attempts ?? [];
        const lastAttempt = attempts.at(-1);
        if (lastAttempt && isAttemptOpen(lastAttempt)) {
          const rawAgentId = lastAttempt.agent_id ?? taskRecord.lease?.agent_id;
          const attemptAgentId = typeof rawAgentId === "string" ? rawAgentId : undefined;
          const agentGrant = agents.find((a) => a.id === attemptAgentId);
          const isAgentGone =
            !agentGrant ||
            agentGrant.status === "released" ||
            (taskRecord.lease === undefined && attemptAgentId !== undefined);

          if (isAgentGone) {
            abandonAttempt(
              workflowPort(runPath),
              taskRecord.id,
              actor,
              `agent ${attemptAgentId ?? "unknown"} gone or unresponsive`,
              clock,
            );
            abandonedAttempts.push({
              runId,
              taskId: taskRecord.id,
              ...(attemptAgentId !== undefined ? { agentId: attemptAgentId } : {}),
            });
            actionsTaken.push(
              `Rung 2: abandoned attempt on task ${taskRecord.id} in ${runId} (agent ${attemptAgentId ?? "unknown"} gone)`,
            );
          }
        }
      }

      // 2. Orphan evidence escalation
      const orphanEv = (state.orphan_evidence ?? []) as readonly Record<string, unknown>[];
      if (orphanEv.length > 0) {
        orphanEvidenceEscalated.push({
          runId,
          evidenceCount: orphanEv.length,
        });
        const reason = `orphan evidence (${orphanEv.length} items) in run ${runId} needs coordinator disposal`;
        escalations.push(reason);
        actionsTaken.push(`Rung 2: escalated orphan evidence in ${runId}`);

        transact(
          runPath,
          actor,
          "orphan-evidence-escalated",
          {
            run_id: runId,
            orphan_count: orphanEv.length,
            reason,
          },
          (draft) => {
            const workingState = draft as unknown as WorkflowState;
            const currentEscalations = Array.isArray(workingState.escalations)
              ? [...workingState.escalations]
              : [];
            currentEscalations.push({
              id: `esc-orphan-${nowMs}`,
              reason: "orphan_evidence_needs_disposal",
              detail: reason,
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            workingState.escalations = currentEscalations as unknown as JsonObject[];
          },
        );
      }

      // 3. Abandoned worktree reclaim
      const wtLedger = readWorktreeLedger(state);
      if (wtLedger) {
        const runRepoRoot = resolve(runPath, "..", "..");
        const harnessConfig = getHarnessConfig(runRepoRoot, runPath);
        if (harnessConfig.worktree_isolation) {
          const outcome = reclaimOrphanedWorktrees({
            repoRoot: runRepoRoot,
            ledger: wtLedger,
          });
          const completionResult = state.completion_result;
          const sealed =
            typeof completionResult === "object" &&
            completionResult !== null &&
            !Array.isArray(completionResult) &&
            completionResult.status === "complete";

          if (outcome.reclaimed_worktree_ids.length > 0) {
            if (!sealed) {
              recordReclaim(runPath, actor, outcome);
            }
            worktreesReclaimed.push({
              runId,
              worktreeIds: outcome.reclaimed_worktree_ids,
            });
            actionsTaken.push(
              `Rung 2: reclaimed ${outcome.reclaimed_worktree_ids.length} abandoned worktree(s) in ${runId}`,
            );
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    abandonedAttempts,
    orphanEvidenceEscalated,
    worktreesReclaimed,
  };
}
