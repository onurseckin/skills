import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { execute } from "../../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { readWorktreeLedger } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/ledger.ts";
import { claim, cleanupRoots, worktreeCapsule, type WorktreeFixture } from "./fixture.ts";

function git(repo: string, argv: readonly string[]): string {
  const result = spawnSync("git", [...argv], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** A command that always exits 0 against any repo, real work or not — same trick the completeness
 *  fixture uses (`completeness-run-fixture.ts`'s `TASK_GATE`), so the gate is genuine without
 *  depending on a test file this fixture never wrote. */
const GATE = "git diff --check";

const roots: string[] = [];
afterEach(() => cleanupRoots(roots));

/**
 * Drives one task all the way to `run:complete`, proving B22.4 is actually reached from the CLI
 * entry point a real coordinator uses — not only exercised directly against `consolidateWorktrees`.
 */
async function sealSingleTaskRun(fixture: WorktreeFixture): Promise<string> {
  await execute([
    "plan:add",
    "--run",
    fixture.run,
    "--id",
    "t1",
    "--label",
    "Task t1",
    "--scope",
    "src/a",
    "--gate",
    GATE,
    "--actor",
    "coordinator",
  ]);
  await execute([
    "plan:compile",
    "--run",
    fixture.run,
    "--actor",
    "coordinator",
    "--completion-gate",
    GATE,
  ]);

  const token = await claim(fixture, "t1", "worker-1");
  const ledger = readWorktreeLedger(loadRun(fixture.run).state)!;
  const worktreePath = ledger.worktrees[0]!.path;
  await Bun.write(`${worktreePath}/src/a/feature.ts`, "export const a = 1;\n");
  await execute([
    "run:exec",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--actor",
    "worker-1",
    "--cwd",
    fixture.repo,
    "--",
    "echo",
    "work",
  ]);
  await execute([
    "task:submit",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--agent",
    "worker-1",
    "--token",
    token,
    "--summary",
    "Added feature.ts",
    "--files-changed",
    "src/a/feature.ts",
  ]);

  const review = await execute([
    "task:validate-start",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--validator",
    "validator-1",
  ]);
  const gate = await execute([
    "run:exec",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--gate",
    "gate-t1",
    "--actor",
    "validator-1",
    "--cwd",
    fixture.repo,
    "--",
    "git",
    "diff",
    "--check",
  ]);
  const probe = await execute([
    "task:probe",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--validator",
    "validator-1",
    "--token",
    String(review.token),
    "--demand",
    "Prove the feature actually works",
  ]);
  const findingId = String((probe.finding_ids as string[])[0]);
  await execute([
    "task:review",
    "--run",
    fixture.run,
    "--task",
    "t1",
    "--validator",
    "validator-1",
    "--token",
    String(review.token),
    "--status",
    "pass",
    "--evidence",
    String(gate.command_id),
    "--resolve",
    `${findingId}=${String(gate.command_id)}`,
    "--summary",
    "t1 verified",
  ]);

  await execute([
    "run:exec",
    "--run",
    fixture.run,
    "--gate",
    "gate-run-completion",
    "--actor",
    "coordinator",
    "--cwd",
    fixture.repo,
    "--",
    "git",
    "diff",
    "--check",
  ]);
  await execute([
    "agent:register",
    "--run",
    fixture.run,
    "--agent",
    "critic-1",
    "--role",
    "completeness-critic",
    "--host",
    "fixture-host",
  ]);
  const inspect = await execute([
    "run:exec",
    "--run",
    fixture.run,
    "--actor",
    "critic-1",
    "--cwd",
    fixture.repo,
    "--",
    "echo",
    "critic-inspection",
  ]);
  const start = await execute([
    "critic:start",
    "--run",
    fixture.run,
    "--critic",
    "critic-1",
    "--repository-command-ids",
    String(inspect.command_id),
  ]);
  const requirementIds = (
    loadRun(fixture.run).state as unknown as {
      requirements: { requirements: Array<{ id: string }> };
    }
  ).requirements.requirements.map((requirement) => requirement.id);
  await execute([
    "critic:review",
    "--run",
    fixture.run,
    "--critic",
    "critic-1",
    "--token",
    String(start.token),
    "--decision",
    "approve",
    "--summary",
    "Everything proven",
    "--proofs",
    JSON.stringify(
      requirementIds.map((id) => ({
        requirement_id: id,
        status: "satisfied",
        evidence: [
          {
            kind: "command",
            reference: String(inspect.command_id),
            observation: "the completion gate passed",
          },
        ],
      })),
    ),
  ]);
  const complete = await execute([
    "run:complete",
    "--run",
    fixture.run,
    "--actor",
    "coordinator",
    "--auth-token",
    String(start.token),
  ]);
  return String(complete.markdown ?? "");
}

describe("run:complete triggers B22.4 consolidation", () => {
  test("merges, removes the worktrees, and reports the branch in the completion brief", async () => {
    const fixture = await worktreeCapsule(roots, "run-complete-consolidation");
    await sealSingleTaskRun(fixture);

    const state = loadRun(fixture.run).state;
    const ledger = readWorktreeLedger(state)!;
    expect(ledger.consolidation).toBeDefined();
    expect(ledger.consolidation!.merge_conflict).toBeUndefined();
    expect(ledger.worktrees).toEqual([]);
    expect(existsSync(ledger.root)).toBe(true);

    // The merged file is really on the harness branch, and the user's own checkout never moved.
    expect(git(fixture.repo, ["show", `${ledger.harness_branch}:src/a/feature.ts`]).trim()).toBe(
      "export const a = 1;",
    );
    expect(git(fixture.repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
    expect(git(fixture.repo, ["status", "--short"]).trim()).toBe("");
  });
});
