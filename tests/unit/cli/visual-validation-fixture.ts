import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

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
  ]);
  const workerToken = claim.token as string;

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

export async function advanceRunToCritic(
  run: string,
  repo: string,
  taskId = "task-core",
  worker = "w1",
  validator = "v1",
): Promise<void> {
  const { valToken } = await submitAndStartValidation({ run, repo, taskId, worker, validator });
  const gateCmd = await runGateExec(run, repo, taskId, validator);
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
