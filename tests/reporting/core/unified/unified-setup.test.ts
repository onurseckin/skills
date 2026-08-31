import { describe, expect, it } from "bun:test";
import {
  buildAgentMatrixTable,
  buildDecisionsTable,
  buildImplementerValidatorTrackingTable,
  buildLeasesTable,
  buildTaskTopologyTable,
  buildUnifiedReportMarkdown,
  type CoordinatorOwnershipMetrics,
  type DecisionAuditRow,
  type ImplementerValidatorTrackingRow,
  type LeaseMatrixRow,
  type SugiyamaDagReport,
  type UnifiedAgentRow,
  type UnifiedSectionData,
} from "../../../../olt/scripts/src/reporting/unified/index.ts";

describe("unified-setup", () => {
  describe("buildAgentMatrixTable", () => {
    it("returns placeholder text when agent list is empty", () => {
      const result = buildAgentMatrixTable([]);
      expect(result).toEqual(["*No active agents registered in this run.*"]);
    });

    it("formats table with headers and data for multiple lifecycle tier agents", () => {
      const rows: readonly UnifiedAgentRow[] = [
        {
          agentId: "coordinator-1",
          tier: 1,
          tierName: "Tier 1",
          role: "coordinator",
          status: "active",
          taskId: null,
          attempt: null,
        },
        {
          agentId: "validator-1",
          tier: 2,
          tierName: "Tier 2",
          role: "validator",
          status: "validating",
          taskId: "task-10",
          attempt: 1,
          expiresAt: "2026-08-30T12:00:00Z",
        },
        {
          agentId: "implementer-1",
          tier: 3,
          tierName: "Tier 3",
          role: "implementer",
          status: "leased",
          taskId: "task-11",
          attempt: 2,
          expiresAt: "2026-08-30T12:30:00Z",
        },
      ];

      const result = buildAgentMatrixTable(rows);
      expect(result.length).toBe(5); // Header + separator + 3 data rows
      expect(result[0]).toContain("Agent ID");
      expect(result[0]).toContain("Lifecycle Tier");
      expect(result[0]).toContain("Task / Attempt");
      expect(result[2]).toContain("`coordinator-1`");
      expect(result[2]).toContain("Tier 1");
      expect(result[3]).toContain("`validator-1`");
      expect(result[3]).toContain("`task-10` (#1)");
      expect(result[4]).toContain("`implementer-1`");
      expect(result[4]).toContain("`task-11` (#2)");
    });
  });

  describe("buildLeasesTable", () => {
    it("returns placeholder text when leases list is empty", () => {
      const result = buildLeasesTable([]);
      expect(result).toEqual(["*No active leases found.*"]);
    });

    it("formats table with task, agent, role, attempt, status, and deadline", () => {
      const rows: readonly LeaseMatrixRow[] = [
        {
          taskId: "task-01",
          agentId: "impl-alpha",
          role: "implementer",
          attempt: 1,
          status: "leased",
          expiresAt: "2026-08-30T10:00:00Z",
        },
        {
          taskId: "task-02",
          agentId: "impl-beta",
          role: "implementer",
          attempt: 3,
          status: "running",
        },
      ];

      const result = buildLeasesTable(rows);
      expect(result.length).toBe(4);
      expect(result[0]).toContain("Task ID");
      expect(result[0]).toContain("Expires At");
      expect(result[2]).toContain("`task-01`");
      expect(result[2]).toContain("#1");
      expect(result[3]).toContain("`task-02`");
      expect(result[3]).toContain("#3");
      expect(result[3]).toContain("—");
    });
  });

  describe("buildDecisionsTable", () => {
    it("returns placeholder text when decisions list is empty", () => {
      const result = buildDecisionsTable([]);
      expect(result).toEqual(["*No authority decisions recorded.*"]);
    });

    it("formats authority decisions table with uppercase decision verbs", () => {
      const rows: readonly DecisionAuditRow[] = [
        {
          requirementId: "REQ-001",
          decision: "approve",
          actor: "lead-architect",
          timestamp: "2026-08-29T18:00:00Z",
          rationale: "Meets all criteria",
        },
        {
          requirementId: "REQ-002",
          decision: "reject",
          actor: "security-gate",
          rationale: "Unsanitized scope path",
        },
      ];

      const result = buildDecisionsTable(rows);
      expect(result.length).toBe(4);
      expect(result[0]).toContain("Requirement ID");
      expect(result[0]).toContain("Rationale");
      expect(result[2]).toContain("`REQ-001`");
      expect(result[2]).toContain("APPROVE");
      expect(result[2]).toContain("`lead-architect`");
      expect(result[3]).toContain("`REQ-002`");
      expect(result[3]).toContain("REJECT");
    });
  });

  describe("buildImplementerValidatorTrackingTable", () => {
    it("returns placeholder text when tracking list is empty", () => {
      const result = buildImplementerValidatorTrackingTable([]);
      expect(result).toEqual(["*No active lane tasks tracked.*"]);
    });

    it("formats implementer-validator flow with micro-cycles and coordinator info", () => {
      const rows: readonly ImplementerValidatorTrackingRow[] = [
        {
          taskId: "task-01",
          lane: "Lane 1",
          implementerId: "impl-1",
          validatorId: "val-1",
          pushes: "Pushes: 2/5",
          probes: "Probes: 1/5",
          microCycles: "Attempts: 1/3, In-Lease Repairs: 1/3",
          coordinator: "coordinator-1 (100%)",
          leaseTimer: "Active (115s)",
        },
      ];

      const result = buildImplementerValidatorTrackingTable(rows);
      expect(result.length).toBe(3);
      expect(result[0]).toContain("Implementer ──► Validator");
      expect(result[0]).toContain("Micro-Cycles");
      expect(result[2]).toContain("`task-01` (Lane 1)");
      expect(result[2]).toContain("`impl-1` ──► `val-1`");
      expect(result[2]).toContain("Pushes: 2/5");
      expect(result[2]).toContain("coordinator-1 (100%) [Active (115s)]");
    });
  });

  describe("buildTaskTopologyTable", () => {
    it("formats task topology table with write scopes and gates", () => {
      const tasks = [
        {
          id: "task-core",
          label: "Core Library",
          status: "passed",
          gate: "gate-alpha",
          write_scope: ["src/core.ts", "src/types.ts"],
        },
        {
          id: "task-cli",
          status: "ready",
        },
      ];

      const result = buildTaskTopologyTable(tasks);
      expect(result.length).toBe(4);
      expect(result[0]).toContain("Task ID");
      expect(result[0]).toContain("Write Scope");
      expect(result[2]).toContain("`task-core`");
      expect(result[2]).toContain("`gate-alpha`");
      expect(result[2]).toContain("`src/core.ts`, `src/types.ts`");
      expect(result[3]).toContain("`task-cli`");
      expect(result[3]).toContain("—");
    });
  });

  describe("buildUnifiedReportMarkdown", () => {
    it("assembles complete unified markdown document with all telemetry sections", () => {
      const mockDag: SugiyamaDagReport = {
        markdown: "### DAG Visualization",
        renderedDag: "╭── WAVE 1 ──╮\n│ ● task-1   │\n╰────────────╯",
        layers: [
          {
            rank: 0,
            nodes: [
              {
                id: "task-1",
                label: "task-1",
                status: "running",
                dependencies: [],
                rank: 0,
                order: 0,
              },
            ],
          },
        ],
        nodes: [
          { id: "task-1", label: "task-1", status: "running", dependencies: [], rank: 0, order: 0 },
        ],
        cycleDiagnostic: {
          hasCycle: false,
          cyclePaths: [],
          cycleEdges: [],
          alert: "",
          remediation: [],
          cycleNodeIds: [],
        },
        bypassDiagnostic: { hasBypass: false, bypasses: [], alert: "", warnings: [] },
        metrics: {
          totalWaves: 1,
          maxParallelLanes: 1,
          criticalPathLength: 1,
          averageWaveConcurrency: 1,
          serialBottlenecks: 0,
          parallelEligibleChains: 0,
          totalWork: 1,
          span: 1,
          parallelismFactor: 1,
          optimalConcurrency: 1,
        },
        isCompiled: true,
        graphRevision: 1,
        totalTasks: 1,
      };

      const mockCoord: CoordinatorOwnershipMetrics = {
        coordinatorId: "coord-tier1",
        totalTasks: 1,
        ownedTasks: 1,
        ownershipPct: 100,
        activeLeaseTimers: [{ taskId: "task-1", agentId: "impl-1", remainingSeconds: 120 }],
      };

      const sectionData: UnifiedSectionData = {
        runId: "run-test-123",
        phase: "Executing",
        totalTasks: 1,
        satisfiedCount: 0,
        occupancySummary: "1 Implementer coding | 1/4 active slots",
        doctorHealthy: true,
        bunSupported: true,
        gitignored: true,
        doctorCriticalIssues: [],
        doctorCosmeticIssues: [],
        agentRows: [
          {
            agentId: "impl-1",
            tier: 3,
            tierName: "Tier 3",
            role: "implementer",
            status: "leased",
            taskId: "task-1",
            attempt: 1,
          },
        ],
        implementersActive: [
          {
            taskId: "task-1",
            agentId: "impl-1",
            role: "implementer",
            attempt: 1,
            expiresAt: "2026-08-30",
          },
        ],
        validatorsActive: [],
        submittedTaskIds: [],
        standbyTaskIds: [],
        blockedTaskIds: [],
        satisfiedTaskIds: [],
        repairTaskIds: [],
        sugiyamaReport: mockDag,
        tasks: [{ id: "task-1", label: "Task 1", status: "running", write_scope: ["src/a.ts"] }],
        trackingRows: [
          {
            taskId: "task-1",
            lane: "Lane 1",
            implementerId: "impl-1",
            validatorId: "val-1",
            pushes: "Pushes: 0/5",
            probes: "Probes: 0/5",
            microCycles: "Attempts: 1/3, In-Lease Repairs: 0/3",
            coordinator: "coord-tier1 (100%)",
            leaseTimer: "Active (120s)",
          },
        ],
        coordinatorMetrics: mockCoord,
        decisions: [
          {
            requirementId: "REQ-1",
            decision: "approve",
            actor: "lead",
            rationale: "OK",
            timestamp: "2026-08-29",
          },
        ],
        detailed: true,
      };

      const md = buildUnifiedReportMarkdown(sectionData);
      expect(md).toContain("### Unified Run Report & Telemetry: `run-test-123`");
      expect(md).toContain("#### 1. Lifecycle Tier & Active Agent Breakdown");
      expect(md).toContain("#### 2. Implementer-Validator Lane Tracking & Feedback Flow");
      expect(md).toContain("#### 3. Distinct Lifecycle Phase Status");
      expect(md).toContain("#### 4. Live Sugiyama Hierarchical DAG");
      expect(md).toContain("#### 5. Live Doctor Diagnostics & System Integrity");
      expect(md).toContain("#### 6. Task Topology & Write Scope Matrix");
      expect(md).toContain("#### 7. Task Rollup & Concurrency Metrics");
      expect(md).toContain("#### 8. Authority Decisions & Governance Audit");
      expect(md).toContain("`REQ-1`");
    });
  });
});
