import { HarnessError } from "../../errors/harness-error.ts";
import { requireText } from "../task-state.ts";
import type {
  CompletionArtifactPacket,
  CompletionArtifactVerification,
  WorkflowState,
} from "../types.ts";
import { mandatoryRunGateCommands } from "./completion-state.ts";
import { jsonDigest } from "./completion-review-digest.ts";
import {
  currentRepositoryBinding,
  repositoryBindingIsValid,
  sameRepositoryBinding,
  validateRepositoryBinding,
} from "./repository-binding.ts";
import type { RepositoryBinding } from "../../contracts/repository.ts";
import { TRUSTED_HOST_ASSURANCE } from "../../contracts/trusted-host.ts";

export interface CompletionArtifactRequirements {
  command_ids: string[];
  packets: CompletionArtifactPacket[];
  repository_binding: RepositoryBinding;
}

export function completionArtifactRequirements(
  state: WorkflowState,
): CompletionArtifactRequirements {
  const commands = new Set<string>();
  for (const task of Object.values(state.tasks)) {
    for (const validation of task.validations ?? [])
      for (const check of validation.checks ?? []) commands.add(check.command_id);
    for (const result of task.gate_results ?? []) commands.add(result.command_id);
  }
  for (const review of state.completion_reviews ??
    (state.completion_review ? [state.completion_review] : [])) {
    for (const id of review.repository_command_ids) commands.add(id);
    for (const check of review.checks) commands.add(check.command_id);
  }
  for (const remediation of state.completion_remediations ?? [])
    for (const resolution of remediation.resolutions)
      for (const id of resolution.command_ids) commands.add(id);
  for (const id of Object.values(mandatoryRunGateCommands(state))) commands.add(id);
  const packets = Object.values(state.packets ?? {})
    .map(({ id, packet_sha256 }) => ({ id, packet_sha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    command_ids: [...commands].sort(),
    packets,
    repository_binding: validateRepositoryBinding(
      state.completion_review?.repository_binding ?? currentRepositoryBinding(state),
      "expected artifact repository binding",
    ),
  };
}

function packetList(value: unknown): CompletionArtifactPacket[] {
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "artifact packets must be an array");
  const packets = value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", "artifact packet must be an object");
    const packet = raw as Record<string, unknown>;
    return {
      id: requireText(packet.id, "artifact packet id"),
      packet_sha256: requireText(packet.packet_sha256, "artifact packet sha256"),
    };
  });
  if (new Set(packets.map(({ id }) => id)).size !== packets.length)
    throw new HarnessError("INVALID_ARGUMENT", "artifact packets must be duplicate-free");
  return packets.sort((left, right) => left.id.localeCompare(right.id));
}

export function validateCompletionArtifactVerification(
  state: WorkflowState,
  value: unknown,
): CompletionArtifactVerification {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "completion artifact verification must be an object",
    );
  const input = value as Record<string, unknown>;
  const verifiedAt = requireText(input.verified_at, "verified_at");
  if (!Number.isFinite(Date.parse(verifiedAt)))
    throw new HarnessError("INVALID_ARGUMENT", "verified_at must be an ISO timestamp");
  if (
    !Array.isArray(input.command_ids) ||
    input.command_ids.some((id) => typeof id !== "string" || id.trim() === "") ||
    new Set(input.command_ids).size !== input.command_ids.length
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "artifact command_ids must be duplicate-free strings",
    );
  const actual = {
    command_ids: [...(input.command_ids as string[])].sort(),
    packets: packetList(input.packets),
    repository_binding: validateRepositoryBinding(
      input.repository_binding,
      "artifact repository binding",
    ),
  };
  const expected = completionArtifactRequirements(state);
  if (!sameRepositoryBinding(actual.repository_binding, expected.repository_binding))
    throw new HarnessError("INVALID_STATE", "repository bytes changed after completion review");
  if (
    JSON.stringify(actual.command_ids) !== JSON.stringify(expected.command_ids) ||
    JSON.stringify(actual.packets) !== JSON.stringify(expected.packets)
  )
    throw new HarnessError(
      "INVALID_STATE",
      "artifact verification does not cover exact requirements",
    );
  const gateCommandIds = new Set(
    Object.values(state.tasks).flatMap((task) =>
      (task.gate_results ?? []).map(({ command_id }) => command_id),
    ),
  );
  for (const id of Object.values(mandatoryRunGateCommands(state))) gateCommandIds.add(id);
  for (const id of gateCommandIds) {
    const command = state.commands[id];
    if (command?.assurance !== TRUSTED_HOST_ASSURANCE || command.repository_after == null)
      throw new HarnessError(
        "INVALID_STATE",
        `gate command ${id} lacks terminal trusted-host assurance`,
      );
    if (
      !repositoryBindingIsValid(command.repository_after) ||
      ((command.task_id === null || gateCommandIds.size === 1) &&
        !sameRepositoryBinding(command.repository_after, actual.repository_binding))
    )
      throw new HarnessError(
        "INVALID_STATE",
        `gate command ${id} repository_after does not match live completion binding`,
      );
  }
  const base = { verified_at: verifiedAt, ...actual };
  return { ...base, verification_sha256: jsonDigest(base) };
}
