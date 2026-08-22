import { describe, expect, it, mock } from "bun:test";
import {
  reportDagCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportDecisionsCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/unified-reporting.ts";
import type { Flags } from "../../../orchestrating-long-tasks/scripts/src/cli/options.ts";

describe("Unified Reporting Subsystem", () => {
  it("report:dag delegates to dagViewCommand", () => {
    const mockDagView = mock(() => ({ markdown: "dag" }));
    mock.module("../../../orchestrating-long-tasks/scripts/src/cli/commands/dag-view.ts", () => ({
      dagViewCommand: mockDagView,
    }));
    const flags: Flags = { "run": ".capsules/test" };
    expect(reportDagCommand(flags)).toBeDefined();
  });

  it("report:graph delegates to dagViewCommand", () => {
    const flags: Flags = { "run": ".capsules/test" };
    expect(reportGraphCommand(flags)).toBeDefined();
  });

  it("reportLeasesCommand parses leases correctly", () => {
    mock.module("../../../orchestrating-long-tasks/scripts/src/store/index.ts", () => ({
      loadRun: () => ({
        manifest: { run_id: "run-1" },
        state: {
          tasks: {
            "task-1": { id: "task-1", status: "assigned", lease: { agent: "agent-1" } },
            "task-2": { id: "task-2", status: "planned" }, // no lease
          },
          branches: [
            {
              sub_tasks: [
                { id: "sub-1", lease: { agent: "agent-2" } },
                { id: "sub-2" }, // no lease
              ]
            }
          ]
        },
      }),
    }));

    const flags: Flags = { "run": ".capsules/test" };
    const result = reportLeasesCommand(flags) as any;
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0].taskId).toBe("sub-1");
    expect(result.matrix[0].agentId).toBe("agent-2");
    expect(result.matrix[1].taskId).toBe("task-1");
    expect(result.matrix[1].agentId).toBe("agent-1");
  });

  it("reportDecisionsCommand parses decisions correctly", () => {
    mock.module("../../../orchestrating-long-tasks/scripts/src/store/index.ts", () => ({
      loadRun: () => ({
        manifest: { run_id: "run-1" },
        state: {
          requirements: [
            {
              id: "req-1",
              authority_history: [
                { decision: "grant", rationale: "ok", actor: "admin" }
              ]
            },
            {
              id: "req-2",
              authority_history: [
                { decision: "decline", rationale: "bad", actor: "boss" }
              ]
            },
            {
              id: "req-3"
            }
          ]
        },
      }),
    }));

    const flags: Flags = { "run": ".capsules/test" };
    const result = reportDecisionsCommand(flags) as any;
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0].requirementId).toBe("req-1");
    expect(result.decisions[0].decision).toBe("grant");
    expect(result.decisions[1].requirementId).toBe("req-2");
    expect(result.decisions[1].decision).toBe("decline");
  });

  it("reportHealthCommand calls doctor", async () => {
    mock.module("../../../orchestrating-long-tasks/scripts/src/reporting/doctor.ts", () => ({
      runDoctor: async () => ({ healthy: true, bun_version: "1.0.0" }),
    }));
    const flags: Flags = { "run": ".capsules/test" };
    const result = await reportHealthCommand(flags) as any;
    expect(result.healthy).toBeTrue();
    expect(result.run_root).toBe(".capsules/test");
  });
  
  it("reportGraphJsonCommand calls export", () => {
    mock.module("../../../orchestrating-long-tasks/scripts/src/cli/commands/summary-ops.ts", () => ({
      summaryExportCommand: () => ({ exported: true }),
    }));
    const flags: Flags = { "run": ".capsules/test" };
    const result = reportGraphJsonCommand(flags) as any;
    expect(result.exported).toBeTrue();
  });
});
