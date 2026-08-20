import type { RunFiles } from "../contracts/capsule.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { observeCapsuleIntegrity } from "../workflow/completion/integrity-evidence.ts";
import { authoritativeRepositoryCommand } from "../workflow/completion/repository-evidence.ts";
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

export interface CriticRoleGrant {
  runRoot: string;
  port: TransactionPort;
  criticId: string;
  token: string;
  /** --repository-command-ids on critic:start. Absent means auto-discover from run-gate commands. */
  repositoryCommandIds?: readonly string[];
}

/**
 * The run-level gate commands that stand as repository evidence: recorded against a run-scope gate
 * and still authoritative when the record is re-checked. Sorted, so the packet and the review that
 * answers it name the same evidence in the same order.
 */
export function repositoryEvidenceCommandIds(state: WorkflowState): string[] {
  const runGates = new Set(
    state.gates.filter((gate) => gate.scope === "run").map((gate) => gate.id),
  );
  return Object.values(state.commands)
    .filter(
      (command) =>
        command.gate_id !== null &&
        runGates.has(command.gate_id) &&
        authoritativeRepositoryCommand(state, command.id) !== undefined,
    )
    .map((command) => command.id)
    .sort();
}

function requiredRepositoryEvidence(
  state: WorkflowState,
  explicit?: readonly string[],
): string[] {
  const discovered = repositoryEvidenceCommandIds(state);
  if (discovered.length === 0)
    throw new HarnessError(
      "INVALID_STATE",
      "the critic packet needs at least one authoritative run gate command as repository evidence",
    );
  // Additive, never a replacement: the discovered run-gate commands stay in the set regardless, so
  // --repository-command-ids can only widen the critic's evidence, never narrow it below the
  // baseline readiness already required to reach critic:start. This is what lets a caller name a
  // bare inspection command (no gate at all) that auto-discovery, scoped to run-gate commands,
  // structurally cannot find on its own.
  if (explicit === undefined || explicit.length === 0) return discovered;
  const merged = new Set(discovered);
  for (const id of explicit) {
    if (!authoritativeRepositoryCommand(state, id))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--repository-command-ids names a command that is not authoritative repository evidence: ${id}`,
      );
    merged.add(id);
  }
  return [...merged].sort();
}

/**
 * Every plan this run has had: the bodies a replan superseded, then the one in force. `plan_history`
 * on its own records only superseded plans, so a run compiled once carries none, and the critic
 * would be handed an empty history for a run that certainly has a plan.
 */
function planHistory(loaded: RunFiles): JsonObject[] {
  const superseded = Array.isArray(loaded.state.plan_history)
    ? loaded.state.plan_history.filter(isJsonObject)
    : [];
  const graph = loaded.state.graph;
  if (!isJsonObject(graph))
    throw new HarnessError("INVALID_STATE", "the critic packet needs an applied plan");
  return structuredClone([
    ...superseded,
    {
      status: "in_force",
      graph_revision: graph.revision ?? null,
      recorded_state_revision: loaded.state.revision ?? null,
      requirements: loaded.state.requirements ?? null,
      graph,
    },
  ]);
}

/**
 * Hands the completeness critic its contract. The critic's packet is the only one that also carries
 * the readiness digest and repository binding it was assigned against, so a review recorded later
 * can be tied to the exact run state the critic was shown.
 */
export async function publishCriticRolePacket(
  grant: CriticRoleGrant,
): Promise<PublishedRolePacket> {
  const contract = loadRoleContract("completeness-critic");
  const state = grant.port.read();
  const authorization = state.completion_critic;
  if (!authorization)
    throw new HarnessError("INVALID_STATE", "completeness critic authorization is missing");
  const loaded = loadRun(grant.runRoot);
  const graphRevision = state.graph_revision ?? 0;
  const { runId, context } = grantContext(grant.runRoot, graphRevision);
  const criticContext: JsonObject = {
    ...context,
    graph: structuredClone(loaded.state.graph) as JsonObject,
    plan_history: planHistory(loaded),
    integrity_evidence: [observeCapsuleIntegrity(loaded.runRoot, loaded.state.event_head)],
    repository_evidence: {
      command_ids: requiredRepositoryEvidence(state, grant.repositoryCommandIds),
    },
  };
  return publishRolePacket(
    grant.runRoot,
    grantPacketId("completeness-critic", {
      agent_id: grant.criticId,
      attempt: authorization.attempt,
    }),
    {
      runId,
      graphRevision,
      role: "completeness-critic",
      agentId: grant.criticId,
      state,
      roleContract: contract,
      authoritativeContext: criticContext,
      evidenceSchema: evidenceSchema("completeness-critic"),
      targetedCommands: grantedInvocations(contract),
      leaseToken: grant.token,
      attempt: authorization.attempt,
    },
    grant.port,
    { agentId: grant.criticId, token: grant.token, attempt: authorization.attempt },
  );
}
