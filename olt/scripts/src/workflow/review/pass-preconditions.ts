import type { CommandRecord, CommandStatus } from "../../contracts/commands.ts";
import { isEvidenced } from "../../contracts/evidence.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { latestGateProof, type GateProofRecord } from "../../graph/gate-proof.ts";
import { normalizeScopePath } from "../../graph/scope-analyzer.ts";
import { applicableGates, commandArgv } from "../gates/gate-policy.ts";
import type { TaskRecord, WorkflowState } from "../types.ts";

export interface FailingGateRun {
  gate_id: string;
  command_id: string;
  status: CommandStatus;
  exit_code: number | null;
}

function isFailedRun(command: CommandRecord): boolean {
  if (command.status === "failed" || command.status === "timed_out") return true;
  return command.exit_code !== null && command.exit_code !== 0;
}

function latestRun(commands: CommandRecord[]): CommandRecord | undefined {
  return commands.reduce<CommandRecord | undefined>((latest, command) => {
    if (!latest) return command;
    return Date.parse(command.started_at) >= Date.parse(latest.started_at) ? command : latest;
  }, undefined);
}

export interface GateRunEvidence {
  gate_id: string;
  run?: FailingGateRun | undefined;
}

export function gateRunEvidence(state: WorkflowState, task: TaskRecord): GateRunEvidence[] {
  const commands = Object.values(state.commands ?? {});
  return applicableGates(state, task).map((gate) => {
    const latest = latestRun(
      commands.filter((command) => command.task_id === task.id && command.gate_id === gate.id),
    );
    if (!latest) return { gate_id: gate.id };
    return {
      gate_id: gate.id,
      run: {
        gate_id: gate.id,
        command_id: latest.id,
        status: latest.status,
        exit_code: latest.exit_code,
      },
    };
  });
}

export function failingGateRuns(state: WorkflowState, task: TaskRecord): FailingGateRun[] {
  const commands = Object.values(state.commands ?? {});
  const failing: FailingGateRun[] = [];
  for (const gate of applicableGates(state, task)) {
    const runs = commands.filter(
      (command) => command.task_id === task.id && command.gate_id === gate.id,
    );
    const latest = latestRun(runs);
    if (latest && isFailedRun(latest)) {
      failing.push({
        gate_id: gate.id,
        command_id: latest.id,
        status: latest.status,
        exit_code: latest.exit_code,
      });
    }
  }
  return failing;
}

export function assertGatesNotFailing(state: WorkflowState, task: TaskRecord): void {
  const failing = failingGateRuns(state, task);
  if (failing.length === 0) return;
  const detail = failing
    .map((run) => `${run.gate_id} (${run.command_id} exited ${run.exit_code ?? run.status})`)
    .join(", ");
  throw new HarnessError(
    "INVALID_STATE",
    `cannot pass ${task.id}: mandatory gate evidence records a failure: ${detail}`,
  );
}

export function probeRoundsRecorded(task: TaskRecord): number {
  return typeof task.probe_round === "number" ? task.probe_round : 0;
}

export function assertProbeSatisfied(task: TaskRecord, minProbes: number): void {
  const recorded = probeRoundsRecorded(task);
  if (recorded >= minProbes) return;
  throw new HarnessError(
    "INVALID_STATE",
    `cannot pass ${task.id}: ${recorded} adversarial probe(s) recorded, ${minProbes} required; run task:probe first`,
  );
}

export function claimedBaseSha(task: TaskRecord): string | undefined {
  const attempt = task.attempts.at(-1);
  const sha = attempt?.claimed_base_sha;
  return isEvidenced(sha, (candidate): candidate is string => typeof candidate === "string")
    ? sha.value
    : undefined;
}

function sameWriteScope(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].map(normalizeScopePath).sort();
  const right = [...b].map(normalizeScopePath).sort();
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

export interface GateFalsifiabilityStatus {
  gate_id: string;
  gate_argv: string[];
  proven: boolean;
  proof?: GateProofRecord;
}

export function gateFalsifiabilityStatuses(
  state: WorkflowState,
  task: TaskRecord,
): GateFalsifiabilityStatus[] {
  const expectedBase = claimedBaseSha(task);
  return applicableGates(state, task).map((gate) => {
    const argv = commandArgv(gate.command);
    const proof = latestGateProof(state, task.id, argv);
    const proven =
      proof !== undefined &&
      sameWriteScope(proof.write_scope, task.write_scope) &&
      (expectedBase === undefined || proof.base === expectedBase);
    return { gate_id: gate.id, gate_argv: argv, proven, ...(proof ? { proof } : {}) };
  });
}

export function assertGateProofFalsifiable(state: WorkflowState, task: TaskRecord): void {
  if (task.no_op !== undefined) return;
  const unproven = gateFalsifiabilityStatuses(state, task).filter((status) => !status.proven);
  if (unproven.length === 0) return;
  const detail = unproven
    .map((status) => `${status.gate_id} (\`${status.gate_argv.join(" ")}\`)`)
    .join(", ");
  throw new HarnessError(
    "INVALID_STATE",
    `cannot pass ${task.id}: no recorded falsifiable gate:prove proof for ${detail}; run ` +
      `\`gate:prove --run <run> --task ${task.id} --actor <actor>\` and record a falsifiable ` +
      `proof against this attempt's claimed base before this review can pass`,
  );
}
