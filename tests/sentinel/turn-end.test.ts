import { beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  clearInMemoryDispatches,
  clearInMemoryStrikes,
  executeTurnEndHook,
  setInMemoryRouterMode,
  setInMemoryStrikeMode,
} from "../../olt/scripts/src/sentinel/index.ts";

describe("sentinel:turn-end hook", () => {
  beforeEach(() => {
    setInMemoryStrikeMode(true);
    setInMemoryRouterMode(true);
    clearInMemoryStrikes();
    clearInMemoryDispatches();
  });

  test("healthy turn-end yields HEALTHY status and zero strike", () => {
    const res = executeTurnEndHook({
      agent_id: "impl_01",
      role: "implementer",
      task_id: "task-010",
      dry_run: true,
    });

    expect(res.status).toBe("HEALTHY");
    expect(res.strike_count).toBe(0);
    expect(res.action_taken).toBe("NONE");
    expect(res.violations).toHaveLength(0);
  });

  test("violating turn-end advances strike ladder to Strike 1 (ADVISE)", () => {
    const res = executeTurnEndHook({
      agent_id: "impl_01",
      role: "implementer",
      task_id: "task-011",
      write_scope: ["src/in_scope.ts"],
      modified_files: ["src/out_of_scope.ts"],
      parent_supervisor: "coord_01",
    });

    expect(res.status).toBe("VIOLATION_DETECTED");
    expect(res.strike_count).toBe(1);
    expect(res.action_taken).toBe("ADVISE");
    expect(res.routing_journey).toBeDefined();
    expect(res.routing_journey?.target_agent).toBe("impl_01");
    expect(res.routing_journey?.escalated).toBe(false);
    expect(res.markdown_brief).toContain("SENTINEL_ADVISE : STRIKE 1/3");
  });

  test("CLI execute sentinel:turn-end runs clean check", async () => {
    const res = await execute([
      "sentinel:turn-end",
      "--role",
      "implementer",
      "--agent",
      "impl_01",
      "--dry-run",
    ]);

    expect(res.status).toBe("HEALTHY");
    expect(res.strike_count).toBe(0);
    expect(res.action_taken).toBe("NONE");
  });
});
