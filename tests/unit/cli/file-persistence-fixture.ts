import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";

export async function setupCompiledRun(
  name: string,
  roots: string[],
): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-file-persist-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests\n\nSecondary tests");
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await mkdir(join(repo, "tests"), { recursive: true });
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core-output');\n");
  await writeFile(
    join(repo, "tests/run.test.ts"),
    "import { test } from 'bun:test'; test('all', () => {});\n",
  );

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
    "task-core",
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

export async function claimSubmitValidateAndReject(options: {
  run: string;
  repo: string;
  taskId: string;
  agent: string;
  validator: string;
  role?: string;
  reason: string;
  remediation?: string;
  findingId?: string;
}): Promise<Record<string, unknown>> {
  const claim = await execute([
    "task:claim",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--agent",
    options.agent,
    "--role",
    options.role ?? "implementer",
  ]);
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so the declared file below has to actually change every round — a random marker rather
  // than a value derived from taskId/agent, since this same pair repairs the same task more than
  // once in the multi-round fixture and each round must differ from the one before it.
  await mkdir(join(options.repo, "tests/unit/core"), { recursive: true });
  await writeFile(
    join(options.repo, "tests/unit/core/impl.ts"),
    `export const implemented = "${randomUUID()}";\n`,
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
    options.agent,
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
    options.agent,
    "--token",
    claim.token as string,
    "--files-changed",
    "tests/unit/core/impl.ts",
    "--summary",
    "Implemented the task under test",
  ]);
  const val = await execute([
    "task:validate-start",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--validator",
    options.validator,
  ]);
  const gateCmd = await execute([
    "run:exec",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--gate",
    "gate-core",
    "--actor",
    options.validator,
    "--cwd",
    options.repo,
    "--",
    "bun",
    "gate-core.ts",
  ]);
  return execute([
    "task:reject",
    "--severity",
    "critical",
    "--run",
    options.run,
    "--task",
    options.taskId,
    "--validator",
    options.validator,
    "--token",
    val.token as string,
    "--evidence",
    gateCmd.command_id as string,
    "--reason",
    options.reason,
    "--remediation",
    options.remediation ?? "Correct the defect the reason names and rerun the gate",
    ...(options.findingId ? ["--finding-id", options.findingId] : []),
  ]);
}
