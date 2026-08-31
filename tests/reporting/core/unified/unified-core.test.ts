import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  buildAgentMatrixRows,
  buildAgentMatrixTable,
  buildDecisionsTable,
  buildImplementerValidatorTrackingTable,
  buildLeasesTable,
  buildTaskTopologyTable,
  generateUnifiedReport,
  segmentTaskLifecycle,
} from "../../../../olt/scripts/src/reporting/unified/index.ts";
import { scratchRoot } from "../../../../support/scratch-root.ts";

function createMockRun(testName: string) {
  const root = scratchRoot(import.meta.url, testName);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const run = initRun(repo, testName, new TextEncoder().encode("Build auth flow\n"), "file", true);
  return { root, repo, run };
}

describe("unified-core", () => {
  describe("generateUnifiedReport Execution & DAG Integration", () => {
    it("generates full unified report for live seeded multi-task workflow", () => {
      const { run } = createMockRun("live-seeded-workflow");

      transact(run, "test-runner", "seed-workflow", {}, (draft) => {
        draft.tasks = {
          "task-1": {
            id: "task-1",
            label: "Task 1: Base Auth Types",
            status: "done",
            effort: 2,
            criticalDepth: 0,
            write_scope: ["src/auth/types.ts"],
            dependencies: [],
          },
          "task-2": {
            id: "task-2",
            label: "Task 2: Implement Signin Handler",
            status: "running",
            effort: 3,
            criticalDepth: 1,
            write_scope: ["src/auth/signin.ts"],
            dependencies: ["task-1"],
            lease: { agent_id: "implementer-1", role: "implementer", attempt: 1 },
            pushes: 2,
            probes: 1,
          },
          "task-3": {
            id: "task-3",
            label: "Task 3: Security Validation",
            status: "validating",
            effort: 2,
            criticalDepth: 2,
            write_scope: ["src/auth/security.ts"],
            dependencies: ["task-2"],
            validations: [
              { validator_id: "validator-1", domain: "security", deadline: "2026-08-30" },
            ],
          },
          "task-4": {
            id: "task-4",
            label: "Task 4: Session Audit",
            status: "ready",
            effort: 1,
            criticalDepth: 3,
            write_scope: ["src/auth/audit.ts"],
            dependencies: ["task-3"],
          },
        };
        draft.agents = [
          { id: "coordinator-1", role: "coordinator", tier: 1, status: "active" },
          { id: "implementer-1", role: "implementer", tier: 3, status: "active" },
          { id: "validator-1", role: "validator", tier: 2, status: "active" },
        ];
        draft.graph = { revision: 1, nodes: [], edges: [] };
      });

      const report = generateUnifiedReport(run, { detailed: true });

      expect(report.run_id).toBe("live-seeded-workflow");
      expect(report.phase).toBe("Executing");
      expect(report.topology.total_tasks).toBe(4);
      expect(report.topology.satisfied).toBe(1);
      expect(report.topology.active).toBe(2);
      expect(report.topology.standby).toBe(1);
      expect(report.lifecycle.implementers.count).toBe(1);
      expect(report.lifecycle.validators.count).toBe(1);
      expect(report.lifecycle.satisfied.count).toBe(1);

      expect(report.dag).toBeDefined();
      expect(report.dag?.layers.length).toBeGreaterThanOrEqual(3);
      expect(report.dag?.totalTasks).toBe(4);
      expect(report.dag?.metrics.totalWork).toBe(8);
      expect(report.metrics).toEqual(report.dag?.metrics);

      expect(report.implementer_validator_tracking?.length).toBe(4);
      expect(report.coordinator_ownership?.coordinatorId).toBe("coordinator-1");
      expect(report.coordinator_ownership?.ownershipPct).toBe(100);

      expect(report.markdown).toContain(
        "### Unified Run Report & Telemetry: `live-seeded-workflow`",
      );
      expect(report.markdown).toContain("#### 1. Lifecycle Tier & Active Agent Breakdown");
      expect(report.markdown).toContain(
        "#### 2. Implementer-Validator Lane Tracking & Feedback Flow",
      );
      expect(report.markdown).toContain("#### 3. Distinct Lifecycle Phase Status");
      expect(report.markdown).toContain("#### 4. Live Sugiyama Hierarchical DAG");
      expect(report.markdown).toContain("#### 5. Live Doctor Diagnostics & System Integrity");
      expect(report.markdown).toContain("#### 6. Task Topology & Write Scope Matrix");
      expect(report.markdown).toContain("#### 7. Task Rollup & Concurrency Metrics");
    });

    it("generates report with completion status when workflow is complete", () => {
      const { run } = createMockRun("completed-workflow");

      transact(run, "test-runner", "seed-completed", {}, (draft) => {
        draft.tasks = {
          "t-final": { id: "t-final", label: "Final Task", status: "done", dependencies: [] },
        };
        draft.completion_result = { status: "complete" };
      });

      const report = generateUnifiedReport(run);
      expect(report.phase).toBe("Completed");
      expect(report.topology.satisfied).toBe(1);
    });
  });

  describe("Lifecycle Segmentation & Agent Matrix Builder", () => {
    it("segments task lifecycles into accurate breakdown categories", () => {
      const tasks: readonly TaskRecord[] = [
        { id: "t1", status: "done", dependencies: [] },
        {
          id: "t2",
          status: "running",
          lease: { agent_id: "agent-a", role: "implementer", expires_at: "2026-09-01", attempt: 1 },
          dependencies: [],
        },
        {
          id: "t3",
          status: "validating",
          validations: [{ validator_id: "val-b", domain: "code", deadline: "2026-09-01" }],
          dependencies: [],
        },
        { id: "t4", status: "ready", dependencies: [] },
        { id: "t5", status: "proposed", dependencies: ["t2"] },
        { id: "t6", status: "changes_requested", dependencies: [] },
      ];

      const seg = segmentTaskLifecycle(tasks);
      expect(seg.satisfiedTaskIds).toEqual(["t1"]);
      expect(seg.implementersActive.length).toBe(1);
      expect(seg.validatorsActive.length).toBe(1);
      expect(seg.standbyTaskIds).toEqual(["t4"]);
      expect(seg.blockedTaskIds).toEqual(["t5"]);
      expect(seg.repairTaskIds).toEqual(["t6"]);
    });

    it("builds agent matrix rows merging state agents and active task leases", () => {
      const rawAgents: readonly Record<string, unknown>[] = [
        { id: "agent-1", role: "implementer", tier: 3, status: "active" },
        { id: "agent-2", role: "validator", tier: 2, status: "idle" },
      ];
      const tasks: readonly TaskRecord[] = [
        {
          id: "task-1",
          status: "running",
          lease: { agent_id: "agent-1", role: "implementer", attempt: 2, expires_at: "2026-09-01" },
          dependencies: [],
        },
      ];

      const rows = buildAgentMatrixRows(
        rawAgents,
        tasks,
        [
          {
            taskId: "task-1",
            agentId: "agent-1",
            role: "implementer",
            attempt: 2,
            expiresAt: "2026-09-01",
          },
        ],
        [],
      );

      expect(rows.length).toBe(2);
      const row1 = rows.find((r) => r.agentId === "agent-1");
      expect(row1?.taskId).toBe("task-1");
      expect(row1?.attempt).toBe(2);
      expect(row1?.tier).toBe(3);
    });
  });

  describe("Table Generation Functions", () => {
    it("builds formatted markdown tables for agent matrix, leases, decisions, tracking, and topology", () => {
      const agentTable = buildAgentMatrixTable([
        {
          agentId: "impl-1",
          tier: 3,
          tierName: "Tier 3",
          role: "implementer",
          status: "active",
          taskId: "t1",
          attempt: 1,
        },
      ]);
      expect(agentTable[0]).toContain("Agent ID");
      expect(agentTable.some((line) => line.includes("`impl-1`"))).toBe(true);

      const leaseTable = buildLeasesTable([
        {
          taskId: "t1",
          agentId: "impl-1",
          role: "implementer",
          status: "leased",
          attempt: 1,
          expiresAt: "2026-09-01",
        },
      ]);
      expect(leaseTable[0]).toContain("Task ID");
      expect(leaseTable.some((line) => line.includes("`t1`"))).toBe(true);

      const decTable = buildDecisionsTable([
        { requirementId: "req-1", decision: "approve", actor: "lead", rationale: "Looks good" },
      ]);
      expect(decTable[0]).toContain("Requirement ID");
      expect(decTable.some((line) => line.includes("APPROVE"))).toBe(true);

      const trackingTable = buildImplementerValidatorTrackingTable([
        {
          taskId: "t1",
          lane: "Lane 1",
          implementerId: "impl-1",
          validatorId: "val-1",
          pushes: "Pushes: 1/5",
          probes: "Probes: 0/5",
          microCycles: "Attempts: 1/3, In-Lease Repairs: 0/3",
          coordinator: "coord-1 (100%)",
          leaseTimer: "Active (120s)",
        },
      ]);
      expect(trackingTable[0]).toContain("Implementer ──► Validator");
      expect(trackingTable.some((line) => line.includes("`impl-1` ──► `val-1`"))).toBe(true);

      const topoTable = buildTaskTopologyTable([
        {
          id: "t1",
          label: "Task One",
          status: "done",
          gate: "gate-a",
          write_scope: ["src/index.ts"],
        },
      ]);
      expect(topoTable[0]).toContain("Write Scope");
      expect(topoTable.some((line) => line.includes("`src/index.ts`"))).toBe(true);
    });
  });
});
