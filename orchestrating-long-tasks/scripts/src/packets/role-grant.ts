import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { RunState } from "../contracts/capsule.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { AgentRole } from "../contracts/packets.ts";
import { canonicalJsonBytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { locateSubTask, readBranchLedger } from "../workflow/branch/ledger.ts";
import type { TransactionPort, WorkflowState } from "../workflow/types.ts";
import { evidenceSchema } from "./evidence-schema.ts";
import type { PublishedPacket } from "./persist-packet.ts";
import { publishRolePacket } from "./publish-role-packet.ts";
import {
  recordRepositoryInspection,
  repositoryInspectionContext,
} from "./repository-inspection.ts";
import {
  loadRoleContract,
  loadValidatorDomainContract,
  type RoleContract,
  type ValidatorDomain,
} from "./role-contract.ts";
import type { BuiltPacket, PacketInput } from "./types.ts";
import { validationRoundContext, VALIDATION_ROUND_KEY } from "./validation-round.ts";

const HARNESS_SCRIPT = fileURLToPath(new URL("../../harness.ts", import.meta.url));

export interface RoleGrant {
  runRoot: string;
  port: TransactionPort;
  role: AgentRole;
  agentId: string;
  token: string;
  validatorDomain?: ValidatorDomain;
}

export interface TaskRoleGrant extends RoleGrant {
  taskId: string;
  attempt: number;
}

export interface SubTaskRoleGrant extends RoleGrant {
  subTaskId: string;
}

interface GrantBinding {
  attempt: number;
  binding: JsonObject;
  bound: Pick<PacketInput, "subTask" | "task">;
}

export type PublishedRolePacket = PublishedPacket & { packet: BuiltPacket };

export function grantedInvocations(contract: RoleContract): string[][] {
  return contract.commands.map((command) => ["bun", HARNESS_SCRIPT, command]);
}

export function grantPacketId(role: AgentRole, binding: JsonObject): string {
  const digest = createHash("sha256")
    .update(canonicalJsonBytes({ role, ...binding }))
    .digest("hex");
  return `${role}-${digest.slice(0, 16)}`;
}

export function recordGrantInspections(runRoot: string, actor: string): void {
  recordRepositoryInspection(runRoot, actor, "baseline");
  recordRepositoryInspection(runRoot, actor, "current");
}

export function grantContext(
  runRoot: string,
  graphRevision: number,
): { runId: string; context: JsonObject; runState: RunState } {
  const loaded = loadRun(runRoot);
  return {
    runId: loaded.manifest.run_id,
    runState: loaded.state,
    context: {
      original_prompt: new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt),
      capture_manifest: structuredClone(loaded.manifest),
      ...repositoryInspectionContext(loaded.state, true),
      expected_revision: graphRevision,
    },
  };
}

async function publish(
  grant: RoleGrant,
  bind: (state: WorkflowState) => GrantBinding,
): Promise<PublishedRolePacket> {
  const contract =
    grant.role === "validator" && grant.validatorDomain
      ? loadValidatorDomainContract(grant.validatorDomain)
      : loadRoleContract(grant.role);
  recordGrantInspections(grant.runRoot, grant.agentId);
  const state = grant.port.read();
  const graphRevision = state.graph_revision ?? 0;
  const { runId, context, runState } = grantContext(grant.runRoot, graphRevision);
  const { attempt, binding: boundBinding, bound } = bind(state);
  const binding = grant.validatorDomain
    ? { ...boundBinding, validator_domain: grant.validatorDomain }
    : boundBinding;
  const round =
    (grant.role === "validator" || grant.role === "mechanic-validator") && bound.task
      ? validationRoundContext({
          runRoot: grant.runRoot,
          runState,
          state,
          task: bound.task,
          context,
        })
      : undefined;
  return publishRolePacket(
    grant.runRoot,
    grantPacketId(grant.role, {
      agent_id: grant.agentId,
      attempt,
      ...binding,
    }),
    {
      runId,
      graphRevision,
      role: grant.role,
      agentId: grant.agentId,
      state,
      roleContract: contract,
      authoritativeContext: round ? { ...context, [VALIDATION_ROUND_KEY]: round } : context,
      evidenceSchema: evidenceSchema(grant.role),
      targetedCommands: grantedInvocations(contract),
      leaseToken: grant.token,
      attempt,
      ...bound,
    },
    grant.port,
    { agentId: grant.agentId, token: grant.token, attempt },
  );
}

export async function publishTaskRolePacket(grant: TaskRoleGrant): Promise<PublishedRolePacket> {
  return publish(grant, (state) => {
    const task = state.tasks[grant.taskId];
    if (!task)
      throw new HarnessError(
        "INVALID_STATE",
        `packet grant names an unknown task: ${grant.taskId}`,
      );
    return { attempt: grant.attempt, binding: { task_id: grant.taskId }, bound: { task } };
  });
}

export async function publishSubTaskRolePacket(
  grant: SubTaskRoleGrant,
): Promise<PublishedRolePacket> {
  return publish(grant, (state) => {
    const location = locateSubTask(readBranchLedger(state), grant.subTaskId);
    if (!location)
      throw new HarnessError(
        "INVALID_STATE",
        `packet grant names an unknown sub-task: ${grant.subTaskId}`,
      );
    const attempt =
      Object.values(state.packets ?? {}).filter((packet) => packet.task_id === grant.subTaskId)
        .length + 1;
    return {
      attempt,
      binding: {
        sub_task_id: grant.subTaskId,
        claimed_at: location.subTask.claimed_at ?? null,
      },
      bound: { subTask: location.subTask },
    };
  });
}
