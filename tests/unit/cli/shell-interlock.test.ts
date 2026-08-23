import { describe, expect, test } from "bun:test";
import { shellCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/shell.ts";
import { scopeExpandCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/scope-expand.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";

describe("CLI Shell Interlock & Read Scope Expansion", () => {
  describe("shellCommand", () => {
    test("instantly blocks un-targeted whole-repo test run for implementer", async () => {
      let thrown: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, ["bun", "test"]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(HarnessError);
      const harnessErr = thrown as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.message).toContain("[INVALID_SCOPE]");
      expect(harnessErr.message).toContain("Un-targeted whole-repo test run detected");
    });

    test("instantly blocks cognitive validator from running any shell commands", async () => {
      let thrown: unknown;
      try {
        await shellCommand({ actor: "val-test", role: "validator" }, {}, ["git", "status"]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(HarnessError);
      const harnessErr = thrown as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toContain("[PERMISSION_DENIED]");
      expect(harnessErr.message).toContain(
        "Cognitive Validators are strictly prohibited from running commands",
      );
    });

    test("executes authorized diagnostic command and outputs cryptographic receipt", async () => {
      const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "echo",
        "harness-shell-ok",
      ]);

      expect(result.exit_code).toBe(0);
      expect(result.command).toBe("echo harness-shell-ok");
      expect(result.receipt_sha256).toBeDefined();
      expect(result.receipt_sha256.length).toBe(64);
      expect(result.markdown).toContain("### Shell Execution Receipt");
      expect(result.markdown).toContain("harness-shell-ok");
    });
  });

  describe("scopeExpandCommand", () => {
    test("expands read scope dynamically and records granted path", () => {
      const result = scopeExpandCommand({
        actor: "imp-expand-test",
        read: "src/policy/repo-policy.ts",
      });

      expect(result.actor).toBe("imp-expand-test");
      expect(result.expanded_path).toBe("src/policy/repo-policy.ts");
      expect(result.allowed_read_scope).toContain("src/policy/repo-policy.ts");
      expect(result.markdown).toContain("### Read Scope Expanded");
    });
  });
});
