import { describe, expect, test } from "bun:test";
import { shellCommand } from "../../../olt/scripts/src/cli/commands/shell.ts";
import { scopeExpandCommand } from "../../../olt/scripts/src/cli/commands/scope-expand.ts";
import {
  checkReadScopeAuthorization,
  isWithinNeighborhood,
} from "../../../olt/scripts/src/runtime/read-scope-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";

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

    test("instantly blocks unshielded subshells and chaining attempts", async () => {
      let thrownSh: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
          "sh",
          "-c",
          "bun test",
        ]);
      } catch (err) {
        thrownSh = err;
      }
      expect(thrownSh).toBeInstanceOf(HarnessError);
      expect((thrownSh as HarnessError).message).toContain("[UNSHIELDED_COMMAND_BLUNDER]");

      let thrownChain: unknown;
      try {
        await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
          "git",
          "status",
          "&&",
          "git",
          "push",
        ]);
      } catch (err) {
        thrownChain = err;
      }
      expect(thrownChain).toBeInstanceOf(HarnessError);
      expect((thrownChain as HarnessError).message).toContain("[UNSHIELDED_COMMAND_BLUNDER]");
    });

    test("executes authorized diagnostic command and outputs cryptographic receipt with evidence file", async () => {
      const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "echo",
        "harness-shell-ok",
      ]);

      expect(result.exit_code).toBe(0);
      expect(result.command).toBe("echo harness-shell-ok");
      expect(result.receipt_sha256).toBeDefined();
      expect(result.receipt_sha256.length).toBe(64);
      expect(result.evidence_path).toBeDefined();
      expect(result.markdown).toContain("### Shell Execution Receipt");
      expect(result.markdown).toContain("harness-shell-ok");
      expect(result.markdown).toContain("Cryptographic Receipt SHA-256");
      expect(result.markdown).toContain("Evidence Receipt Path");
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

  describe("read-scope-guard invariants", () => {
    test("prevents unbounded root crossover in isWithinNeighborhood", () => {
      // Disjoint top-level directories: common === 0
      const isNeighborDisjoint = isWithinNeighborhood("docs/plan-92.md", ["src/foo.ts"], 2);
      expect(isNeighborDisjoint).toBe(false);

      const isNeighborTools = isWithinNeighborhood(
        "tools/audit.sh",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborTools).toBe(false);

      // Shared top-level directory: common >= 1
      const isNeighborPolicy = isWithinNeighborhood(
        "src/runtime/agent-metadata.ts",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborPolicy).toBe(true);

      // Deep subtree exceeding max depth
      const isNeighborDeep = isWithinNeighborhood(
        "src/a/b/c/d/deep.ts",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborDeep).toBe(false);
    });

    test("intercepts path traversal outside repository root with PATH_SAFETY", () => {
      const actor = {
        agent_id: "imp-test",
        role: "implementer",
        tier: 3,
        write_scope: ["src/foo.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resEsc = checkReadScopeAuthorization(actor, "../../other-dir/shared/secret.json");
      expect(resEsc.authorized).toBe(false);
      expect(resEsc.error_code).toBe("PATH_SAFETY");
      expect(resEsc.message).toContain("[PATH_SAFETY]");
    });

    test("authorizes always-accessible global project files and in-scope files", () => {
      const actor = {
        agent_id: "imp-test",
        role: "implementer",
        tier: 3,
        write_scope: ["src/policy/repo-policy.ts"],
        allowed_read_scope: [],
        can_execute_shell: true,
        spawned_at: new Date().toISOString(),
      };

      const resPkg = checkReadScopeAuthorization(actor, "package.json");
      expect(resPkg.authorized).toBe(true);

      const resPolicy = checkReadScopeAuthorization(actor, "olt/policy.json");
      expect(resPolicy.authorized).toBe(true);

      const resTypes = checkReadScopeAuthorization(actor, "src/types/index.ts");
      expect(resTypes.authorized).toBe(true);
    });
  });
});
