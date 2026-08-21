import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlanBindings } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan-replan-bindings.ts";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

export const TASK_ID = "task-core";
export const VALIDATOR = "val-1";
export const CHANGED_FILE = "tests/unit/core/probe-target.ts";

/** A compiled single-task run whose one mandatory gate is `bun gate-core.ts`. */
export async function setupRun(
  name: string,
  roots: string[],
  config?: Record<string, number>,
): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-probe-${name}-`)));
  roots.push(repo);
  if (config) {
    await writeFile(join(repo, "harness.config.json"), JSON.stringify(config));
  }
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests");
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await writeFile(join(repo, CHANGED_FILE), "export const probed = true;\n");
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  await writeFile(join(repo, "gate-red.ts"), "process.exit(1);\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    TASK_ID,
    "--label",
    "Core Unit Tests",
    "--scope",
    "tests/unit/core",
    "--gate",
    "bun gate-core.ts",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return { repo, run };
}

/** Drives the task to `validating` and returns the task:validate-start result. */
export async function claimSubmitValidate(
  repo: string,
  run: string,
): Promise<Record<string, unknown>> {
  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    "worker-core",
    "--role",
    "implementer",
  ]);
  const workerCheck = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--actor",
    "worker-core",
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-core.ts",
  ]);
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim. setupRun already wrote CHANGED_FILE before the task was even claimed, so the implementer
  // has to actually change it here, not merely declare it.
  await writeFile(
    join(repo, CHANGED_FILE),
    "export const probed = true;\nexport const implemented = true;\n",
  );
  await execute([
    "task:submit",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    "worker-core",
    "--token",
    claim.token as string,
    "--files-changed",
    CHANGED_FILE,
    "--evidence",
    workerCheck.command_id as string,
    "--summary",
    "Implemented the task under test",
  ]);
  return execute([
    "task:validate-start",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
  ]);
}

/** Runs `script` as the validator; `gate` binds the record to the gate, `null` leaves it loose. */
export async function runGate(
  repo: string,
  run: string,
  script: string,
  gate: string | null = "gate-core",
): Promise<string> {
  const executed = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    ...(gate === null ? [] : ["--gate", gate]),
    "--actor",
    VALIDATOR,
    "--cwd",
    repo,
    "--",
    "bun",
    script,
  ]);
  return executed.command_id as string;
}

/** C3b: a passing review now requires a recorded falsifiable `gate:prove` proof for the task's
 *  compiled task-scope gate. These fixture repos are plain temp directories, not real Git
 *  repositories, so the real `gate:prove` CLI (which reverts a task's write scope against Git
 *  history to check the gate actually fails without the work) cannot run against them — seed the
 *  same `gate_proofs` record it would have appended instead. */
export function seedGateProof(run: string, taskId: string, actor = "coordinator"): void {
  const binding = readPlanBindings(loadRun(run).state).tasks.find((task) => task.id === taskId);
  if (!binding || binding.gate === undefined) {
    throw new Error(`seedGateProof: ${taskId} has no compiled task-scope gate to prove`);
  }
  const record: GateProofRecord = {
    task_id: taskId,
    gate_argv: [...binding.gate],
    write_scope: [...binding.writeScope],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: new Date().toISOString(),
    actor,
  };
  transact(run, actor, "gate-proved", { task_id: taskId }, (draft) =>
    appendGateProof(draft, record),
  );
}

export async function recordProbe(
  run: string,
  token: string,
  ...demands: string[]
): Promise<Record<string, unknown>> {
  return execute([
    "task:probe",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    ...demands.flatMap((demand) => ["--demand", demand]),
  ]);
}

export function reviewPass(
  run: string,
  token: string,
  evidence: string,
  answers: readonly string[] = [],
): string[] {
  return [
    "task:review",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--evidence",
    evidence,
    ...answers.flatMap((answer) => ["--resolve", answer]),
    "--status",
    "pass",
    "--summary",
    "All unit tests pass",
  ];
}

/** Names every demand the probe raised, answered by the command the validator cites for it. */
export function answeredBy(findingIds: unknown, commandId: string): string[] {
  return (findingIds as string[]).map((id) => `${id}=${commandId}`);
}
