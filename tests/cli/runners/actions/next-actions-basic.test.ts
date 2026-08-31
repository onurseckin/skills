import { describe, expect, test } from "bun:test";
import {
  autoPartitionNextActions,
  formatNextActions,
  nextActionsBlock,
  orchestrateNextActions,
  planApplyNextActions,
  planAuditNextActions,
  planClaimNextActions,
  planCompileNextActions,
  planEnhanceNextActions,
  planInitNextActions,
  planReplanNextActions,
  planReviewNextActions,
  planStatusNextActions,
  planValidateStartNextActions,
  taskRegisteredNextActions,
  type NextActionItem,
} from "../../../../olt/scripts/src/cli/formatters/index.ts";

describe("Next Actions Formatter", () => {
  test("nextActionsBlock returns empty array for no actions", () => {
    expect(nextActionsBlock([])).toEqual([]);
    expect(formatNextActions([])).toBe("");
  });

  test("nextActionsBlock formats string actions", () => {
    const lines = nextActionsBlock(["bun harness.ts run:status", "bun harness.ts queue:next"]);
    expect(lines).toEqual([
      "",
      "⚡ Next Actions:",
      "1. `bun harness.ts run:status`",
      "2. `bun harness.ts queue:next`",
    ]);
    expect(formatNextActions(["bun harness.ts run:status"])).toBe(
      "⚡ Next Actions:\n1. `bun harness.ts run:status`",
    );
  });

  test("nextActionsBlock formats role-aware action objects", () => {
    const actions: NextActionItem[] = [
      {
        command: "bun harness.ts queue:wave --run run-1",
        role: "Coordinator",
        description: "Dispatch Wave 1 tasks",
      },
      {
        command: "bun harness.ts run:status --run run-1",
        role: "Orchestrator",
        description: "Monitor active lanes",
      },
      {
        command: "bun harness.ts doctor",
      },
    ];
    const lines = nextActionsBlock(actions);
    expect(lines).toContain("⚡ Next Actions:");
    expect(lines).toContain(
      "1. `bun harness.ts queue:wave --run run-1` [Coordinator] — Dispatch Wave 1 tasks",
    );
    expect(lines).toContain(
      "2. `bun harness.ts run:status --run run-1` [Orchestrator] — Monitor active lanes",
    );
    expect(lines).toContain("3. `bun harness.ts doctor`");
  });
});

describe("Next Actions Helper Generators", () => {
  test("plan and orchestration helpers generate exact role-bound commands", () => {
    const initActions = planInitNextActions(".olt/capsules/run-1");
    expect(initActions.length).toBe(2);
    expect(initActions[0]!.command).toContain("plan:enhance --run .olt/capsules/run-1");
    expect(initActions[0]!.role).toBe("Planner");
    expect(initActions[1]!.command).toContain("plan:add --run .olt/capsules/run-1");

    const orchActions = orchestrateNextActions(".olt/capsules/run-1");
    expect(orchActions.length).toBe(3);
    expect(orchActions[0]!.role).toBe("Orchestrator");
    expect(orchActions[1]!.role).toBe("Planner");
    expect(orchActions[2]!.role).toBe("Coordinator");

    const regActions = taskRegisteredNextActions(".olt/capsules/run-1");
    expect(regActions[0]!.command).toContain("plan:add --run .olt/capsules/run-1");
    expect(regActions[1]!.command).toContain("plan:compile --run .olt/capsules/run-1");

    const enhanceActions = planEnhanceNextActions(".olt/capsules/run-1");
    expect(enhanceActions[0]!.command).toContain("plan:add --run .olt/capsules/run-1");
    expect(enhanceActions[1]!.command).toContain("plan:compile --run .olt/capsules/run-1");

    const compileActions = planCompileNextActions(".olt/capsules/run-1", true);
    expect(compileActions[0]!.role).toBe("Plan-Validator");
    expect(compileActions[1]!.role).toBe("Coordinator");

    const compileEmptyActions = planCompileNextActions(".olt/capsules/run-1", false);
    expect(compileEmptyActions[0]!.description).toContain("unblock scheduler");

    const statusCompiled = planStatusNextActions("run-1", true);
    expect(statusCompiled[0]!.role).toBe("Implementer");

    const statusUncompiled = planStatusNextActions("run-1", false);
    expect(statusUncompiled[0]!.role).toBe("Planner");

    const replanActions = planReplanNextActions("run-1", "repair-task-1");
    expect(replanActions[0]!.role).toBe("Coordinator");
    expect(replanActions[1]!.command).toContain("repair-task-1");

    const claimActions = planClaimNextActions("run-1", 2);
    expect(claimActions[0]!.command).toContain("--expected-revision 2");

    const applyActions = planApplyNextActions("run-1");
    expect(applyActions[0]!.role).toBe("Plan-Validator");

    const auditClean = planAuditNextActions("run-1", false);
    expect(auditClean.length).toBe(1);

    const auditBlocking = planAuditNextActions("run-1", true, "A1-granularity");
    expect(auditBlocking[0]!.command).toContain("--accept-audit A1-granularity");

    const validateStart = planValidateStartNextActions("run-1", "val-1", "tok-123");
    expect(validateStart[0]!.command).toContain("--status approved");
    expect(validateStart[1]!.command).toContain("--status changes_requested");

    const reviewApproved = planReviewNextActions("run-1", true);
    expect(reviewApproved[0]!.role).toBe("Coordinator");

    const reviewRejected = planReviewNextActions("run-1", false);
    expect(reviewRejected[0]!.command).toContain("plan:replan");

    const autoPart = autoPartitionNextActions("run-1");
    expect(autoPart[0]!.command).toContain("plan:compile");
  });
});
