import type { BranchSubTask } from "../core/contracts/branch.ts";
import { canonicalJsonBytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { readBranchLedger, locateSubTask } from "../workflow/branch/ledger.ts";
import { tokenMatches } from "../workflow/lease/token.ts";
import { requireText } from "../workflow/task-state.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { systemClock } from "../workflow/types.ts";
import type { PacketInput } from "./types.ts";
import { assertCriticIndependent } from "../workflow/completion/critic-identity.ts";
import { assertActiveCriticDeadline } from "./authorization-deadline.ts";
import { sameRepositoryBinding } from "../workflow/completion/repository-binding.ts";

function sameTask(left: TaskRecord, right: TaskRecord): boolean {
  return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right)));
}

function sameSubTask(left: BranchSubTask, right: BranchSubTask): boolean {
  return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right)));
}

const BRANCH_ROLES: readonly string[] = ["sub-implementer", "sub-investigator", "sub-validator"];

export type PacketAuthenticationInput = Pick<
  PacketInput,
  "agentId" | "attempt" | "clock" | "leaseToken" | "role" | "state" | "subTask" | "task"
>;

function authenticateSubTask(input: PacketAuthenticationInput, now: number): void {
  const supplied = input.subTask;
  const location = supplied ? locateSubTask(readBranchLedger(input.state), supplied.id) : undefined;
  const lease = location?.subTask.lease;
  if (
    !supplied ||
    !location ||
    location.branch.status !== "open" ||
    location.subTask.status !== "claimed" ||
    !sameSubTask(supplied, location.subTask) ||
    !lease ||
    lease.agent_id !== input.agentId ||
    Date.parse(lease.expires_at) <= now ||
    !tokenMatches(input.leaseToken, lease.token_digest)
  ) {
    throw new HarnessError("INVALID_STATE", "branch sub-task packet authentication is invalid");
  }
}

export function authenticatePacketIdentity(
  input: PacketAuthenticationInput,
): TaskRecord | undefined {
  requireText(input.agentId, "agent_id");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new HarnessError("INVALID_ARGUMENT", "packet attempt must be a positive integer");
  }
  const taskRole = ["implementer", "repairer", "validator"].includes(input.role);
  const now = (input.clock ?? systemClock).now().valueOf();
  if (!taskRole) {
    if (input.task)
      throw new HarnessError("INVALID_ARGUMENT", "run-level packet cannot include a task");
    if (BRANCH_ROLES.includes(input.role)) {
      authenticateSubTask(input, now);
      return undefined;
    }
    if (input.subTask)
      throw new HarnessError("INVALID_ARGUMENT", "run-level packet cannot include a sub-task");
    if (input.role === "completeness-critic") {
      const critic = input.state.completion_critic;
      assertCriticIndependent(input.state, input.agentId);
      if (critic) assertActiveCriticDeadline(critic.deadline_at, now);
      if (
        !critic ||
        critic.critic_id !== input.agentId ||
        critic.attempt !== input.attempt ||
        typeof critic.readiness_sha256 !== "string" ||
        critic.readiness_sha256 === "" ||
        !["assigned", "packet_published"].includes(critic.status) ||
        !tokenMatches(input.leaseToken, critic.token_digest)
      )
        throw new HarnessError("INVALID_STATE", "completeness critic authentication is invalid");
      if (!sameRepositoryBinding(input.state.current_repository_binding, critic.repository_binding))
        throw new HarnessError(
          "INVALID_STATE",
          "repository bytes changed before critic packet publication",
        );
    }
    return undefined;
  }
  if (input.subTask)
    throw new HarnessError("INVALID_ARGUMENT", "a plan-task packet cannot include a sub-task");
  const supplied = input.task;
  const authoritative = supplied ? input.state.tasks[supplied.id] : undefined;
  if (!supplied || !authoritative || !sameTask(supplied, authoritative)) {
    throw new HarnessError("INVALID_STATE", "packet task is not the authoritative task state");
  }
  if (input.role === "validator") {
    const validation = (authoritative.validations ?? []).find(
      (entry) => entry.validator_id === input.agentId && entry.attempt === input.attempt,
    );
    if (
      authoritative.status !== "validating" ||
      !validation ||
      Date.parse(validation.deadline_at) <= now ||
      !tokenMatches(input.leaseToken, validation.token_digest)
    ) {
      throw new HarnessError("INVALID_STATE", "validator packet authentication is invalid");
    }
    return authoritative;
  }
  const lease = authoritative.lease;
  if (
    !["leased", "running"].includes(authoritative.status) ||
    !lease ||
    lease.agent_id !== input.agentId ||
    lease.role !== input.role ||
    lease.attempt !== input.attempt ||
    Date.parse(lease.expires_at) <= now ||
    !tokenMatches(input.leaseToken, lease.token_digest)
  ) {
    throw new HarnessError("INVALID_STATE", "task packet lease authentication is invalid");
  }
  return authoritative;
}

export function authenticatePacket(input: PacketInput): TaskRecord | undefined {
  return authenticatePacketIdentity(input);
}
