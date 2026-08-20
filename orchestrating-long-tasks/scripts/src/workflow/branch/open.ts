import { randomUUID } from "node:crypto";
import type {
  BranchRecord,
  BranchRepositoryObservation,
  BranchSubTask,
} from "../../contracts/branch.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { isJsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { assertAgentBudget, readAgentLedger } from "../agents/ledger.ts";
import { locateSubTask, readBranchLedger, writeBranchLedger } from "./ledger.ts";
import {
  assertParentLease,
  assertParentWorking,
  resolveBranchParent,
  suspendParent,
} from "./parent.ts";
import { observeRepository, type BranchObservationDependencies } from "./repository-observation.ts";
import { assertSubScopes } from "./scope.ts";

export interface SubTaskInput {
  id: string;
  label: string;
  writeScope: readonly string[];
  gate?: string;
}

export interface OpenBranchInput {
  runRoot: string;
  repoRoot: string;
  parentTaskId: string;
  agentId: string;
  token: string;
  reason: string;
  subTasks: readonly SubTaskInput[];
  actor: string;
  maxDepth: number;
  maxAgents: number;
  now?: Date;
  observation?: BranchObservationDependencies;
}

export interface BranchOutcome {
  branch: BranchRecord;
  ledger: BranchRecord[];
  state: RunState;
}

function assertFreshIds(
  draft: RunState,
  ledger: readonly BranchRecord[],
  subTasks: readonly SubTaskInput[],
): void {
  const seen = new Set<string>();
  const tasks = isJsonObject(draft.tasks) ? draft.tasks : {};
  for (const subTask of subTasks) {
    if (seen.has(subTask.id)) {
      throw new HarnessError("INVALID_ARGUMENT", `duplicate sub-task id: ${subTask.id}`);
    }
    seen.add(subTask.id);
    if (Object.hasOwn(tasks, subTask.id)) {
      throw new HarnessError(
        "INVALID_STATE",
        `sub-task id ${subTask.id} collides with a plan task; a branch never enters the plan DAG`,
      );
    }
    if (locateSubTask(ledger, subTask.id)) {
      throw new HarnessError("INVALID_STATE", `sub-task id ${subTask.id} is already in use`);
    }
  }
}

function newSubTasks(subTasks: readonly SubTaskInput[]): BranchSubTask[] {
  return subTasks.map((subTask) => ({
    id: subTask.id,
    label: subTask.label,
    write_scope: [...subTask.writeScope],
    ...(subTask.gate === undefined ? {} : { gate: subTask.gate }),
    status: "open" as const,
  }));
}

export function openBranch(input: OpenBranchInput): BranchOutcome {
  if (input.subTasks.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "a branch needs at least one sub-task");
  }
  const now = input.now ?? new Date();
  const branchId = `B-${randomUUID()}`;
  // Measured outside the transaction: the baseline is a reading of the worktree, not durable state.
  const baseline: BranchRepositoryObservation = observeRepository(
    input.repoRoot,
    now,
    input.observation ?? {},
  );
  let opened: BranchRecord | undefined;
  let ledgerAfter: BranchRecord[] = [];
  const state = transact(
    input.runRoot,
    input.actor,
    "branch-opened",
    {
      branch_id: branchId,
      parent_task_id: input.parentTaskId,
      parent_agent_id: input.agentId,
      reason: input.reason,
      sub_task_ids: input.subTasks.map((subTask) => subTask.id),
      opened_at: now.toISOString(),
    },
    (draft) => {
      const ledger = readBranchLedger(draft);
      const parent = resolveBranchParent(draft, ledger, input.parentTaskId);
      assertParentWorking(parent);
      assertParentLease(parent, input.agentId, input.token, now);
      const depth = parent.depth + 1;
      // Not a structural bound — the proper-subset rule is what makes chains terminate. Crossing
      // this line means the work has been subdivided further than any plan should need, so it is
      // handed to the human instead of being retried at another depth.
      if (depth > input.maxDepth) {
        throw new HarnessError(
          "INVALID_STATE",
          `branch depth ${depth} trips the max_branch_depth escalation threshold of ${input.maxDepth}: subdividing ${input.parentTaskId} again means the original scoping was wrong, so escalate to the human rather than branching deeper`,
        );
      }
      // A branch is a promise to deploy one sub-agent per sub-task, so the whole branch is charged
      // against the run budget up front rather than failing halfway through dispatch.
      assertAgentBudget(readAgentLedger(draft), input.subTasks.length, input.maxAgents);
      assertFreshIds(draft, ledger, input.subTasks);
      assertSubScopes(
        parent.writeScope,
        input.subTasks.map((subTask) => ({ id: subTask.id, write_scope: subTask.writeScope })),
      );
      const branch: BranchRecord = {
        id: branchId,
        parent_task_id: input.parentTaskId,
        parent_agent_id: input.agentId,
        reason: input.reason,
        depth,
        sub_tasks: newSubTasks(input.subTasks),
        status: "open",
        opened_at: now.toISOString(),
        opened_observation: baseline,
      };
      suspendParent(parent, input.actor, now, `branched into ${branchId}`);
      opened = branch;
      ledgerAfter = [...ledger, branch];
      writeBranchLedger(draft, ledgerAfter);
    },
  );
  if (!opened) throw new HarnessError("INVALID_STATE", "branch was not opened");
  return { branch: opened, ledger: ledgerAfter, state };
}
