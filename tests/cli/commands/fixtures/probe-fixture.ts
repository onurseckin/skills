import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readPlanBindings } from "../../../../olt/scripts/src/cli/commands/plan-replan-bindings.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../../olt/scripts/src/graph/gate-proof.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../shared/chains/agent-supervisor-chain.ts";
import { setupVirtualCliFS } from "./full-lifecycle-fixture.ts";

export const TASK_ID = "task-core";
export const VALIDATOR = "val-1";
export const CHANGED_FILE = "tests/core/probe-target.ts";

export async function setupRun(
  name: string,
  roots: string[],
  config?: Record<string, boolean | number | string>,
): Promise<{ repo: string; run: string }> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/probe-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const staleWorktrees = join(dirname(repo), ".harness-worktrees", name);
  roots.push(staleWorktrees);
  await writeFile(
    join(repo, "harness.config.json"),
    JSON.stringify({ min_adversarial_probes: 1, ...config }),
  );
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests");
  await mkdir(join(repo, "tests/core"), { recursive: true });
  await writeFile(join(repo, CHANGED_FILE), "export const probed = true;\n");
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  await writeFile(join(repo, "gate-red.ts"), "process.exit(1);\n");
  if (config?.worktree_isolation) {
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    await writeFile(join(repo, ".gitignore"), ".olt/capsules\n.olt\n.worktrees\ncapsules\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init"], { cwd: repo });
  }
  await mkdir(join(repo, "olt"), { recursive: true });
  await mkdir(join(repo, ".olt"), { recursive: true });
  const policyContent = JSON.stringify({
    schema_version: 1,
    ecosystem: "bun",
    package_manager: "bun",
    test_runner: {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    },
    review_protocol: {
      max_adversarial_pushes: 20,
      cognitive_pushes: 1,
    },
  });
  await writeFile(join(repo, "olt", "policy.json"), policyContent);
  await writeFile(join(repo, ".olt", "policy.json"), policyContent);

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
    "tests/core",
    "--gate",
    "bun gate-core.ts",
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);

  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  const roster: readonly { agent: string; role: string }[] = [
    { agent: "worker-core", role: "implementer" },
    { agent: "worker-1", role: "implementer" },
    { agent: "worker-2", role: "implementer" },
    { agent: "orch-lead", role: "implementer" },
    { agent: "coord-dispatcher", role: "implementer" },
    { agent: VALIDATOR, role: "validator" },
  ];
  const chain = await establishSupervisorChain(run);
  for (const { agent, role } of roster) {
    await registerUnderChain(run, chain, agent, role);
  }
  return { repo, run };
}

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
    "worker-core",
    "--cwd",
    repo,
    "--",
    "bun",
    script,
  ]);
  return executed.command_id as string;
}

export function seedGateProof(run: string, taskId: string, actor = "coordinator"): void {
  const loaded = loadRun(run);
  const binding = readPlanBindings(loaded.state).tasks.find((task) => task.id === taskId);
  if (!binding || binding.gate === undefined) {
    throw new Error(`seedGateProof: ${taskId} has no compiled task-scope gate to prove`);
  }
  const task = (loaded.state.tasks as Record<string, unknown> | undefined)?.[taskId] as
    | { attempts?: { claimed_base_sha?: { value?: string } }[] }
    | undefined;
  const attempt = task?.attempts?.at(-1);
  const base = attempt?.claimed_base_sha?.value ?? "HEAD";
  const record: GateProofRecord = {
    task_id: taskId,
    gate_argv: [...binding.gate],
    write_scope: [...binding.writeScope],
    base,
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

export function answeredBy(findingIds: unknown, commandId: string): string[] {
  return (findingIds as string[]).map((id) => `${id}=${commandId}`);
}
