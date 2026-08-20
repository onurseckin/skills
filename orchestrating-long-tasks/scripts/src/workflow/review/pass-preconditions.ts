import type { CommandRecord, CommandStatus } from "../../contracts/commands.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { applicableGates } from "../gates/gate-policy.ts";
import type { TaskRecord, WorkflowState } from "../types.ts";

export interface FailingGateRun {
  gate_id: string;
  command_id: string;
  status: CommandStatus;
  exit_code: number | null;
}

/**
 * A run that is still going has no verdict yet, so it is not evidence of a red gate. Only a settled
 * run counts against a sign-off.
 */
function isFailedRun(command: CommandRecord): boolean {
  if (command.status === "failed" || command.status === "timed_out") return true;
  return command.exit_code !== null && command.exit_code !== 0;
}

function latestRun(commands: CommandRecord[]): CommandRecord | undefined {
  // Later runs supersede earlier ones: a gate that failed and was then fixed and re-run is green.
  return commands.reduce<CommandRecord | undefined>((latest, command) => {
    if (!latest) return command;
    return Date.parse(command.started_at) >= Date.parse(latest.started_at) ? command : latest;
  }, undefined);
}

export interface GateRunEvidence {
  gate_id: string;
  /** The latest recorded run of this gate, or undefined when the gate was never run. */
  run?: FailingGateRun | undefined;
}

/**
 * What the harness recorded for each gate the task must satisfy. A gate with no run is reported as
 * having none: an absent record is not a green one, and a reader of the brief must be able to tell
 * the two apart.
 */
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

/**
 * The gates the task must satisfy, judged by what the harness actually recorded rather than by what
 * the validator chose to cite. `run:exec` exits 0 even when the gate it ran exits non-zero, so
 * without this the run record is the only place the failure survives.
 */
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

/**
 * The adversarial probe is a precondition of sign-off, not a rejection: the validator must have
 * demanded proof at least `minProbes` times before a pass is credible.
 */
export function assertProbeSatisfied(task: TaskRecord, minProbes: number): void {
  const recorded = probeRoundsRecorded(task);
  if (recorded >= minProbes) return;
  throw new HarnessError(
    "INVALID_STATE",
    `cannot pass ${task.id}: ${recorded} adversarial probe(s) recorded, ${minProbes} required; run task:probe first`,
  );
}
