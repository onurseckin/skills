import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { executePreActionHook } from "../../../olt/scripts/src/sentinel/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Platform-Independent Sentinel Interlocks & CLI Middleware", () => {
  describe("Task 4: executePreActionHook & Pure In-Harness Interlock Middleware", () => {
    test("executePreActionHook blocks prohibited shell command", () => {
      const res = executePreActionHook({
        agent_id: "val_01",
        role: "validator",
        action_type: "shell_command",
        target: "bun test tests/unit/auth.test.ts",
      });

      expect(res.allowed).toBe(false);
      expect(res.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(res.reason).toContain("restricted from executing terminal commands");
      expect(res.remediation).toBe("Perform review or validation using read-only APIs.");
    });

    test("executePreActionHook blocks prohibited file mutation", () => {
      const res = executePreActionHook({
        agent_id: "coord_01",
        role: "coordinator",
        action_type: "file_write",
        target: "src/main.ts",
      });

      expect(res.allowed).toBe(false);
      expect(res.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(res.reason).toContain("does not hold file write privileges");
      expect(res.remediation).toBe("Delegate implementation tasks to an authorized Implementer.");
    });

    async function assertCliHarnessError(args: string[], expectedSnippet: string): Promise<void> {
      let didThrow = false;
      try {
        await execute(args);
      } catch (error: unknown) {
        didThrow = true;
        expect(error instanceof HarnessError).toBe(true);
        const harnessErr = error as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain(expectedSnippet);
      }
      expect(didThrow).toBe(true);
    }

    test("execute blocks prohibited shell command in CLI middleware with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "val-1",
          "--role",
          "validator",
          "--",
          "bun",
          "test",
          "tests/unit/auth.test.ts",
        ],
        "restricted from executing terminal commands",
      );
    });

    test("execute blocks prohibited file mutation in CLI middleware with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        ["shell", "--actor", "coord-1", "--role", "coordinator", "--", "touch", "src/index.ts"],
        "does not hold file write privileges",
      );
    });

    test("execute blocks file mutation outside leased write scope with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "imp-1",
          "--role",
          "implementer",
          "--write-scope",
          "src/features/login.ts",
          "--",
          "touch",
          "src/other/secrets.ts",
        ],
        "falls outside the leased write scope",
      );
    });

    test("execute blocks agent:register when Mind attempts to spawn Implementer directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "worker-1",
          "--role",
          "implementer",
          "--host",
          "claude-code",
          "--parent-agent",
          "mind",
        ],
        "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
      );
    });

    test("execute blocks agent:register when Orchestrator attempts to spawn Implementer directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "worker-1",
          "--role",
          "implementer",
          "--host",
          "claude-code",
          "--parent-agent",
          "orchestrator",
        ],
        "Tier 1 Orchestrator must only dispatch Tier 2 Coordinator; direct Tier 3 worker dispatch is prohibited.",
      );
    });

    test("execute blocks agent:register when Mind attempts to spawn Coordinator directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "coord-1",
          "--role",
          "coordinator",
          "--host",
          "claude-code",
          "--parent-agent",
          "mind",
        ],
        "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
      );
    });

    test("execute blocks detached background subshells with rogue tokens", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "imp-1",
          "--role",
          "implementer",
          "--",
          "nohup",
          "bun",
          "run",
          "server.ts",
          "&",
        ],
        "Detached processes and unmonitored background subshells",
      );
    });
  });
});
