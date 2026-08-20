import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

/** Sentences the fixture plants so a completeness assertion has something distinctive to look for. */
export const PLANTED = {
  promptAlpha: "Rewrite the alpha parser so it accepts the new grammar",
  promptBeta: "Harden the beta writer against partial flushes",
  planSummary: "Two independent subsystems need work",
  planObservation: "the alpha parser has no grammar tests",
  planTodo: "add grammar fixtures for the empty payload",
  planRisk: "the beta flush path is untested",
  planQuestion: "is a partial flush observable from outside",
  planSource: "src/alpha/index.ts",
  rejectReason: "Grammar fixture for the empty payload is missing",
  rejectRemediation: "Add a fixture that exercises the empty payload",
  probeAlpha: "Prove the parser rejects an empty payload",
  probeBeta: "Prove a partial flush cannot lose the tail",
  repairSummary: "Empty payload fixture added and exercised",
  branchReason: "the flush path needs its own investigation before the writer can change",
  subTaskLabel: "Investigate the flush path",
  subTaskSummary: "A partial flush reproduces under a short buffer",
  collectSummary: "Flush path understood; the writer change is unblocked",
  criticSummary: "Every requirement is proven by a recorded gate",
  model: "fixture-model-large",
} as const;

/**
 * A gate has to perform substantive verification, and the restricted diff check is the cheapest
 * command that qualifies. Spawning a language runtime per gate is what made this fixture too slow
 * to live in the unit suite.
 */
const TASK_GATE = ["git", "diff", "--check"];
const RUN_GATE = ["git", "diff", "--cached", "--check"];

export interface CompletenessRun {
  repo: string;
  run: string;
  branchId: string;
  /** Every bearer token the run handed out, so a test can prove none of them reached the export. */
  tokens: string[];
}

type FlagValue = readonly string[] | string | undefined;
type Issue = (value: unknown) => string;

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected a string, got ${typeof value}`);
  return value;
}

/** `{ "--task": "task-alpha" }` reads as the command line it becomes; a repeated flag takes a list. */
async function cli(
  command: string,
  flags: Readonly<Record<string, FlagValue>>,
  remainder: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const argv: string[] = [command];
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined) continue;
    for (const entry of typeof value === "string" ? [value] : value) argv.push(name, entry);
  }
  if (remainder.length > 0) argv.push("--", ...remainder);
  return execute(argv);
}

function openFindingIds(run: string, taskId: string): string[] {
  const state = loadRun(run).state as unknown as {
    tasks: Record<string, { findings?: Array<{ id: string; status: string }> }>;
  };
  return (state.tasks[taskId]?.findings ?? [])
    .filter((finding) => finding.status === "open")
    .map((finding) => finding.id);
}

function resolutions(run: string, taskId: string, commandId: string): string[] {
  return openFindingIds(run, taskId).map((id) => `${id}=${commandId}`);
}

function seedRepository(): string {
  const repo = mkdtempSync(join(tmpdir(), "graph-completeness-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: repo });
  mkdirSync(join(repo, "src", "alpha"), { recursive: true });
  mkdirSync(join(repo, "src", "beta"), { recursive: true });
  writeFileSync(join(repo, "src", "alpha", "index.ts"), "export const alpha = 1;\n");
  writeFileSync(join(repo, "src", "beta", "index.ts"), "export const beta = 1;\n");
  writeFileSync(join(repo, ".gitignore"), ".capsules/\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: repo });
  return repo;
}

async function plan(run: string): Promise<void> {
  await cli("plan:enhance", {
    "--run": run,
    "--actor": "coordinator-1",
    "--summary": PLANTED.planSummary,
    "--observation": PLANTED.planObservation,
    "--todo": PLANTED.planTodo,
    "--risk": PLANTED.planRisk,
    "--open-question": PLANTED.planQuestion,
    "--source": PLANTED.planSource,
  });
  for (const [id, label, scope, line] of [
    ["task-alpha", "Alpha parser", "src/alpha", "1"],
    ["task-beta", "Beta writer", "src/beta", "2"],
  ] as const) {
    await cli("plan:add", {
      "--run": run,
      "--id": id,
      "--label": label,
      "--scope": scope,
      "--gate": TASK_GATE.join(" "),
      "--actor": "coordinator-1",
      "--requirement-lines": line,
    });
  }
  await cli("plan:compile", {
    "--run": run,
    "--actor": "coordinator-1",
    "--completion-gate": RUN_GATE.join(" "),
  });
}

async function grantAgents(run: string): Promise<void> {
  await cli("agent:register", {
    "--run": run,
    "--agent": "coordinator-1",
    "--role": "coordinator",
    "--host": "fixture-host",
    "--model": PLANTED.model,
    "--model-tier": "l",
    "--thinking-level": "high",
  });
  for (const [agent, role, task] of [
    ["worker-alpha", "implementer", "task-alpha"],
    ["worker-beta", "implementer", "task-beta"],
    ["val-alpha", "validator", "task-alpha"],
    ["val-alpha-2", "validator", "task-alpha"],
    ["val-beta", "validator", "task-beta"],
  ] as const) {
    await cli("agent:register", {
      "--run": run,
      "--agent": agent,
      "--role": role,
      "--host": "fixture-host",
      "--parent-agent": "coordinator-1",
      "--parent-task": task,
    });
  }
  await cli("agent:report", {
    "--run": run,
    "--agent": "worker-alpha",
    "--tool": "Edit",
    "--tokens-in": "18000",
    "--tokens-out": "2400",
  });
}

/** A rejection with a real defect, then a repair round, then a probe answered on the way to pass. */
async function runAlpha(repo: string, run: string, issue: Issue): Promise<void> {
  const claim = await cli("task:claim", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--role": "implementer",
  });
  const work = await cli(
    "run:exec",
    { "--run": run, "--task": "task-alpha", "--actor": "worker-alpha", "--cwd": repo },
    ["echo", "alpha-implementation"],
  );
  await cli("task:submit", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--token": issue(claim.token),
    "--summary": "Alpha parser rewritten against the new grammar",
    "--files-changed": "src/alpha/index.ts",
    "--evidence": text(work.command_id),
  });

  const firstReview = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha",
  });
  const firstGate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-alpha",
      "--gate": "gate-alpha",
      "--actor": "val-alpha",
      "--cwd": repo,
    },
    TASK_GATE,
  );
  await cli("task:reject", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha",
    "--token": issue(firstReview.token),
    "--evidence": text(firstGate.command_id),
    "--reason": PLANTED.rejectReason,
    "--severity": "important",
    "--remediation": PLANTED.rejectRemediation,
  });

  const repair = await cli("task:claim", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--role": "repairer",
  });
  const repairWork = await cli(
    "run:exec",
    { "--run": run, "--task": "task-alpha", "--actor": "worker-alpha", "--cwd": repo },
    ["echo", "alpha-repair"],
  );
  await cli("task:submit", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--token": issue(repair.token),
    "--summary": PLANTED.repairSummary,
    "--files-changed": "src/alpha/index.ts",
    "--evidence": text(repairWork.command_id),
  });

  // A second round needs a second validator: the harness refuses one that already reviewed the task.
  const secondReview = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
  });
  const reviewToken = issue(secondReview.token);
  const secondGate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-alpha",
      "--gate": "gate-alpha",
      "--actor": "val-alpha-2",
      "--cwd": repo,
    },
    TASK_GATE,
  );
  await cli("task:probe", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
    "--token": reviewToken,
    "--demand": PLANTED.probeAlpha,
  });
  await cli("task:review", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
    "--token": reviewToken,
    "--status": "pass",
    "--evidence": text(secondGate.command_id),
    "--resolve": resolutions(run, "task-alpha", text(secondGate.command_id)),
    "--summary": "Alpha verified after the repair round",
  });
}

/** A branch excursion that collects, then a probe answered on the way to pass. */
async function runBeta(repo: string, run: string, issue: Issue): Promise<string> {
  const claim = await cli("task:claim", {
    "--run": run,
    "--task": "task-beta",
    "--agent": "worker-beta",
    "--role": "implementer",
  });
  const parentToken = issue(claim.token);
  const branch = await cli("branch:open", {
    "--run": run,
    "--parent-task": "task-beta",
    "--agent": "worker-beta",
    "--token": parentToken,
    "--reason": PLANTED.branchReason,
    "--sub-task": "S-1",
    "--sub-label": `S-1=${PLANTED.subTaskLabel}`,
    "--sub-scope": "S-1=src/beta/index.ts",
    "--repo": repo,
  });
  const branchId = text(branch.branch_id);
  await cli("agent:register", {
    "--run": run,
    "--agent": "sub-beta-1",
    "--role": "sub-investigator",
    "--host": "fixture-host",
    "--parent-agent": "worker-beta",
    "--parent-task": "S-1",
  });
  const subClaim = await cli("branch:claim", {
    "--run": run,
    "--branch": branchId,
    "--sub-task": "S-1",
    "--agent": "sub-beta-1",
    "--role": "sub-investigator",
    "--repo": repo,
  });
  await cli("run:exec", { "--run": run, "--task": "S-1", "--actor": "sub-beta-1", "--cwd": repo }, [
    "echo",
    "flush-investigation",
  ]);
  // A real edit inside the branch window, so the collect-time Git reading has something to observe.
  writeFileSync(join(repo, "src", "beta", "index.ts"), "export const beta = 2;\n");
  await cli("branch:submit", {
    "--run": run,
    "--branch": branchId,
    "--sub-task": "S-1",
    "--agent": "sub-beta-1",
    "--token": issue(subClaim.token),
    "--summary": PLANTED.subTaskSummary,
  });
  await cli("branch:collect", {
    "--run": run,
    "--branch": branchId,
    "--agent": "worker-beta",
    "--token": parentToken,
    "--summary": PLANTED.collectSummary,
    "--repo": repo,
  });
  await cli("agent:release", {
    "--run": run,
    "--agent": "sub-beta-1",
    "--reason": "S-1 submitted",
  });

  const work = await cli(
    "run:exec",
    { "--run": run, "--task": "task-beta", "--actor": "worker-beta", "--cwd": repo },
    ["echo", "beta-implementation"],
  );
  await cli("task:submit", {
    "--run": run,
    "--task": "task-beta",
    "--agent": "worker-beta",
    "--token": parentToken,
    "--summary": "Beta writer hardened against partial flushes",
    "--files-changed": "src/beta/index.ts",
    "--evidence": text(work.command_id),
  });
  const review = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
  });
  const reviewToken = issue(review.token);
  const gate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-beta",
      "--gate": "gate-beta",
      "--actor": "val-beta",
      "--cwd": repo,
    },
    TASK_GATE,
  );
  await cli("task:probe", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
    "--token": reviewToken,
    "--demand": PLANTED.probeBeta,
  });
  await cli("task:review", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
    "--token": reviewToken,
    "--status": "pass",
    "--evidence": text(gate.command_id),
    "--resolve": resolutions(run, "task-beta", text(gate.command_id)),
    "--summary": "Beta verified",
  });
  return branchId;
}

/** The whole-run gate, the critic's sign-off over every requirement, and the seal. */
async function sealRun(repo: string, run: string, issue: Issue): Promise<void> {
  await cli(
    "run:exec",
    { "--run": run, "--gate": "gate-run-completion", "--actor": "coordinator-1", "--cwd": repo },
    RUN_GATE,
  );
  await cli("agent:register", {
    "--run": run,
    "--agent": "critic-1",
    "--role": "completeness-critic",
    "--host": "fixture-host",
    "--parent-agent": "coordinator-1",
  });
  const inspect = await cli("run:exec", { "--run": run, "--actor": "critic-1", "--cwd": repo }, [
    "echo",
    "critic-inspection",
  ]);
  const start = await cli("critic:start", {
    "--run": run,
    "--critic": "critic-1",
    "--repository-command-ids": text(inspect.command_id),
  });
  const requirementIds = (
    loadRun(run).state as unknown as { requirements: { requirements: Array<{ id: string }> } }
  ).requirements.requirements.map((requirement) => requirement.id);
  await cli("critic:review", {
    "--run": run,
    "--critic": "critic-1",
    "--token": issue(start.token),
    "--decision": "approve",
    "--summary": PLANTED.criticSummary,
    "--proofs": JSON.stringify(
      requirementIds.map((id) => ({
        requirement_id: id,
        status: "satisfied",
        evidence: [
          {
            kind: "command",
            reference: text(inspect.command_id),
            observation: "the completion gate passed",
          },
        ],
      })),
    ),
  });
  await cli("agent:release", {
    "--run": run,
    "--agent": "coordinator-1",
    "--reason": "run complete",
  });
  await cli("run:complete", { "--run": run, "--actor": "coordinator-1" });
}

/**
 * One run that exercises everything the completeness contract names: an enhanced plan, two tasks in
 * one wave, a genuine rejection followed by a repair round, an adversarial probe on each task, a
 * branch excursion that collects, a grant ledger with host-reported telemetry, a critic sign-off and
 * a sealed completion. It is driven entirely through the CLI, so every fact in it is a fact the
 * harness really recorded rather than a shape a fixture asserted into existence.
 */
export async function buildCompletenessRun(name: string): Promise<CompletenessRun> {
  const tokens: string[] = [];
  const issue: Issue = (value) => {
    const issued = text(value);
    tokens.push(issued);
    return issued;
  };
  const repo = seedRepository();
  const promptPath = join(repo, "request.md");
  writeFileSync(promptPath, `${PLANTED.promptAlpha}\n${PLANTED.promptBeta}\n`);

  const init = await cli("plan:init", {
    "--repo": repo,
    "--run": name,
    "--prompt-file": promptPath,
  });
  const run = text(init.run_root);
  await plan(run);
  await grantAgents(run);
  await runAlpha(repo, run, issue);
  const branchId = await runBeta(repo, run, issue);
  await sealRun(repo, run, issue);

  return { repo, run, branchId, tokens };
}
