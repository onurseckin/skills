import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";

mock.module("../../../../../olt/scripts/src/engine/store/integrity/integrity.ts", () => ({
  verifyIntegrity: () => [],
}));
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { initCapsuleRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
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

let cmdSeq = 0;
function recordGateCommand(run: string, _repo: string, actor: string): string {
  const id = `C-${++cmdSeq}`;
  transact(run, "test-setup", "seed-command", {}, (draft) => {
    draft.commands ??= {};
    (draft.commands as JsonObject)[id] = {
      id,
      actor,
      task_id: "task-core",
      gate_id: "gate-core",
      argv: ["bun", "gate-core.ts"],
      exit_code: 0,
      duration_ms: 1,
      cwd: ".",
    };
  });
  return id;
}

function seedFinding(run: string, taskId: string, findingId: string): void {
  transact(run, "test-setup", "finding-seeded-for-test", {}, (draft) => {
    ((draft.tasks as JsonObject)[taskId] as JsonObject).findings = [
      {
        id: findingId,
        requirement_id: "req-core",
        severity: "important",
        observation: "defect found",
        remediation: "fix it",
      } as JsonObject,
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

function writeReport(run: string, name: string, data: Record<string, unknown>): void {
  const vfs = getVirtualCliFS();
  const dir = join(run, "reports");
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
}

describe("finding:get", () => {
  test("without id, lists findings across tasks and critic review", async () => {
    const { run } = setupInspectionRun("finding-get-list");
    seedFinding(run, "task-core", "F-TASK-1");
    seedCriticFinding(run);
    const result = await execute(["finding:get", "--run", run]);
    expect(result.count).toBe(2);
    expect((result.findings as { id: string }[]).map((f) => f.id).sort()).toEqual([
      "F-CRITIC-1",
      "F-TASK-1",
    ]);
  });

  test("--id returns one finding by id", async () => {
    const { run } = setupInspectionRun("finding-get-one");
    seedFinding(run, "task-core", "F-TASK-1");
    const result = await execute(["finding:get", "--run", run, "--id", "F-TASK-1"]);
    expect(result.id).toBe("F-TASK-1");
    expect((result.finding as { id: string; task_id: string }).task_id).toBe("task-core");
  });

  test("--finding is an alias for --id, and a trailing .json is stripped", async () => {
    const { run } = setupInspectionRun("finding-get-alias");
    seedFinding(run, "task-core", "F-TASK-1");
    const result = await execute(["finding:get", "--run", run, "--finding", "F-TASK-1.json"]);
    expect(result.id).toBe("F-TASK-1");
  });

  test("rejects a finding id that was never recorded", async () => {
    const { run } = setupInspectionRun("finding-get-missing");
    await expect(
      execute(["finding:get", "--run", run, "--id", "F-does-not-exist"]),
    ).rejects.toThrow("finding F-does-not-exist is not recorded in this run");
  });
});

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

describe("evidence:get", () => {
  test("without id, lists command evidence, filterable by task/gate/actor", async () => {
    const { repo, run } = setupInspectionRun("evidence-get-list");
    recordGateCommand(run, repo, "worker-1");

    const all = await execute(["evidence:get", "--run", run]);
    expect((all.evidence as unknown[]).length).toBe(1);

    expect(
      ((await execute(["evidence:get", "--run", run, "--task", "task-core"])).evidence as unknown[])
        .length,
    ).toBe(1);
    expect(
      ((await execute(["evidence:get", "--run", run, "--task", "task-sec"])).evidence as unknown[])
        .length,
    ).toBe(0);
    expect(
      ((await execute(["evidence:get", "--run", run, "--gate", "gate-core"])).evidence as unknown[])
        .length,
    ).toBe(1);
    expect(
      ((await execute(["evidence:get", "--run", run, "--gate", "gate-sec"])).evidence as unknown[])
        .length,
    ).toBe(0);
    expect(
      ((await execute(["evidence:get", "--run", run, "--actor", "worker-1"])).evidence as unknown[])
        .length,
    ).toBe(1);
    expect(
      (
        (await execute(["evidence:get", "--run", run, "--actor", "someone-else"]))
          .evidence as unknown[]
      ).length,
    ).toBe(0);
  });

  test("--command/--id/--cmd all resolve one command's evidence", async () => {
    const { repo, run } = setupInspectionRun("evidence-get-one");
    const commandId = recordGateCommand(run, repo, "worker-1");
    expect((await execute(["evidence:get", "--run", run, "--command", commandId])).command_id).toBe(
      commandId,
    );
    expect(
      (await execute(["evidence:get", "--run", run, "--id", `${commandId}.json`])).command_id,
    ).toBe(commandId);
    expect((await execute(["evidence:get", "--run", run, "--cmd", commandId])).command_id).toBe(
      commandId,
    );
  });

  test("rejects unknown command id", async () => {
    const { run } = setupInspectionRun("evidence-get-missing");
    await expect(
      execute(["evidence:get", "--run", run, "--command", "C-does-not-exist"]),
    ).rejects.toThrow("command C-does-not-exist is not recorded in this run");
  });
});

describe("evidence:screenshots", () => {
  test("lists captured screenshots and accepts filters", async () => {
    const { run } = setupInspectionRun("evidence-screenshots-empty");
    const result = await execute(["evidence:screenshots", "--run", run]);
    expect(result.count).toBe(0);
    expect(result.screenshots).toEqual([]);
    const filtered = await execute([
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
    expect(filtered.count).toBe(0);
  });
});
