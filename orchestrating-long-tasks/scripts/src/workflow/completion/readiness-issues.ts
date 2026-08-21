import { applicableValidatorDomains } from "../../contracts/workflow.ts";
import { openBranchIssues } from "../branch/completion-blockers.ts";
import { applicableGates } from "../gates/gate-policy.ts";
import { commandMatchesGate } from "../gates/gate-policy.ts";
import { embeddedCommandIssues } from "../../runner/command-shape.ts";
import { requirementExecutionState } from "../authority/index.ts";
import { orphanEvidenceIssues } from "../orphan-evidence/digest.ts";
import type { RequirementRuntime, WorkflowState } from "../types.ts";
import { validationForDomain } from "../review/validation-state.ts";
import { authoritativeRepositoryCommand } from "./repository-evidence.ts";
import { commandIsSuccessfulGate } from "./readiness-snapshot.ts";
import { currentRepositoryBinding } from "./repository-binding.ts";

function extractRequirements(state: WorkflowState): readonly RequirementRuntime[] {
  const raw = state.requirements as unknown;
  if (Array.isArray(raw)) return raw;
  if (
    raw &&
    typeof raw === "object" &&
    "requirements" in raw &&
    Array.isArray((raw as { requirements: unknown }).requirements)
  ) {
    return (raw as { requirements: RequirementRuntime[] }).requirements;
  }
  return Object.values((raw ?? {}) as Record<string, RequirementRuntime>);
}

function taskIssues(state: WorkflowState): string[] {
  const reqs = extractRequirements(state);
  return Object.values(state.tasks).flatMap((task) => {
    const issues: string[] = [];
    const disposed =
      task.requirement_ids.length > 0 &&
      task.requirement_ids.every((id) => {
        const requirement = reqs.find((entry) => entry.id === id);
        return requirement && requirementExecutionState(requirement) === "disposed";
      });
    if (disposed && task.status === "cancelled") return issues;
    if (task.status !== "done") issues.push(`task ${task.id} is ${task.status}, not done`);
    if (task.lease) issues.push(`task ${task.id} has a live lease`);
    if (!task.report) issues.push(`task ${task.id} lacks a submission report`);
    const gates = applicableGates(state, task);
    for (const domain of applicableValidatorDomains(task.write_scope)) {
      const validation = validationForDomain(task, domain);
      if (validation?.verdict !== "pass")
        issues.push(`task ${task.id} lacks independent ${domain} validator approval`);
      if (!validation?.checks?.length)
        issues.push(`task ${task.id} lacks ${domain} validator command evidence`);
      for (const proof of validation?.checks ?? []) {
        const command = state.commands[proof.command_id];
        if (
          !command ||
          command.status !== "succeeded" ||
          command.exit_code !== 0 ||
          command.task_id !== task.id ||
          command.actor !== validation?.validator_id ||
          embeddedCommandIssues(command).length > 0 ||
          !gates.some((gate) => commandMatchesGate(command, gate))
        )
          issues.push(`task ${task.id} has invalid validator command ${proof.command_id}`);
      }
    }
    for (const finding of task.findings ?? [])
      if (finding.status === "open") issues.push(`task ${task.id} has open finding ${finding.id}`);
    for (const gate of applicableGates(state, task)) {
      const result = (task.gate_results ?? []).find((entry) => entry.gate_id === gate.id);
      if (!result || !commandIsSuccessfulGate(state, result.command_id, gate.id, task.id))
        issues.push(`task ${task.id} lacks authoritative gate ${gate.id}`);
    }
    return issues;
  });
}

export function completionReadinessIssues(state: WorkflowState): string[] {
  const issues = taskIssues(state);
  const reqs = extractRequirements(state);
  try {
    currentRepositoryBinding(state);
  } catch {
    issues.push("current repository binding is missing or invalid");
  }
  const graphRevision =
    state.graph_revision ??
    (state as unknown as { graph?: { revision?: number } }).graph?.revision ??
    state.revision;
  if (!Number.isSafeInteger(graphRevision) || Number(graphRevision) < 1)
    issues.push("graph revision is invalid");
  for (const command of Object.values(state.commands))
    if (command.status === "running")
      issues.push(`running command blocks completion: ${command.id}`);
  for (const packet of Object.values(state.packets ?? {}))
    if (packet.status !== "published") issues.push(`packet ${packet.id} is not durably published`);
  for (const requirement of reqs) {
    const execution = requirementExecutionState(requirement);
    if (execution === "disposed") continue;
    if (execution === "paused") {
      issues.push(`requirement ${requirement.id} still needs authority`);
      continue;
    }
    if (requirement.status !== "satisfied")
      issues.push(`requirement ${requirement.id} is not satisfied`);
    if (requirement.evidence.length === 0)
      issues.push(`requirement ${requirement.id} has no evidence`);
  }
  const runGates = (
    state.gates ??
    (state as unknown as { graph?: { gates?: typeof state.gates } }).graph?.gates ??
    []
  ).filter((gate) => gate.scope === "run" && gate.mandatory);
  if (runGates.length === 0) issues.push("run has no mandatory run gate");
  for (const gate of runGates) {
    const command = Object.values(state.commands).find(
      (entry) =>
        entry.task_id === null &&
        entry.gate_id === gate.id &&
        commandIsSuccessfulGate(state, entry.id, gate.id, null),
    );
    if (!command) issues.push(`run gate ${gate.id} lacks an authoritative passing command`);
  }
  issues.push(...orphanEvidenceIssues(state));
  issues.push(...openBranchIssues(state));
  for (const id of Object.values(state.commands)
    .filter((entry) => entry.task_id === null && entry.gate_id === null)
    .map(({ id }) => id))
    if (!authoritativeRepositoryCommand(state, id) && state.commands[id]?.status === "succeeded")
      issues.push(`repository command is not authoritative: ${id}`);
  return [...new Set(issues)].sort();
}
