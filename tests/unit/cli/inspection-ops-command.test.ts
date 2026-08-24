import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/** Runs task-core's real, already-on-disk gate script and returns the recorded command id. */
async function recordGateCommand(run: string, repo: string, actor: string): Promise<string> {
  try {
    await execute(["agent:register", "--run", run, "--agent-id", actor, "--role", "implementer"]);
  } catch {
    // already registered
  }
  const result = await execute([
    "run:exec",
    "--run",
    run,
    "--actor",
    actor,
    "--cwd",
    repo,
    "--task",
    "task-core",
    "--gate",
    "gate-core",
    "--",
    "bun",
    "gate-core.ts",
  ]);
  return (result.record as { id: string }).id;
}

function seedFinding(run: string, taskId: string, findingId: string): void {
  transact(run, "test-setup", "finding-seeded-for-test", {}, (draft) => {
    const tasks = draft.tasks as JsonObject;
    const task = tasks[taskId] as JsonObject;
    task.findings = [
      {
        id: findingId,
        requirement_id: "req-core",
        severity: "important",
        observation: "a defect was found",
        remediation: "fix the defect",
      },
    ] as JsonObject[];
  });
}

function seedCriticFinding(run: string): void {
  transact(run, "test-setup", "critic-finding-seeded-for-test", {}, (draft) => {
    draft.completion_review = {
      findings: [
        { id: "F-CRITIC-1", requirement_id: "req-core", observation: "critic found this" },
      ],
    } as JsonObject;
  });
}

describe("finding:get", () => {
  test("without an id, lists every finding recorded across tasks and the critic review", async () => {
    const { run } = await setupCompiledRun("finding-get-list", roots);
    seedFinding(run, "task-core", "F-TASK-1");
    seedCriticFinding(run);

    const result = await execute(["finding:get", "--run", run]);
    expect(result.count).toBe(2);
    const findings = result.findings as { id: string }[];
    expect(findings.map((f) => f.id).sort()).toEqual(["F-CRITIC-1", "F-TASK-1"]);
  });

  test("--id returns one finding by id", async () => {
    const { run } = await setupCompiledRun("finding-get-one", roots);
    seedFinding(run, "task-core", "F-TASK-1");

    const result = await execute(["finding:get", "--run", run, "--id", "F-TASK-1"]);
    expect(result.id).toBe("F-TASK-1");
    const finding = result.finding as { id: string; task_id: string };
    expect(finding.task_id).toBe("task-core");
  });

  test("--finding is an alias for --id, and a trailing .json is stripped", async () => {
    const { run } = await setupCompiledRun("finding-get-alias", roots);
    seedFinding(run, "task-core", "F-TASK-1");

    const result = await execute(["finding:get", "--run", run, "--finding", "F-TASK-1.json"]);
    expect(result.id).toBe("F-TASK-1");
  });

  test("rejects a finding id that was never recorded", async () => {
    const { run } = await setupCompiledRun("finding-get-missing", roots);
    await expect(
      execute(["finding:get", "--run", run, "--id", "F-does-not-exist"]),
    ).rejects.toThrow("finding F-does-not-exist is not recorded in this run");
  });
});

describe("report:get", () => {
  async function writeReport(run: string, name: string, data: Record<string, unknown>) {
    const dir = join(run, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify(data));
  }

  test("--task prefers the review report, falling back to the submission report", async () => {
    const { run } = await setupCompiledRun("report-get-task-review", roots);
    await writeReport(run, "task-core-review", { verdict: "pass" });
    const withReview = await execute(["report:get", "--run", run, "--task", "task-core"]);
    expect((withReview.report as { verdict: string }).verdict).toBe("pass");

    const { run: run2 } = await setupCompiledRun("report-get-task-submission-fallback", roots);
    await writeReport(run2, "task-core-submission", { summary: "implemented" });
    const withSubmission = await execute(["report:get", "--run", run2, "--task", "task-core"]);
    expect((withSubmission.report as { summary: string }).summary).toBe("implemented");
  });

  test("--task --submission forces the submission report even when a review exists", async () => {
    const { run } = await setupCompiledRun("report-get-force-submission", roots);
    await writeReport(run, "task-core-review", { verdict: "pass" });
    await writeReport(run, "task-core-submission", { summary: "implemented" });
    const result = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--submission",
    ]);
    expect((result.report as { summary: string }).summary).toBe("implemented");
  });

  test("--type/--stage select submission or review explicitly", async () => {
    const { run } = await setupCompiledRun("report-get-type-stage", roots);
    await writeReport(run, "task-core-submission", { summary: "implemented" });
    const byType = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--type",
      "submission",
    ]);
    expect((byType.report as { summary: string }).summary).toBe("implemented");

    await writeReport(run, "task-core-review", { verdict: "pass" });
    const byStage = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--stage",
      "review",
    ]);
    expect((byStage.report as { verdict: string }).verdict).toBe("pass");
  });

  test("--critic reads the completeness-critic review report", async () => {
    const { run } = await setupCompiledRun("report-get-critic", roots);
    await writeReport(run, "critic-review", { decision: "approve", screenshots: ["shot-1.png"] });
    const result = await execute(["report:get", "--run", run, "--critic"]);
    expect((result.report as { decision: string }).decision).toBe("approve");
    expect(result.screenshots).toEqual(["shot-1.png"]);
  });

  test("--report/--id names an explicit report file, with or without .json", async () => {
    // Layout integrity constrains every file under reports/ to <task-id>-(submission|review|
    // probe-NN).json or the fixed critic-review.json, so an arbitrary free-form name is not a
    // legal report file here even before report:get looks it up.
    const { run } = await setupCompiledRun("report-get-explicit", roots);
    await writeReport(run, "task-core-probe-01", { custom: true });
    const byReport = await execute(["report:get", "--run", run, "--report", "task-core-probe-01"]);
    expect((byReport.report as { custom: boolean }).custom).toBe(true);
    const byReportJson = await execute([
      "report:get",
      "--run",
      run,
      "--report",
      "task-core-probe-01.json",
    ]);
    expect((byReportJson.report as { custom: boolean }).custom).toBe(true);
    const byId = await execute(["report:get", "--run", run, "--id", "task-core-probe-01"]);
    expect((byId.report as { custom: boolean }).custom).toBe(true);
  });

  test("without any selector, lists every report file in the reports directory", async () => {
    const { run } = await setupCompiledRun("report-get-listing", roots);
    await writeReport(run, "task-core-submission", { summary: "implemented" });
    await writeReport(run, "task-sec-submission", { summary: "also implemented" });
    const result = await execute(["report:get", "--run", run]);
    expect(result.count).toBe(2);
    const reports = result.reports as { name: string }[];
    expect(reports.map((r) => r.name).sort()).toEqual([
      "task-core-submission.json",
      "task-sec-submission.json",
    ]);
  });

  test("an empty reports directory (none written yet) lists as zero reports, not an error", async () => {
    const { run } = await setupCompiledRun("report-get-empty", roots);
    const result = await execute(["report:get", "--run", run]);
    expect(result.count).toBe(0);
    expect(result.reports).toEqual([]);
  });

  test("a report file that is not valid json is listed without its parsed data", async () => {
    const { run } = await setupCompiledRun("report-get-invalid-json", roots);
    const dir = join(run, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "task-core-probe-01.json"), "{not valid json");
    const result = await execute(["report:get", "--run", run]);
    const reports = result.reports as { name: string; data?: unknown }[];
    expect(reports).toHaveLength(1);
    expect(reports[0]!.name).toBe("task-core-probe-01.json");
    expect(reports[0]!.data).toBeUndefined();
  });

  test("rejects a named report that does not exist", async () => {
    const { run } = await setupCompiledRun("report-get-missing", roots);
    await expect(
      execute(["report:get", "--run", run, "--report", "task-core-submission"]),
    ).rejects.toThrow("report not found: task-core-submission.json");
  });

  test("rejects a named report file that is not valid json", async () => {
    const { run } = await setupCompiledRun("report-get-invalid-single", roots);
    const dir = join(run, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "task-core-probe-02.json"), "{still not valid");
    await expect(
      execute(["report:get", "--run", run, "--report", "task-core-probe-02"]),
    ).rejects.toThrow(/invalid json in report file/);
  });
});

describe("evidence:get", () => {
  test("without an id, lists recorded command evidence, filterable by task/gate/actor", async () => {
    const { repo, run } = await setupCompiledRun("evidence-get-list", roots);
    await recordGateCommand(run, repo, "worker-1");

    const all = await execute(["evidence:get", "--run", run]);
    expect((all.evidence as unknown[]).length).toBe(1);

    const byTask = await execute(["evidence:get", "--run", run, "--task", "task-core"]);
    expect((byTask.evidence as unknown[]).length).toBe(1);
    const byOtherTask = await execute(["evidence:get", "--run", run, "--task", "task-sec"]);
    expect((byOtherTask.evidence as unknown[]).length).toBe(0);

    const byActor = await execute(["evidence:get", "--run", run, "--actor", "worker-1"]);
    expect((byActor.evidence as unknown[]).length).toBe(1);
    const byOtherActor = await execute(["evidence:get", "--run", run, "--actor", "someone-else"]);
    expect((byOtherActor.evidence as unknown[]).length).toBe(0);
  });

  test("--command/--id/--cmd all resolve one command's evidence, trailing .json stripped", async () => {
    const { repo, run } = await setupCompiledRun("evidence-get-one", roots);
    const commandId = await recordGateCommand(run, repo, "worker-1");

    const byCommand = await execute(["evidence:get", "--run", run, "--command", commandId]);
    expect(byCommand.command_id).toBe(commandId);
    const byId = await execute(["evidence:get", "--run", run, "--id", `${commandId}.json`]);
    expect(byId.command_id).toBe(commandId);
    const byCmd = await execute(["evidence:get", "--run", run, "--cmd", commandId]);
    expect(byCmd.command_id).toBe(commandId);
  });

  test("rejects a command id that was never recorded", async () => {
    const { run } = await setupCompiledRun("evidence-get-missing", roots);
    await expect(
      execute(["evidence:get", "--run", run, "--command", "C-does-not-exist"]),
    ).rejects.toThrow("command C-does-not-exist is not recorded in this run");
  });
});

describe("evidence:screenshots", () => {
  test("lists captured screenshots, empty when none were ever recorded", async () => {
    const { run } = await setupCompiledRun("evidence-screenshots-empty", roots);
    const result = await execute(["evidence:screenshots", "--run", run]);
    expect(result.count).toBe(0);
    expect(result.screenshots).toEqual([]);
  });

  test("accepts task/command/actor filters without error against an empty store", async () => {
    const { run } = await setupCompiledRun("evidence-screenshots-filters", roots);
    const result = await execute([
      "evidence:screenshots",
      "--run",
      run,
      "--task",
      "task-core",
      "--cmd",
      "C-anything",
      "--actor",
      "worker-1",
    ]);
    expect(result.count).toBe(0);
  });
});
