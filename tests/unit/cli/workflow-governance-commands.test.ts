import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";
import { plannedFixture } from "./scenario-fixture.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI workflow governance commands", () => {
  test("assignRepairerCommand validates reason and assigns repairer", async () => {
    const fixture = await plannedFixture(roots);
    await expect(
      execute([
        "assign-repairer",
        "--run",
        fixture.run,
        "--task",
        "task-1",
        "--repairer",
        "rep-1",
        "--reason",
        "invalid_reason",
        "--evidence",
        "test evidence",
        "--actor",
        "coordinator",
      ]),
    ).rejects.toThrow("--reason must be repeated_failure, stale, or unavailable");

    // Put task into changes_requested so assignRepairer can succeed
    const claim = await execute([
      "claim",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--role",
      "implementer",
    ]);
    await execute([
      "packet",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "worker",
      "--token",
      claim.token as string,
      "--id",
      "task-1-impl",
    ]);
    await execute([
      "submit",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--token",
      claim.token as string,
      "--report",
      fixture.reportPath,
    ]);
    const valStart = await execute([
      "begin-validation",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "val-agent",
    ]);
    await execute([
      "packet",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--role",
      "validator",
      "--agent",
      "val-agent",
      "--token",
      valStart.token as string,
      "--id",
      "task-1-val",
    ]);
    const valCmd = await execute([
      "run",
      "--run",
      fixture.run,
      "--actor",
      "val-agent",
      "--cwd",
      fixture.repo,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--",
      "bun",
      "gate-check.ts",
    ]);
    const checkId = (valCmd.record as { id: string }).id;

    const reviewPath = await writeJson(fixture.repo, "val-reject.json", {
      verdict: "reject",
      requirement_ids: ["R-001"],
      checks: [{ command_id: checkId }],
      findings: [
        {
          id: "F-001",
          requirement_id: "R-001",
          severity: "important",
          observation: "test obs",
          remediation: "test rem",
          revalidation: "test rev",
          evidence: [{ kind: "diff", path: "src/area-1" }],
        },
      ],
    });
    await execute([
      "review",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "val-agent",
      "--token",
      valStart.token as string,
      "--review",
      reviewPath,
    ]);

    const assigned = await execute([
      "assign-repairer",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--repairer",
      "rep-1",
      "--reason",
      "unavailable",
      "--evidence",
      "test evidence",
      "--actor",
      "coordinator",
    ]);
    expect((assigned.task as { repair_assignee?: string }).repair_assignee).toBe("rep-1");
  });

  test("authorityDecisionCommand validates decision and records result", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-auth-"));
    roots.push(repo);
    const prompt = "Implement authority change";
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, prompt);
    const requirements = requirementsDocument(prompt);
    (requirements.requirements as Record<string, unknown>[])[0].disposition = "needs_authority";
    (requirements.dispositions as Record<string, unknown>[])[0].rationale = "Needs user authority";
    const graph = graphDocument(requirements);
    const requirementsPath = await writeJson(repo, "requirements.json", requirements);
    const graphPath = await writeJson(repo, "graph.json", graph);

    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "auth-run",
      "--prompt-file",
      promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const run = init.run_root as string;
    await execute([
      "plan-apply",
      "--run",
      run,
      "--requirements",
      requirementsPath,
      "--graph",
      graphPath,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ]);

    await expect(
      execute([
        "decide-authority",
        "--run",
        run,
        "--requirement",
        "R-001",
        "--actor",
        "coordinator",
        "--decision",
        "invalid_decision",
        "--rationale",
        "test rationale",
      ]),
    ).rejects.toThrow("--decision must be grant or decline");

    const granted = await execute([
      "decide-authority",
      "--run",
      run,
      "--requirement",
      "R-001",
      "--actor",
      "coordinator",
      "--decision",
      "grant",
      "--rationale",
      "grant rationale",
    ]);
    expect(granted.run_root).toBe(run);
    expect((granted.requirement as { id: string; authority_status?: string }).authority_status).toBe("granted");
  });
});
