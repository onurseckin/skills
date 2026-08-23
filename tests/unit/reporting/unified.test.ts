import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/store/index.ts";
import {
  reportDagCommand,
  reportGraphCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportDecisionsCommand,
  reportUnifiedCommand,
} from "../../../olt/scripts/src/cli/commands/unified-reporting.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import type {
  LeaseMatrixRow,
  DecisionAuditRow,
  UnifiedReport,
} from "../../../olt/scripts/src/reporting/unified.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function createFixture(
  runId: string = "unified-run",
): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), "harness-unified-test-"));
  roots.push(repo);
  const runRoot = initRun(
    repo,
    runId,
    new TextEncoder().encode("Test prompt content for unified reporting test"),
    "file",
    true,
  );
  return { repo, run: runRoot };
}

describe("Unified Reporting Subsystem", () => {
  it("report:dag delegates to dagViewCommand", async () => {
    const { run } = await createFixture("dag-delegation");
    const flags: Flags = { run };
    const result = reportDagCommand(flags);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).total_tasks).toBe(0);
  });

  it("report:graph delegates to dagViewCommand", async () => {
    const { run } = await createFixture("graph-delegation");
    const flags: Flags = { run };
    const result = reportGraphCommand(flags);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).run_root).toBe(run);
  });

  it("reportLeasesCommand parses leases correctly with robust agent ID extraction", async () => {
    const { run } = await createFixture("leases-run");
    transact(run, "coordinator", "task-leased", {}, (state) => {
      state.tasks = {
        "task-1": {
          id: "task-1",
          status: "leased",
          requirement_ids: [],
          write_scope: ["src/a.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "impl-worker-1",
            role: "implementer",
            attempt: 1,
            token_digest: "tok1",
            issued_at: "2026-08-22T08:00:00.000Z",
            expires_at: "2026-08-22T08:20:00.000Z",
            heartbeat_at: "2026-08-22T08:05:00.000Z",
            duration_seconds: 1200,
          },
        },
        "task-2": {
          id: "task-2",
          status: "ready",
          requirement_ids: [],
          write_scope: ["src/b.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      };
      state.branches = [
        {
          id: "branch-1",
          task_id: "task-1",
          domain: "backend",
          status: "open",
          assigned_coordinator: "coord-1",
          created_at: "2026-08-22T08:00:00.000Z",
          sub_tasks: [
            {
              id: "sub-1",
              label: "Sub Task 1",
              status: "leased",
              write_scope: ["src/sub.ts"],
              dependencies: [],
              lease: {
                agent_id: "impl-sub-1",
                role: "sub_implementer",
                attempt: 1,
                token_digest: "tok2",
                issued_at: "2026-08-22T08:01:00.000Z",
                expires_at: "2026-08-22T08:21:00.000Z",
                heartbeat_at: "2026-08-22T08:06:00.000Z",
                duration_seconds: 1200,
              },
            },
          ],
        },
      ];
    });

    const flags: Flags = { run };
    const result = reportLeasesCommand(flags) as { matrix: LeaseMatrixRow[]; markdown: string };
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0]!.taskId).toBe("sub-1");
    expect(result.matrix[0]!.agentId).toBe("impl-sub-1");
    expect(result.matrix[0]!.role).toBe("sub_implementer");
    expect(result.matrix[1]!.taskId).toBe("task-1");
    expect(result.matrix[1]!.agentId).toBe("impl-worker-1");
    expect(result.matrix[1]!.role).toBe("implementer");
  });

  it("reportDecisionsCommand parses decisions correctly", async () => {
    const { run } = await createFixture("decisions-run");
    transact(run, "architect", "authority-decided", {}, (state) => {
      state.requirements = {
        requirements: [
          {
            id: "req-1",
            disposition: "actionable",
            status: "planned",
            evidence: [],
            authority_history: [
              {
                decision: "grant",
                rationale: "Approved by architect",
                actor: "architect",
                at: "2026-08-22T08:00:00.000Z",
              },
            ],
          },
          {
            id: "req-2",
            disposition: "actionable",
            status: "planned",
            evidence: [],
            authority_history: [
              {
                decision: "decline",
                rationale: "Declined by security",
                actor: "security",
                at: "2026-08-22T08:01:00.000Z",
              },
            ],
          },
        ],
      };
    });

    const flags: Flags = { run };
    const result = reportDecisionsCommand(flags) as {
      decisions: DecisionAuditRow[];
      markdown: string;
    };
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]!.requirementId).toBe("req-1");
    expect(result.decisions[0]!.decision).toBe("grant");
    expect(result.decisions[1]!.requirementId).toBe("req-2");
    expect(result.decisions[1]!.decision).toBe("decline");
  });

  it("reportUnifiedCommand delivers unified topology, lifecycle tier breakdown, and occupancy", async () => {
    const { run } = await createFixture("unified-full-run");
    transact(run, "coordinator", "task-updated", {}, (state) => {
      state.agents = [
        { id: "mind-0", role: "architect", status: "active", tier: 0 },
        { id: "orchestrator-1", role: "orchestrator", status: "active", tier: 1 },
        { id: "coordinator-1", role: "coordinator", status: "active", tier: 2 },
        { id: "impl-1", role: "implementer", status: "active", tier: 3 },
      ];
      state.tasks = {
        "task-coding": {
          id: "task-coding",
          label: "Coding Task",
          status: "leased",
          requirement_ids: [],
          write_scope: ["src/code.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "impl-1",
            role: "implementer",
            attempt: 1,
            token_digest: "tok3",
            issued_at: "2026-08-22T08:00:00.000Z",
            expires_at: "2026-08-22T08:20:00.000Z",
            heartbeat_at: "2026-08-22T08:05:00.000Z",
            duration_seconds: 1200,
          },
        },
        "task-val": {
          id: "task-val",
          label: "Validating Task",
          status: "validating",
          requirement_ids: [],
          write_scope: ["src/val.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          validations: [
            {
              validator_id: "val-1",
              domain: "code-quality",
              token_digest: "tok4",
              attempt: 1,
              started_at: "2026-08-22T08:05:00.000Z",
              deadline_at: "2026-08-22T08:25:00.000Z",
            },
          ],
        },
        "task-ready": {
          id: "task-ready",
          label: "Standby Task",
          status: "ready",
          requirement_ids: [],
          write_scope: ["src/ready.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
        "task-done": {
          id: "task-done",
          label: "Satisfied Task",
          status: "done",
          requirement_ids: [],
          write_scope: ["src/done.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      };
    });

    const report = reportUnifiedCommand({ run, detailed: true }) as unknown as UnifiedReport;

    expect(report.run_id).toBe("unified-full-run");
    expect(report.topology.total_tasks).toBe(4);
    expect(report.topology.satisfied).toBe(1);
    expect(report.lifecycle.implementers.count).toBe(1);
    expect(report.lifecycle.implementers.active[0]!.agentId).toBe("impl-1");
    expect(report.lifecycle.validators.count).toBe(1);
    expect(report.lifecycle.validators.active[0]!.validatorId).toBe("val-1");
    expect(report.lifecycle.standby.count).toBe(1);
    expect(report.lifecycle.satisfied.count).toBe(1);
    expect(report.occupancy.summary).toContain("1 Implementer(s) coding");
    expect(report.occupancy.summary).toContain("1 Validator(s) testing/probing");
    expect(report.occupancy.summary).toContain("1 Standby ready");

    expect(report.agent_matrix.length).toBeGreaterThanOrEqual(4);
    expect(report.markdown).toContain("Unified Run Report & Telemetry");
    expect(report.markdown).toContain("Distinct Lifecycle Phase Status");
    expect(report.markdown).toContain("Implementers (Coding)");
    expect(report.markdown).toContain("Validators (Testing/Probing)");
  });

  it("reportHealthCommand calls doctor and returns health report", async () => {
    const { run } = await createFixture("health-run");
    const flags: Flags = { run };
    const result = (await reportHealthCommand(flags)) as {
      healthy: boolean;
      run_root: string;
      markdown: string;
    };
    expect(result.run_root).toBe(run);
    expect(result.markdown).toBeDefined();
  });
});
