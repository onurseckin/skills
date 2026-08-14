import type { JsonObject } from "../../contracts/json.ts";
import { commandMatchesGate } from "../gates/gate-policy.ts";
import type { WorkflowState } from "../types.ts";
import { jsonDigest } from "./completion-review-digest.ts";
import { currentRepositoryBinding } from "./repository-binding.ts";
import type { RepositoryBinding } from "../../contracts/repository.ts";

function sortedValues<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

export interface CompletionReadinessSnapshot extends JsonObject {
  sha256: string;
  graph_revision: number | null;
  command_ids: string[];
  packet_ids: string[];
  prior_review_sha256s: string[];
  remediation_sha256s: string[];
  orphan_disposition_sha256s: string[];
  repository_binding: RepositoryBinding;
}

export function completionReadinessSnapshot(
  state: WorkflowState,
  attempt: number,
  activeCriticId: string,
): CompletionReadinessSnapshot {
  const commands = Object.values(state.commands)
    .filter((command) => command.actor !== activeCriticId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const packets = Object.values(state.packets ?? {})
    .filter((packet) => packet.role !== "completeness-critic")
    .sort((left, right) => left.id.localeCompare(right.id));
  const priorReviews = (state.completion_reviews ?? []).slice(0, Math.max(0, attempt - 1));
  const remediations = state.completion_remediations ?? [];
  const source = {
    repository_binding: currentRepositoryBinding(state),
    graph_revision: state.graph_revision ?? null,
    tasks: sortedValues(Object.values(state.tasks)),
    requirements: sortedValues(state.requirements),
    gates: sortedValues(state.gates),
    commands,
    packets,
    orphan_evidence: state.orphan_evidence,
    orphan_evidence_dispositions: state.orphan_evidence_dispositions ?? [],
    prior_review_sha256s: priorReviews.map(({ review_sha256 }) => review_sha256),
    remediation_sha256s: remediations.map(({ remediation_sha256 }) => remediation_sha256),
  };
  return {
    sha256: jsonDigest(source),
    graph_revision: source.graph_revision,
    command_ids: commands.map(({ id }) => id),
    packet_ids: packets.map(({ id }) => id),
    prior_review_sha256s: source.prior_review_sha256s,
    remediation_sha256s: source.remediation_sha256s,
    orphan_disposition_sha256s: source.orphan_evidence_dispositions.map(
      ({ disposition_sha256 }) => disposition_sha256,
    ),
    repository_binding: structuredClone(source.repository_binding),
  };
}

export function commandIsSuccessfulGate(
  state: WorkflowState,
  commandId: string | undefined,
  gateId: string,
  taskId: string | null,
): boolean {
  const command = commandId ? state.commands[commandId] : undefined;
  const gate = state.gates.find((entry) => entry.id === gateId);
  return Boolean(
    command &&
    gate &&
    command.status === "succeeded" &&
    command.exit_code === 0 &&
    command.task_id === taskId &&
    command.gate_id === gateId &&
    commandMatchesGate(command, gate),
  );
}
