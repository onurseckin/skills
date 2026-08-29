import type { CommandRecord } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { requireSubstantiveObjects } from "../workflow/evidence.ts";
import { requireText } from "../workflow/task-state.ts";
import { authoritativeRepositoryCommand } from "../workflow/completion/repository-evidence.ts";
import type { PacketInput } from "./types.ts";
import { isolateCriticContext } from "./validator-context.ts";
import { completionReadinessSnapshot } from "../workflow/completion/readiness-snapshot.ts";
import { sameRepositoryBinding } from "../workflow/completion/repository-binding.ts";
import {
  repositoryBindingFromInspection,
  type RepositoryInspection,
} from "./repository-inspection.ts";

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be an object`);
  }
  if (Object.keys(value).length === 0)
    throw new HarnessError("INVALID_ARGUMENT", `${field} must not be empty`);
  return structuredClone(value) as JsonObject;
}

function history(value: unknown): JsonObject[] {
  return requireSubstantiveObjects(value, "plan_history");
}

function repositoryCommands(input: PacketInput): {
  command_ids: string[];
  commands: CommandRecord[];
} {
  const evidence = object(input.authoritativeContext.repository_evidence, "repository_evidence");
  const raw = evidence.command_ids;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((id) => typeof id !== "string" || id.trim() === "") ||
    new Set(raw).size !== raw.length
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "repository_evidence.command_ids must be nonempty and duplicate-free",
    );
  }
  const commandIds = raw as string[];
  const commands = commandIds.map((id) => authoritativeRepositoryCommand(input.state, id));
  if (commands.some((command) => !command)) {
    throw new HarnessError("INVALID_STATE", "repository evidence is not authoritative");
  }
  return { command_ids: [...commandIds], commands: commands as CommandRecord[] };
}

export function criticContext(input: PacketInput): JsonObject {
  const prompt = requireText(input.authoritativeContext.original_prompt, "original_prompt");
  const integrity = requireSubstantiveObjects(
    input.authoritativeContext.integrity_evidence,
    "integrity_evidence",
  );
  const authorization = input.state.completion_critic;
  if (!authorization)
    throw new HarnessError("INVALID_STATE", "completion critic authorization is missing");
  const readiness = completionReadinessSnapshot(
    input.state,
    authorization.attempt,
    authorization.critic_id,
  );
  if (readiness.sha256 !== authorization.readiness_sha256)
    throw new HarnessError(
      "INVALID_STATE",
      "completion readiness changed before packet publication",
    );
  const currentInspection = input.authoritativeContext
    .current_repository_state as RepositoryInspection;
  if (
    !sameRepositoryBinding(
      repositoryBindingFromInspection(currentInspection),
      authorization.repository_binding,
    )
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      "repository bytes changed before critic packet publication",
    );
  }
  const context: JsonObject = {
    original_prompt: prompt,
    graph: object(input.authoritativeContext.graph, "graph"),
    plan_history: history(input.authoritativeContext.plan_history),
    integrity_evidence: integrity,
    repository_evidence: repositoryCommands(input),
    repository_state: object(
      input.authoritativeContext.current_repository_state,
      "current_repository_state",
    ),
    completion_readiness: structuredClone(readiness) as unknown as JsonObject,
    requirements: structuredClone(input.state.requirements),
    tasks: structuredClone(input.state.tasks),
    gates: structuredClone(input.state.gates),
    commands: structuredClone(input.state.commands),
    orphan_evidence: structuredClone(input.state.orphan_evidence),
    ...(input.state.completion_review
      ? { completion_review: structuredClone(input.state.completion_review) }
      : {}),
    ...(input.state.completion_result
      ? { completion_result: structuredClone(input.state.completion_result) }
      : {}),
  };
  return isolateCriticContext(context);
}
