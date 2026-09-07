import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";

mock.module("../../../../../olt/scripts/src/engine/store/integrity/integrity.ts", () => ({
  verifyIntegrity: () => [],
}));
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { initCapsuleRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

function setupInspectionRun(name: string): { repo: string; run: string } {
  const repo = `/virtual/cli/inspection-${name}`;
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  vfs.writeFileSync(join(repo, "gate-core.ts"), "console.log('gate-core');\n");
  const { runRoot } = initCapsuleRun(`inspection-${name}`, { repo });

  transact(runRoot, "test-setup", "init-inspection-state", {}, (draft) => {
    draft.requirements = {
      requirements: [
        { id: "req-core", statement: "Core Unit Tests", disposition: "actionable" },
        { id: "req-sec", statement: "Secondary Tests", disposition: "actionable" },
      ],
    };
    draft.graph = {
      revision: 1,
      gates: [
        {
          id: "gate-core",
          scope: "task",
          command: "bun gate-core.ts",
          mandatory: true,
          requirement_ids: ["req-core"],
          cwd: ".",
        },
        {
          id: "gate-sec",
          scope: "task",
          command: "bun gate-sec.ts",
          mandatory: true,
          requirement_ids: ["req-sec"],
          cwd: ".",
        },
      ],
      nodes: [
        {
          id: "task-core",
          label: "Core Unit Tests",
          write_scope: ["tests/core"],
          gate_argv: ["bun", "gate-core.ts"],
        },
        {
          id: "task-sec",
          label: "Secondary Tests",
          write_scope: ["tests/cli/sec"],
          gate_argv: ["bun", "gate-sec.ts"],
        },
      ],
      edges: [],
    };
    draft.plan = {
      tasks: [
        {
          id: "task-core",
          label: "Core Unit Tests",
          scope: "tests/core",
          gate: "bun gate-core.ts",
          status: "ready",
        },
        {
          id: "task-sec",
          label: "Secondary Tests",
          scope: "tests/cli/sec",
          gate: "bun gate-sec.ts",
          status: "ready",
        },
      ],
    };
    draft.tasks = {
      "task-core": {
        id: "task-core",
        label: "Core Unit Tests",
        status: "ready",
        write_scope: ["tests/core"],
        requirement_ids: ["req-core"],
      },
      "task-sec": {
        id: "task-sec",
        label: "Secondary Tests",
        status: "ready",
        write_scope: ["tests/cli/sec"],
        requirement_ids: ["req-sec"],
      },
    };
  });
  return { repo, run: runRoot };
}

function writeReport(run: string, name: string, data: Record<string, unknown>): void {
  const vfs = getVirtualCliFS();
  const dir = join(run, "reports");
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
}

describe("report:get", () => {
  test("--task prefers review report, falling back to submission report", async () => {
    const { run } = setupInspectionRun("report-get-task-review");
    writeReport(run, "task-core-review", { verdict: "pass" });
    const withReview = await execute(["report:get", "--run", run, "--task", "task-core"]);
    expect((withReview.report as { verdict: string }).verdict).toBe("pass");

    const { run: run2 } = setupInspectionRun("report-get-task-submission-fallback");
    writeReport(run2, "task-core-submission", { summary: "implemented" });
    const withSubmission = await execute(["report:get", "--run", run2, "--task", "task-core"]);
    expect((withSubmission.report as { summary: string }).summary).toBe("implemented");
  });

  test("--task --submission forces submission report even when review exists", async () => {
    const { run } = setupInspectionRun("report-get-force-submission");
    writeReport(run, "task-core-review", { verdict: "pass" });
    writeReport(run, "task-core-submission", { summary: "implemented" });
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
    const { run } = setupInspectionRun("report-get-type-stage");
    writeReport(run, "task-core-submission", { summary: "implemented" });
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
    writeReport(run, "task-core-review", { verdict: "pass" });
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

  test("--critic reads completeness-critic review report", async () => {
    const { run } = setupInspectionRun("report-get-critic");
    writeReport(run, "critic-review", { decision: "approve", screenshots: ["shot-1.png"] });
    const result = await execute(["report:get", "--run", run, "--critic"]);
    expect((result.report as { decision: string }).decision).toBe("approve");
    expect(result.screenshots).toEqual(["shot-1.png"]);
  });

  test("--report/--id names an explicit report file", async () => {
    const { run } = setupInspectionRun("report-get-explicit");
    writeReport(run, "task-core-probe-01", { custom: true });
    expect(
      (
        (await execute(["report:get", "--run", run, "--report", "task-core-probe-01"])).report as {
          custom: boolean;
        }
      ).custom,
    ).toBe(true);
    expect(
      (
        (await execute(["report:get", "--run", run, "--report", "task-core-probe-01.json"]))
          .report as { custom: boolean }
      ).custom,
    ).toBe(true);
    expect(
      (
        (await execute(["report:get", "--run", run, "--id", "task-core-probe-01"])).report as {
          custom: boolean;
        }
      ).custom,
    ).toBe(true);
  });

  test("without selector, lists reports in reports directory", async () => {
    const { run } = setupInspectionRun("report-get-listing");
    writeReport(run, "task-core-submission", { summary: "implemented" });
    writeReport(run, "task-sec-submission", { summary: "also implemented" });
    const result = await execute(["report:get", "--run", run]);
    expect(result.count).toBe(2);
    expect((result.reports as { name: string }[]).map((r) => r.name).sort()).toEqual([
      "task-core-submission.json",
      "task-sec-submission.json",
    ]);
  });

  test("empty reports directory lists zero reports without error", async () => {
    const { run } = setupInspectionRun("report-get-empty");
    const result = await execute(["report:get", "--run", run]);
    expect(result.count).toBe(0);
    expect(result.reports).toEqual([]);
  });

  test("invalid json report is listed without parsed data", async () => {
    const { run } = setupInspectionRun("report-get-invalid-json");
    writeReport(run, "task-core-probe-01", {} as Record<string, unknown>);
    getVirtualCliFS().writeFileSync(
      join(run, "reports", "task-core-probe-01.json"),
      "{not valid json",
    );
    const result = await execute(["report:get", "--run", run]);
    const reports = result.reports as { name: string; data?: unknown }[];
    expect(reports).toHaveLength(1);
    expect(reports[0]!.name).toBe("task-core-probe-01.json");
    expect(reports[0]!.data).toBeUndefined();
  });

  test("rejects missing report and invalid json single report", async () => {
    const { run } = setupInspectionRun("report-get-missing");
    await expect(
      execute(["report:get", "--run", run, "--report", "task-core-submission"]),
    ).rejects.toThrow("report not found: task-core-submission.json");
    writeReport(run, "task-core-probe-02", {} as Record<string, unknown>);
    getVirtualCliFS().writeFileSync(
      join(run, "reports", "task-core-probe-02.json"),
      "{still not valid",
    );
    await expect(
      execute(["report:get", "--run", run, "--report", "task-core-probe-02"]),
    ).rejects.toThrow(/invalid json in report file/);
  });
});
