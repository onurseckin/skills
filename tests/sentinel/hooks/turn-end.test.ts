import { beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  clearInMemoryDispatches,
  clearInMemoryStrikes,
  executeTurnEndHook,
  getStrikeRecord,
  setInMemoryRouterMode,
  setInMemoryStrikeMode,
} from "../../../olt/scripts/src/sentinel/index.ts";

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

  test("progresses through Strike 2 (BLOCK) and Strike 3 (ESCALATE) with supervisor routing", () => {
    // Strike 1
    const s1 = executeTurnEndHook({
      agent_id: "impl_escalate",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      parent_supervisor: "coord_01",
    });
    expect(s1.action_taken).toBe("ADVISE");
    expect(s1.strike_count).toBe(1);

    // Strike 2
    const s2 = executeTurnEndHook({
      agent_id: "impl_escalate",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      parent_supervisor: "coord_01",
    });
    expect(s2.action_taken).toBe("BLOCK");
    expect(s2.strike_count).toBe(2);

    // Strike 3
    const s3 = executeTurnEndHook({
      agent_id: "impl_escalate",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      parent_supervisor: "coord_01",
    });
    expect(s3.action_taken).toBe("ESCALATE");
    expect(s3.strike_count).toBe(3);
    expect(s3.routing_journey?.escalated).toBe(true);
    expect(s3.routing_journey?.parent_supervisor).toBe("coord_01");
  });

  test("dry_run: true avoids mailbox dispatch whereas live turn-end dispatches interjection", () => {
    // Dry run
    const dryRes = executeTurnEndHook({
      agent_id: "impl_dry",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      dry_run: true,
    });
    expect(dryRes.status).toBe("VIOLATION_DETECTED");
    expect(dryRes.routing_journey).toBeUndefined();

    // Live run
    const liveRes = executeTurnEndHook({
      agent_id: "impl_live",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      dry_run: false,
      parent_supervisor: "coord_01",
    });
    expect(liveRes.status).toBe("VIOLATION_DETECTED");
    expect(liveRes.routing_journey).toBeDefined();
    expect(liveRes.routing_journey?.target_agent).toBe("impl_live");
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

  test("CLI execute sentinel:turn-end rejects invalid role with INVALID_ARGUMENT", async () => {
    let didThrow = false;
    try {
      await execute(["sentinel:turn-end", "--role", "unrecognized_role", "--agent", "impl_01"]);
    } catch (error: unknown) {
      didThrow = true;
      const err = error as { code: string };
      expect(err.code).toBe("INVALID_ARGUMENT");
    }
    expect(didThrow).toBe(true);
  });

  test("CLI execute sentinel:turn-end rejects missing required --agent flag", async () => {
    let didThrow = false;
    try {
      await execute(["sentinel:turn-end", "--role", "implementer"]);
    } catch (error: unknown) {
      didThrow = true;
      const err = error as { code: string };
      expect(["AUTHENTICATION_FAILURE", "INVALID_ARGUMENT"]).toContain(err.code);
    }
    expect(didThrow).toBe(true);
  });

  test("multi-violation turn-end preserves multiple out-of-scope files with actionable remediation", () => {
    const res = executeTurnEndHook({
      agent_id: "impl_multi",
      role: "implementer",
      task_id: "task-multi-01",
      write_scope: ["src/allowed/"],
      modified_files: ["src/forbidden_a.ts", "src/forbidden_b.ts", "src/forbidden_c.ts"],
      parent_supervisor: "coord_01",
    });

    expect(res.status).toBe("VIOLATION_DETECTED");
    expect(res.violations).toHaveLength(3);
    for (const v of res.violations) {
      expect(v.code).toBe("OUT_OF_SCOPE_MODIFICATION");
      expect(v.severity).toBe("CRITICAL");
    }

    const brief = res.markdown_brief !== undefined ? res.markdown_brief : "";
    expect(brief).toContain("git checkout -- src/forbidden_a.ts");
    expect(brief).toContain("git checkout -- src/forbidden_b.ts");
    expect(brief).toContain("git checkout -- src/forbidden_c.ts");
  });

  test("multi-violation turn-end with distinct policy breaches captures all violations in brief", () => {
    const res = executeTurnEndHook({
      agent_id: "val_multi",
      role: "validator",
      task_id: "task-val-multi",
      modified_files: ["src/forbidden_mutation.ts"],
      executed_commands: ["npm test", "git checkout -b new-branch"],
      probe_count: 2,
      action: "task:review",
      parent_supervisor: "coord_01",
    });

    expect(res.status).toBe("VIOLATION_DETECTED");
    expect(res.violations).toHaveLength(3);
    const codes = res.violations.map((v) => v.code);
    expect(codes).toContain("VALIDATOR_SHELL_FORBIDDEN");
    expect(codes).toContain("VALIDATOR_SOURCE_MUTATION");
    expect(codes).toContain("VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS");

    const brief = res.markdown_brief !== undefined ? res.markdown_brief : "";
    expect(brief).toContain("VALIDATOR_SHELL_FORBIDDEN");
    expect(brief).toContain("VALIDATOR_SOURCE_MUTATION");
    expect(brief).toContain("VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS");
    expect(brief).toContain("git checkout -- src/forbidden_mutation.ts");
  });

  test("path traversal in modified_files triggers critical out-of-scope violation", () => {
    const res = executeTurnEndHook({
      agent_id: "impl_traversal",
      role: "implementer",
      task_id: "task-trav-01",
      write_scope: ["src/features/"],
      modified_files: ["../outside/secret.ts"],
      parent_supervisor: "coord_01",
    });

    expect(res.status).toBe("VIOLATION_DETECTED");
    const traversalViolation = res.violations.find((v) => v.target_file === "../outside/secret.ts");
    expect(traversalViolation).toBeDefined();
    if (traversalViolation) {
      expect(traversalViolation.severity).toBe("CRITICAL");
      expect(traversalViolation.code).toBe("OUT_OF_SCOPE_MODIFICATION");
      expect(traversalViolation.message).toContain("outside leased write scope");
    }
  });

  test("post-escalation durability preserves ESCALATE action and frozen status on subsequent turns", () => {
    for (let i = 0; i < 3; i++) {
      executeTurnEndHook({
        agent_id: "impl_durable",
        role: "implementer",
        write_scope: ["src/a.ts"],
        modified_files: ["src/b.ts"],
        parent_supervisor: "coord_01",
      });
    }

    const rec3 = getStrikeRecord("impl_durable");
    expect(rec3 !== null ? rec3.strike_count : 0).toBe(3);
    expect(rec3 !== null ? rec3.frozen : false).toBe(true);

    const postRes = executeTurnEndHook({
      agent_id: "impl_durable",
      role: "implementer",
      write_scope: ["src/a.ts"],
      modified_files: ["src/b.ts"],
      parent_supervisor: "coord_01",
    });

    expect(postRes.status).toBe("VIOLATION_DETECTED");
    expect(postRes.action_taken).toBe("ESCALATE");
    expect(postRes.strike_count).toBeGreaterThanOrEqual(3);

    const recPost = getStrikeRecord("impl_durable");
    expect(recPost !== null ? recPost.frozen : false).toBe(true);
    expect(postRes.routing_journey !== undefined ? postRes.routing_journey.escalated : false).toBe(
      true,
    );
  });
});
