import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { generateUnifiedReport } from "../../../../olt/scripts/src/reporting/unified/index.ts";
import { scratchRoot } from "../../../../support/scratch-root.ts";

function createMockRun(testName: string) {
  const root = scratchRoot(import.meta.url, testName);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const run = initRun(repo, testName, new TextEncoder().encode("Edge testing\n"), "file", true);
  return { root, repo, run };
}

describe("unified-edge", () => {
  describe("Empty Tasks & Minimal Run State", () => {
    it("handles run with 0 tasks and empty agent ledger cleanly", () => {
      const { run } = createMockRun("empty-tasks-run");

      transact(run, "test-runner", "seed-empty", {}, (draft) => {
        draft.tasks = {};
        draft.agents = [];
      });

      const report = generateUnifiedReport(run);
      expect(report.topology.total_tasks).toBe(0);
      expect(report.topology.satisfied).toBe(0);
      expect(report.topology.active).toBe(0);
      expect(report.lifecycle.implementers.count).toBe(0);
      expect(report.lifecycle.validators.count).toBe(0);

      expect(report.dag).toBeDefined();
      expect(report.dag?.totalTasks).toBe(0);
      expect(report.dag?.layers.length).toBe(0);
      expect(report.dag?.renderedDag).toContain("(No tasks declared in planning buffer/graph)");
      expect(report.markdown).toContain("*No active agents registered in this run.*");
      expect(report.markdown).toContain("0 Implementer(s) coding");
    });
  });

  describe("Missing Agents & Fallback Defaults", () => {
    it("gracefully falls back when tasks have active leases but state.agents is undefined", () => {
      const { run } = createMockRun("missing-agents-run");

      transact(run, "test-runner", "seed-missing-agents", {}, (draft) => {
        draft.tasks = {
          "orphan-task": {
            id: "orphan-task",
            label: "Orphan Task",
            status: "running",
            dependencies: [],
            lease: { agent_id: "ghost-agent", role: "implementer", attempt: 1 },
          },
        };
        draft.agents = undefined;
      });

      const report = generateUnifiedReport(run);
      expect(report.topology.total_tasks).toBe(1);
      expect(report.topology.active).toBe(1);
      expect(report.agent_matrix.length).toBe(1);
      expect(report.agent_matrix[0]?.agentId).toBe("ghost-agent");
      expect(report.coordinator_ownership?.coordinatorId).toBe("coordinator-tier1");
      expect(report.markdown).toContain("`ghost-agent`");
    });
  });

  describe("Circular Dependencies Diagnostic Reporting", () => {
    it("detects cycle, injects cycle alert banner, and flags cycle tasks", () => {
      const { run } = createMockRun("cycle-edge-run");

      transact(run, "test-runner", "seed-cycle", {}, (draft) => {
        draft.tasks = {
          "cycle-A": { id: "cycle-A", label: "Task A", status: "ready", dependencies: ["cycle-C"] },
          "cycle-B": { id: "cycle-B", label: "Task B", status: "ready", dependencies: ["cycle-A"] },
          "cycle-C": { id: "cycle-C", label: "Task C", status: "ready", dependencies: ["cycle-B"] },
        };
        draft.graph = { revision: 1, nodes: [], edges: [] };
      });

      const report = generateUnifiedReport(run);
      expect(report.dag?.cycleDiagnostic.hasCycle).toBe(true);
      expect(report.dag?.cycleDiagnostic.cyclePaths.length).toBeGreaterThan(0);
      expect(report.dag?.cycleDiagnostic.remediation.length).toBeGreaterThan(0);
      expect(report.markdown).toContain("⚡ [POISONOUS CYCLE] ⚡");
      expect(report.markdown).toContain("Cycle detected: cycle-A ➔ cycle-B ➔ cycle-C ➔ cycle-A");
      expect(report.markdown).toContain("Remediation:");
    });
  });

  describe("Transitive Bypass Violation Diagnostics", () => {
    it("detects illegal transitive bypass in unified report", () => {
      const { run } = createMockRun("bypass-edge-run");

      transact(run, "test-runner", "seed-bypass", {}, (draft) => {
        draft.tasks = {
          "step-1": { id: "step-1", status: "passed", dependencies: [] },
          "step-2": { id: "step-2", status: "passed", dependencies: ["step-1"] },
          "step-3": { id: "step-3", status: "ready", dependencies: ["step-2", "step-1"] },
        };
      });

      const report = generateUnifiedReport(run);
      expect(report.dag?.bypassDiagnostic.hasBypass).toBe(true);
      expect(report.dag?.bypassDiagnostic.bypasses.length).toBeGreaterThan(0);
      expect(report.markdown).toContain("❌ [ILLEGAL BYPASS]");
    });
  });

  describe("Line Limiting (180 Lines vs Detailed Mode)", () => {
    it("enforces strict <= 180 line ceiling in default mode on large 40-task workflows", () => {
      const { run } = createMockRun("line-limit-default-run");

      transact(run, "test-runner", "seed-large-workflow", {}, (draft) => {
        const tasksObj: Record<string, unknown> = {};
        for (let i = 1; i <= 40; i++) {
          tasksObj[`task-${i}`] = {
            id: `task-${i}`,
            label: `Detailed Task Specification Number ${i} With Long Descriptive Content`,
            status: i <= 10 ? "done" : i <= 20 ? "running" : "ready",
            effort: 2,
            criticalDepth: Math.floor(i / 2),
            write_scope: [`src/modules/module-${i}/impl.ts`, `src/modules/module-${i}/types.ts`],
            dependencies: i > 1 ? [`task-${i - 1}`] : [],
            lease:
              i <= 20 ? { agent_id: `agent-${i % 4}`, role: "implementer", attempt: 1 } : undefined,
          };
        }
        draft.tasks = tasksObj;
        draft.graph = { revision: 1, nodes: [], edges: [] };
      });

      const reportDefault = generateUnifiedReport(run, { detailed: false });
      const defaultLines = reportDefault.markdown.split("\n");
      expect(defaultLines.length).toBeLessThanOrEqual(180);

      const reportDetailed = generateUnifiedReport(run, { detailed: true });
      const detailedLines = reportDetailed.markdown.split("\n");
      expect(detailedLines.length).toBeGreaterThan(180);
      expect(reportDetailed.markdown).not.toContain("[... truncated remaining lines]");
    });
  });
});
