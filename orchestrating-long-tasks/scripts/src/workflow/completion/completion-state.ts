import type { CommandRecord } from "../../contracts/commands.ts";
import { embeddedCommandIssues } from "../../runner/command-shape.ts";
import { openBranchIssues } from "../branch/completion-blockers.ts";
import { applicableGates, commandMatchesGate } from "../gates/gate-policy.ts";
import { requirementExecutionState } from "../authority/index.ts";
import { orphanEvidenceIssues } from "../orphan-evidence/digest.ts";
import type {
  CompletionArtifactVerification,
  GateRuntime,
  RequirementRuntime,
  TaskRecord,
  WorkflowState,
} from "../types.ts";
import { jsonDigest } from "./completion-review-digest.ts";
import { completionHistoryIssues } from "./completion-history.ts";
import { completionReviewIssues } from "./review-issues.ts";
import { sameRepositoryBinding } from "./repository-binding.ts";

function successful(command: CommandRecord | undefined): command is CommandRecord {
  return Boolean(command?.status === "succeeded" && command.exit_code === 0);
}

export function mandatoryRunGateCommands(
  state: WorkflowState,
  issues: string[] = [],
): { [gateId: string]: string } {
  const result: { [gateId: string]: string } = {};
  const gates = (
    state.gates ??
    (state as unknown as { graph?: { gates?: typeof state.gates } }).graph?.gates ??
    []
  ).filter((gate) => gate.scope === "run" && gate.mandatory);
  if (gates.length === 0) issues.push("run has no mandatory run gate");
  for (const gate of gates) {
    const commands = Object.values(state.commands)
      .filter(
        (command) =>
          successful(command) &&
          command.task_id === null &&
          command.gate_id === gate.id &&
          commandMatchesGate(command, gate),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    if (commands.length === 0)
      issues.push(`run gate ${gate.id} lacks an authoritative passing command`);
    else result[gate.id] = commands[0]!.id;
  }
  return result;
}

function taskGatePassed(state: WorkflowState, task: TaskRecord, gate: GateRuntime): boolean {
  const result = (task.gate_results ?? []).find((candidate) => candidate.gate_id === gate.id);
  const command = result ? state.commands[result.command_id] : undefined;
  return Boolean(
    result?.status === "passed" &&
    successful(command) &&
    command.task_id === task.id &&
    command.gate_id === gate.id &&
    commandMatchesGate(command, gate),
  );
}

export interface GateTally {
  /** Gates the plan made mandatory: every applicable task gate plus every mandatory run gate. */
  total: number;
  /** Of those, the ones with an authoritative passing command bound to them. */
  green: number;
}

/**
 * Counts gates, and only gates. A brief that reports command exit codes or requirement totals under
 * a gate heading is reporting two numbers that are not gate counts.
 */
export function gateTally(state: WorkflowState): GateTally {
  let total = 0;
  let green = 0;
  for (const task of Object.values(state.tasks)) {
    for (const gate of applicableGates(state, task)) {
      total += 1;
      if (taskGatePassed(state, task, gate)) green += 1;
    }
  }
  const runGates = (
    state.gates ??
    (state as unknown as { graph?: { gates?: typeof state.gates } }).graph?.gates ??
    []
  ).filter((gate) => gate.scope === "run" && gate.mandatory);
  const proven = mandatoryRunGateCommands(state);
  for (const gate of runGates) {
    total += 1;
    if (proven[gate.id] !== undefined) green += 1;
  }
  return { total, green };
}

function validatorProofIssues(state: WorkflowState, task: TaskRecord): string[] {
  const validation = task.validation;
  if (validation?.verdict !== "pass")
    return [`task ${task.id} lacks independent validator approval`];
  if (!validation.checks?.length) return [`task ${task.id} lacks validator command evidence`];
  const gates = applicableGates(state, task);
  return validation.checks.flatMap(({ command_id: id }) => {
    const command = state.commands[id];
    return successful(command) &&
      command.task_id === task.id &&
      command.actor === validation.validator_id &&
      embeddedCommandIssues(command).length === 0 &&
      gates.some((gate) => commandMatchesGate(command, gate))
      ? []
      : [`task ${task.id} has invalid validator command ${id}`];
  });
}

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

export function completionIssues(
  state: WorkflowState,
  verification: CompletionArtifactVerification | undefined = state.completion_verification,
): string[] {
  const reqs = extractRequirements(state);
  const issues = completionReviewIssues(state, state.completion_review);
  issues.push(...completionHistoryIssues(state));
  const runCommands = mandatoryRunGateCommands(state, issues);
  for (const command of Object.values(state.commands))
    if (command.status === "running")
      issues.push(`running command blocks completion: ${command.id}`);
  for (const packet of Object.values(state.packets ?? {}))
    if (packet.status !== "published") issues.push(`packet ${packet.id} is not durably published`);
  if (!verification) issues.push("completion artifact verification is missing");
  else {
    const { verification_sha256: digest, ...base } = verification;
    if (digest !== jsonDigest(base))
      issues.push("completion artifact verification digest is invalid");
  }
  issues.push(...orphanEvidenceIssues(state));
  issues.push(...openBranchIssues(state));
  for (const task of Object.values(state.tasks).sort((a, b) => a.id.localeCompare(b.id))) {
    const disposed =
      task.requirement_ids.length > 0 &&
      task.requirement_ids.every((id) => {
        const requirement = reqs.find((entry) => entry.id === id);
        return requirement && requirementExecutionState(requirement) === "disposed";
      });
    if (disposed && task.status === "cancelled") continue;
    if (task.status !== "done") issues.push(`task ${task.id} is ${task.status}, not done`);
    if (task.lease) issues.push(`task ${task.id} has a live lease`);
    if (!task.report) issues.push(`task ${task.id} lacks a submission report`);
    issues.push(...validatorProofIssues(state, task));
    if (task.validation && !task.validation.verdict)
      issues.push(`task ${task.id} has an active validation`);
    for (const finding of task.findings ?? [])
      if (finding.status === "open") issues.push(`task ${task.id} has open finding ${finding.id}`);
    for (const gate of applicableGates(state, task))
      if (!taskGatePassed(state, task, gate))
        issues.push(`task ${task.id} lacks authoritative gate ${gate.id}`);
  }
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
  const result = state.completion_result;
  if (
    result &&
    (result.critic_review_sha256 !== state.completion_review?.review_sha256 ||
      result.readiness_sha256 !== state.completion_review?.readiness_sha256 ||
      !sameRepositoryBinding(
        result.repository_binding,
        state.completion_review?.repository_binding,
      ) ||
      result.artifact_verification_sha256 !== state.completion_verification?.verification_sha256 ||
      JSON.stringify(result.mandatory_run_gate_commands) !== JSON.stringify(runCommands))
  )
    issues.push("completion result provenance is stale");
  return issues;
}
