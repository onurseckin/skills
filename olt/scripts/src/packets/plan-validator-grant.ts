import type { JsonObject } from "../core/contracts/json.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { loadRun } from "../engine/store/index.ts";
import type { TransactionPort, WorkflowState } from "../workflow/types.ts";
import { evidenceSchema } from "./evidence-schema.ts";
import { publishRolePacket } from "./publish-role-packet.ts";
import {
  grantContext,
  grantedInvocations,
  grantPacketId,
  type PublishedRolePacket,
} from "./role-grant.ts";
import { loadRoleContract } from "./role-contract.ts";

export interface PlanValidatorRoleGrant {
  runRoot: string;
  port: TransactionPort;
  validatorId: string;
  token: string;
}

export async function publishPlanValidatorRolePacket(
  grant: PlanValidatorRoleGrant,
): Promise<PublishedRolePacket> {
  const contract = loadRoleContract("plan-validator");
  const state = grant.port.read();
  const assignment = state.plan_validation;
  if (!assignment || assignment.validator_id !== grant.validatorId)
    throw new HarnessError("INVALID_STATE", "plan validation authorization is missing");
  const loaded = loadRun(grant.runRoot);
  const graphRevision = state.graph_revision ?? 1;
  const { runId, context } = grantContext(grant.runRoot, graphRevision);
  const planContext: JsonObject = {
    ...context,
    graph: structuredClone(loaded.state.graph) as JsonObject,
    requirements: structuredClone(state.requirements),
    topology: structuredClone(state.topology ?? null),
    plan_digest: assignment.plan_digest,
    questions: {
      decomposition:
        "Does the decomposition match the work's entity count in the original prompt, or did it compress several distinct entities into one task?",
      dependency:
        "Is every dependency edge justified by a real read/write relationship between the tasks it connects?",
      gate: "Can each task's gate actually fail if that task does nothing — or would it pass on an untouched repository?",
      straggler: "Will any task's scope make one agent straggle while the rest of its wave idles?",
    },
  };
  return publishRolePacket(
    grant.runRoot,
    grantPacketId("plan-validator", {
      agent_id: grant.validatorId,
      attempt: assignment.attempt,
      graph_revision: graphRevision,
    }),
    {
      runId,
      graphRevision,
      role: "plan-validator",
      agentId: grant.validatorId,
      state: state as WorkflowState,
      roleContract: contract,
      authoritativeContext: planContext,
      evidenceSchema: evidenceSchema("plan-validator"),
      targetedCommands: grantedInvocations(contract),
      leaseToken: grant.token,
      attempt: assignment.attempt,
    },
    grant.port,
    { agentId: grant.validatorId, token: grant.token, attempt: assignment.attempt },
  );
}
