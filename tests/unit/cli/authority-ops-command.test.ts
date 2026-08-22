import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/** plan:compile derives every requirement actionable, so a needs_authority requirement is seeded
 *  directly rather than produced through the compiler. */
function gateRequirement(run: string, requirementId: string): void {
  transact(run, "test-setup", "requirement-gated-for-test", {}, (draft) => {
    const document = (draft.requirements ?? {}) as JsonObject;
    const list = (document.requirements ?? []) as JsonObject[];
    const requirement = list.find((entry) => entry.id === requirementId);
    if (!requirement) throw new Error(`requirement ${requirementId} not found`);
    requirement.disposition = "needs_authority";
  });
}

describe("authority:decide", () => {
  test("grants a needs_authority requirement and records the decision", async () => {
    const { run } = await setupCompiledRun("authority-cmd-grant", roots);
    gateRequirement(run, "req-core");

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-core",
      "--actor",
      "coordinator",
      "--decision",
      "grant",
      "--rationale",
      "The user approved this in the review thread.",
    ]);
    expect(String(decided.markdown)).toContain("### Authority Decision Recorded: `req-core`");
    expect(String(decided.markdown)).toContain("- **Decision**: GRANT");
    expect(decided.run_root).toBe(run);
    const requirement = decided.requirement as { disposition: string; authority_status: string };
    expect(requirement.disposition).toBe("needs_authority");
    expect(requirement.authority_status).toBe("granted");

    const persisted = loadRun(run).state.requirements as JsonObject;
    const list = persisted.requirements as JsonObject[];
    const stored = list.find((entry) => entry.id === "req-core") as JsonObject;
    expect(stored.authority_status).toBe("granted");
  });

  test("declines a needs_authority requirement and records the rationale", async () => {
    const { run } = await setupCompiledRun("authority-cmd-decline", roots);
    gateRequirement(run, "req-core");

    const decided = await execute([
      "authority:decide",
      "--run",
      run,
      "--requirement",
      "req-core",
      "--actor",
      "coordinator",
      "--decision",
      "decline",
      "--rationale",
      "Out of scope for this run.",
    ]);
    expect(String(decided.markdown)).toContain("- **Decision**: DECLINE");
    expect(String(decided.markdown)).toContain("- **Rationale**: Out of scope for this run.");
    const requirement = decided.requirement as { authority_status: string };
    expect(requirement.authority_status).toBe("declined");
  });

  test("rejects a decision value that is neither grant nor decline", async () => {
    const { run } = await setupCompiledRun("authority-cmd-invalid", roots);
    gateRequirement(run, "req-core");

    await expect(
      execute([
        "authority:decide",
        "--run",
        run,
        "--requirement",
        "req-core",
        "--actor",
        "coordinator",
        "--decision",
        "maybe",
        "--rationale",
        "Not a real decision.",
      ]),
    ).rejects.toThrow("--decision must be grant or decline");
  });
});

describe("Mechanical Role Confinement in task:claim", () => {
  test("strictly blocks Orchestrator role from claiming code tasks", async () => {
    const { run } = await setupCompiledRun("role-confinement-orch-role", roots);

    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "req-core",
        "--agent",
        "worker-1",
        "--role",
        "orchestrator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string; fix?: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Orchestrators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
      expect(error.fix).toBe("Dispatch Tier 3 Implementers via invoke_subagent.");
    }
  });

  test("strictly blocks orch-* agent id from claiming code tasks", async () => {
    const { run } = await setupCompiledRun("role-confinement-orch-agent", roots);

    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "req-core",
        "--agent",
        "orch-pulse-master",
        "--role",
        "implementer",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string; fix?: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Orchestrators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }
  });

  test("strictly blocks Coordinator role from claiming code tasks", async () => {
    const { run } = await setupCompiledRun("role-confinement-coord-role", roots);

    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "req-core",
        "--agent",
        "worker-2",
        "--role",
        "coordinator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string; fix?: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Coordinators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
      expect(error.fix).toBe("Dispatch Tier 3 Implementers via invoke_subagent.");
    }
  });

  test("strictly blocks coord-* agent id from claiming code tasks", async () => {
    const { run } = await setupCompiledRun("role-confinement-coord-agent", roots);

    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        "req-core",
        "--agent",
        "coord-domain-backend",
        "--role",
        "implementer",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string; fix?: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Coordinators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }
  });
});
