import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlpha, runBeta, sealRun } from "./completeness-run-phases.ts";
import {
  cli,
  git,
  PLANTED,
  RUN_GATE,
  TASK_GATE_ALPHA,
  TASK_GATE_BETA,
  text,
} from "./completeness-run-support.ts";
import type { Issue } from "./completeness-run-support.ts";

export { PLANTED } from "./completeness-run-support.ts";

export interface CompletenessRun {
  repo: string;
  run: string;
  branchId: string;
  /** Every bearer token the run handed out, so a test can prove none of them reached the export. */
  tokens: string[];
}

/**
 * alpha's file is committed here, with the exact content the B15.2 completeness contract later
 * diffs against (`summary-graph-completeness-contract.test.ts`'s "attributes the file..." asserts
 * a real `-export const alpha = 1;` / `+export const alpha = 2;` hunk against this run's baseline
 * inspection, which is pinned to this commit). beta's file is deliberately left off it — written
 * to the working tree only after the commit below — because nothing ever asks for a beta diff, so
 * its `test -f src/beta/index.ts` gate is free to use the simpler "absent at every claimed base"
 * shape the comment on `retireAlphaBaseline` (in `completeness-run-phases.ts`) explains for alpha.
 */
function seedRepository(): string {
  const repo = mkdtempSync(join(tmpdir(), "graph-completeness-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "fixture"]);
  mkdirSync(join(repo, "src", "alpha"), { recursive: true });
  mkdirSync(join(repo, "src", "beta"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".capsules/\n");
  writeFileSync(join(repo, "src", "alpha", "index.ts"), "export const alpha = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "baseline"]);
  writeFileSync(join(repo, "src", "beta", "index.ts"), "export const beta = 1;\n");
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
  for (const [id, label, scope, line, gate] of [
    ["task-alpha", "Alpha parser", "src/alpha", "1", TASK_GATE_ALPHA],
    ["task-beta", "Beta writer", "src/beta", "2", TASK_GATE_BETA],
  ] as const) {
    await cli("plan:add", {
      "--run": run,
      "--id": id,
      "--label": label,
      "--scope": scope,
      "--gate": gate.join(" "),
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
