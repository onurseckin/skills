import type { BranchRecord } from "../../contracts/branch.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { transact } from "../../store/index.ts";
import { newLeaseToken, tokenDigest, tokenMatches } from "../lease/token.ts";
import { isLeaseSuspended } from "../lease/suspension.ts";
import { readBranchLedger, requireBranch, requireSubTask, writeBranchLedger } from "./ledger.ts";
import type { BranchOutcome } from "./open.ts";

const MIN_LEASE = 5;
const MAX_LEASE = 86_400;

export interface ClaimSubTaskInput {
  runRoot: string;
  branchId: string;
  subTaskId: string;
  agentId: string;
  actor: string;
  leaseSeconds: number;
  now?: Date;
}

export interface SubTaskOutcome extends BranchOutcome {
  token: string;
}

export interface SubmitSubTaskInput {
  runRoot: string;
  branchId: string;
  subTaskId: string;
  agentId: string;
  token: string;
  actor: string;
  summary: string;
  now?: Date;
}

function assertCollectable(branch: BranchRecord): void {
  if (branch.status !== "open") {
    throw new HarnessError("INVALID_STATE", `branch ${branch.id} is ${branch.status}, not open`);
  }
}

export function claimSubTask(input: ClaimSubTaskInput): SubTaskOutcome {
  if (
    !Number.isSafeInteger(input.leaseSeconds) ||
    input.leaseSeconds < MIN_LEASE ||
    input.leaseSeconds > MAX_LEASE
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "lease_seconds must be an integer from 5 to 86400");
  }
  const now = input.now ?? new Date();
  const token = newLeaseToken();
  let ledgerAfter: BranchRecord[] = [];
  let claimed: BranchRecord | undefined;
  const state = transact(
    input.runRoot,
    input.actor,
    "branch-claimed",
    {
      branch_id: input.branchId,
      sub_task_id: input.subTaskId,
      agent_id: input.agentId,
      claimed_at: now.toISOString(),
    },
    (draft) => {
      const ledger = readBranchLedger(draft);
      const branch = requireBranch(ledger, input.branchId);
      assertCollectable(branch);
      const subTask = requireSubTask(branch, input.subTaskId);
      if (subTask.status !== "open") {
        throw new HarnessError(
          "INVALID_STATE",
          `sub-task ${subTask.id} is ${subTask.status} and cannot be claimed`,
        );
      }
      subTask.status = "claimed";
      subTask.agent_id = input.agentId;
      subTask.claimed_at = now.toISOString();
      subTask.lease = {
        agent_id: input.agentId,
        token_digest: tokenDigest(token),
        issued_at: now.toISOString(),
        expires_at: new Date(now.valueOf() + input.leaseSeconds * 1_000).toISOString(),
        duration_seconds: input.leaseSeconds,
      };
      claimed = branch;
      ledgerAfter = [...ledger];
      writeBranchLedger(draft, ledgerAfter);
    },
  );
  if (!claimed) throw new HarnessError("INVALID_STATE", "sub-task was not claimed");
  return { branch: claimed, ledger: ledgerAfter, state, token };
}

export function submitSubTask(input: SubmitSubTaskInput): BranchOutcome {
  const now = input.now ?? new Date();
  let ledgerAfter: BranchRecord[] = [];
  let submitted: BranchRecord | undefined;
  const state = transact(
    input.runRoot,
    input.actor,
    "branch-submitted",
    {
      branch_id: input.branchId,
      sub_task_id: input.subTaskId,
      agent_id: input.agentId,
      summary: input.summary,
      submitted_at: now.toISOString(),
    },
    (draft) => {
      const ledger = readBranchLedger(draft);
      const branch = requireBranch(ledger, input.branchId);
      assertCollectable(branch);
      const subTask = requireSubTask(branch, input.subTaskId);
      const lease = subTask.lease;
      if (subTask.status !== "claimed" || !lease) {
        throw new HarnessError(
          "INVALID_STATE",
          `sub-task ${subTask.id} is ${subTask.status} and holds no submittable lease`,
        );
      }
      if (lease.agent_id !== input.agentId || !tokenMatches(input.token, lease.token_digest)) {
        throw new HarnessError("INVALID_STATE", "lease identity or token is invalid");
      }
      if (!isLeaseSuspended(lease) && Date.parse(lease.expires_at) <= now.valueOf()) {
        throw new HarnessError("INVALID_STATE", "lease has expired");
      }
      subTask.status = "submitted";
      subTask.submitted_at = now.toISOString();
      subTask.summary = input.summary;
      delete subTask.lease;
      submitted = branch;
      ledgerAfter = [...ledger];
      writeBranchLedger(draft, ledgerAfter);
    },
  );
  if (!submitted) throw new HarnessError("INVALID_STATE", "sub-task was not submitted");
  return { branch: submitted, ledger: ledgerAfter, state };
}
