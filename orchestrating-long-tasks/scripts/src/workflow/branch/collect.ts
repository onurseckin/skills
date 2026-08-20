import { isSubTaskTerminal, type BranchRecord } from "../../contracts/branch.ts";
import { evidenced } from "../../contracts/evidence.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { readBranchLedger, requireBranch, writeBranchLedger } from "./ledger.ts";
import type { BranchOutcome } from "./open.ts";
import {
  assertParentBranched,
  assertParentLease,
  resolveBranchParent,
  resumeParent,
} from "./parent.ts";
import {
  observedFilesChanged,
  observeRepository,
  type BranchObservationDependencies,
} from "./repository-observation.ts";

export interface CollectBranchInput {
  runRoot: string;
  repoRoot: string;
  branchId: string;
  agentId: string;
  token: string;
  actor: string;
  summary: string;
  now?: Date;
  observation?: BranchObservationDependencies;
}

export interface AbandonBranchInput {
  runRoot: string;
  branchId: string;
  agentId: string;
  token: string;
  actor: string;
  reason: string;
  now?: Date;
}

function assertOpen(branch: BranchRecord): void {
  if (branch.status !== "open") {
    throw new HarnessError("INVALID_STATE", `branch ${branch.id} is ${branch.status}, not open`);
  }
}

function assertParentAgent(branch: BranchRecord, agentId: string): void {
  if (branch.parent_agent_id !== agentId) {
    throw new HarnessError(
      "INVALID_STATE",
      `branch ${branch.id} belongs to ${branch.parent_agent_id}, not ${agentId}`,
    );
  }
}

export function collectBranch(input: CollectBranchInput): BranchOutcome {
  const now = input.now ?? new Date();
  const observed = observeRepository(input.repoRoot, now, input.observation ?? {});
  let collected: BranchRecord | undefined;
  let ledgerAfter: BranchRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "branch-collected",
    {
      branch_id: input.branchId,
      parent_agent_id: input.agentId,
      summary: input.summary,
      collected_at: now.toISOString(),
    },
    (draft) => {
      const ledger = readBranchLedger(draft);
      const branch = requireBranch(ledger, input.branchId);
      assertOpen(branch);
      assertParentAgent(branch, input.agentId);
      const pending = branch.sub_tasks.filter((subTask) => !isSubTaskTerminal(subTask));
      if (pending.length > 0) {
        throw new HarnessError(
          "INVALID_STATE",
          `branch ${branch.id} still has non-terminal sub-tasks: ${pending
            .map((subTask) => `${subTask.id} (${subTask.status})`)
            .join(", ")}`,
        );
      }
      const parent = resolveBranchParent(draft, ledger, branch.parent_task_id);
      assertParentBranched(parent);
      assertParentLease(parent, input.agentId, input.token, now);
      // Absent when the harness could not read the repository: an unmeasured branch records no
      // file list at all rather than an empty one that reads as "nothing changed".
      const files = branch.opened_observation
        ? observedFilesChanged(
            branch.opened_observation,
            observed,
            input.observation ?? {},
            input.repoRoot,
          )
        : null;
      branch.status = "collected";
      branch.collected_at = now.toISOString();
      branch.outcome_summary = input.summary;
      branch.collected_observation = observed;
      if (files !== null) branch.files_changed = evidenced(files, "harness_observed");
      resumeParent(parent, input.actor, now, `collected ${branch.id}`);
      collected = branch;
      ledgerAfter = [...ledger];
      writeBranchLedger(draft, ledgerAfter);
    },
  );
  if (!collected) throw new HarnessError("INVALID_STATE", "branch was not collected");
  return { branch: collected, ledger: ledgerAfter, state };
}

export function abandonBranch(input: AbandonBranchInput): BranchOutcome {
  const now = input.now ?? new Date();
  let abandoned: BranchRecord | undefined;
  let ledgerAfter: BranchRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "branch-abandoned",
    {
      branch_id: input.branchId,
      parent_agent_id: input.agentId,
      reason: input.reason,
      abandoned_at: now.toISOString(),
    },
    (draft) => {
      const ledger = readBranchLedger(draft);
      const branch = requireBranch(ledger, input.branchId);
      assertOpen(branch);
      assertParentAgent(branch, input.agentId);
      const parent = resolveBranchParent(draft, ledger, branch.parent_task_id);
      assertParentBranched(parent);
      assertParentLease(parent, input.agentId, input.token, now);
      for (const subTask of branch.sub_tasks) {
        if (subTask.status === "branched") {
          throw new HarnessError(
            "INVALID_STATE",
            `sub-task ${subTask.id} has an open branch of its own; collect or abandon it first`,
          );
        }
        if (isSubTaskTerminal(subTask)) continue;
        subTask.status = "abandoned";
        subTask.abandoned_at = now.toISOString();
        delete subTask.lease;
      }
      branch.status = "abandoned";
      branch.abandoned_at = now.toISOString();
      branch.outcome_summary = input.reason;
      resumeParent(parent, input.actor, now, `abandoned ${branch.id}`);
      abandoned = branch;
      ledgerAfter = [...ledger];
      writeBranchLedger(draft, ledgerAfter);
    },
  );
  if (!abandoned) throw new HarnessError("INVALID_STATE", "branch was not abandoned");
  return { branch: abandoned, ledger: ledgerAfter, state };
}
