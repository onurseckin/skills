import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { seedGateProof } from "./probe-fixture.ts";

export function createMockScreenshot(
  dir: string,
  filename: string,
  content = "fake-image",
): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Argv that writes the screenshot while the command runs. A file that already existed when the
 * command started is not that command's output, so a test that wants an attributed capture has to
 * produce one the way a real suite does.
 */
export function writeScreenshotArgv(
  dir: string,
  filename: string,
  content = "fake-image",
): string[] {
  const target = JSON.stringify(join(dir, filename));
  return [
    "bun",
    "-e",
    `const fs=require("node:fs");fs.mkdirSync(${JSON.stringify(dir)},{recursive:true});fs.writeFileSync(${target},${JSON.stringify(content)});`,
  ];
}

export function readJsonFile<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export async function submitAndStartValidation(options: {
  run: string;
  repo: string;
  taskId: string;
  worker: string;
  validator: string;
}): Promise<{ workerToken: string; valToken: string }> {
  const claim = await execute([
    "task:claim",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--agent",
    options.worker,
    "--role",
    "implementer",
  ]);
  const workerToken = claim.token as string;

  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so the declared file has to actually exist and differ before it is claimed as changed.
  mkdirSync(join(options.repo, "tests/unit/core"), { recursive: true });
  writeFileSync(
    join(options.repo, "tests/unit/core/impl.ts"),
    "export const implemented = true;\n",
  );
  // A submission is only accepted against recorded evidence, so the implementer runs its own
  // command before it submits.
  await execute([
    "run:exec",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--actor",
    options.worker,
    "--cwd",
    options.repo,
    "--",
    "echo",
    "implementer-work",
  ]);
  await execute([
    "task:submit",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--agent",
    options.worker,
    "--token",
    workerToken,
    "--files-changed",
    "tests/unit/core/impl.ts",
    "--summary",
    "Implemented the task under test",
  ]);

  const valStart = await execute([
    "task:validate-start",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--validator",
    options.validator,
  ]);
  const valToken = valStart.token as string;

  return { workerToken, valToken };
}

export async function runGateExec(
  run: string,
  repo: string,
  taskId: string,
  actor: string,
  gate = "gate-core",
  script = "gate-core.ts",
): Promise<Record<string, unknown>> {
  return execute([
    "run:exec",
    "--run",
    run,
    "--task",
    taskId,
    "--gate",
    gate,
    "--actor",
    actor,
    "--cwd",
    repo,
    "--",
    "bun",
    script,
  ]);
}

export async function recordMandatoryProbe(
  run: string,
  taskId: string,
  validator: string,
  valToken: string,
): Promise<string[]> {
  const probe = await execute([
    "task:probe",
    "--run",
    run,
    "--task",
    taskId,
    "--validator",
    validator,
    "--token",
    valToken,
    "--demand",
    "Prove the captured screenshots come from the changed screen",
  ]);
  return probe.finding_ids as string[];
}

export async function advanceRunToCritic(
  run: string,
  repo: string,
  taskId = "task-core",
  worker = "w1",
  validator = "v1",
): Promise<void> {
  const { valToken } = await submitAndStartValidation({ run, repo, taskId, worker, validator });
  const gateCmd = await runGateExec(run, repo, taskId, validator);
  const demands = await recordMandatoryProbe(run, taskId, validator, valToken);
  // C3b: a passing review now requires a recorded falsifiable gate:prove proof for the task's
  // compiled task-scope gate. This fixture's repo is a plain temp directory, not a real Git
  // repository (see probe-fixture.ts's seedGateProof for why), so the real `gate:prove` CLI cannot
  // run against it — seed the same gate_proofs record it would have appended instead.
  seedGateProof(run, taskId);
  await execute([
    "task:review",
    "--run",
    run,
    "--task",
    taskId,
    "--validator",
    validator,
    "--token",
    valToken,
    "--evidence",
    String(gateCmd.command_id),
    "--resolve",
    `${demands[0]}=${String(gateCmd.command_id)}`,
    "--status",
    "pass",
    "--summary",
    "Task approved",
  ]);
  await execute([
    "run:exec",
    "--run",
    run,
    "--gate",
    "gate-run-completion",
    "--actor",
    validator,
    "--cwd",
    repo,
    "--",
    "bun",
    "test",
    "tests",
  ]);
}
