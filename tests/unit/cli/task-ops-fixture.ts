import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";

/** Two tasks, one depending on the other, compiled and ready to be claimed. */
export async function setupCompiledRun(
  name: string,
  roots: string[],
  config?: Record<string, boolean | number | string>,
) {
  const repo = await mkdtemp(join(tmpdir(), `task-ops-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Core unit tests\n\nSecondary tests");
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await mkdir(join(repo, "tests/unit/sec"), { recursive: true });
  await writeFile(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  await writeFile(join(repo, "gate-sec.ts"), "console.log('gate-sec');\n");
  if (config) {
    await writeFile(join(repo, "harness.config.json"), JSON.stringify(config));
  }

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
    "plan:add",
    "--run",
    run,
    "--id",
    "task-sec",
    "--label",
    "Secondary Tests",
    "--scope",
    "tests/unit/sec",
    "--gate",
    "bun gate-sec.ts",
    "--deps",
    "task-core",
    "--dep-reason",
    "task-core:secondary tests read the fixtures task-core writes",
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
    "--accept-audit",
    "A4-false-barrier:fixture orders lease/submission flows through task-sec on purpose, not a real read/write relationship",
  ]);
  if (rosterEligible(name)) await registerStandardRoster(run, coordinatorRoleFor(name));
  return { repo, run };
}

const OWN_REGISTRATION_FIXTURE_PREFIXES: readonly string[] = ["agent-"];

function rosterEligible(name: string): boolean {
  return !OWN_REGISTRATION_FIXTURE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const ORCHESTRATOR_COORDINATOR_FIXTURE_PREFIXES: readonly string[] = ["supervise-"];
const PLANNER_COORDINATOR_FIXTURE_PREFIXES: readonly string[] = ["replan-"];
const CRITIC_COORDINATOR_FIXTURE_NAMES: ReadonlySet<string> = new Set([
  "critic-remediate-no-review",
]);

function coordinatorRoleFor(name: string): string {
  if (ORCHESTRATOR_COORDINATOR_FIXTURE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "orchestrator";
  }
  if (PLANNER_COORDINATOR_FIXTURE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "planner";
  }
  if (CRITIC_COORDINATOR_FIXTURE_NAMES.has(name)) {
    return "completeness-critic";
  }
  return "coordinator";
}

function standardRoster(coordinatorRole: string): readonly { agent: string; role: string }[] {
  return [
    { agent: "worker-1", role: "implementer" },
    { agent: "worker-2", role: "implementer" },
    { agent: "sub-1", role: "sub-implementer" },
    { agent: "coordinator", role: coordinatorRole },
    { agent: "orch-pulse-master", role: "implementer" },
    { agent: "coord-domain-backend", role: "implementer" },
    { agent: "plan-val-1", role: "plan-validator" },
  ];
}

async function registerStandardRoster(run: string, coordinatorRole: string): Promise<void> {
  for (const { agent, role } of standardRoster(coordinatorRole)) {
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      agent,
      "--role",
      role,
      "--host",
      "antigravity",
    ]);
  }
}

// C4: task:submit refuses a submission whose write scope is byte-identical to its content at claim,
// so every fixture that goes on to declare task-core as changed has to actually change it first.
export async function markCoreImplemented(repo: string): Promise<void> {
  await mkdir(join(repo, "tests/unit/core"), { recursive: true });
  await writeFile(join(repo, "tests/unit/core/impl.ts"), "export const implemented = true;\n");
}
