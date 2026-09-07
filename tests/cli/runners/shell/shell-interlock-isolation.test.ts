import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { scopeExpandCommand } from "../../../../olt/scripts/src/cli/commands/scope-expand.ts";
import {
  checkReadScopeAuthorization,
  isWithinNeighborhood,
} from "../../../../olt/scripts/src/runtime/read-scope-guard.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";

describe("CLI Shell Interlock - Scope Expansion & Isolation", () => {
  beforeEach(() => {
    enableInMemoryAgentMetadata();
  });

  afterEach(() => {
    disableInMemoryAgentMetadata();
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
      const isNeighborDisjoint = isWithinNeighborhood("docs/plan-92.md", ["src/foo.ts"], 2);
      expect(isNeighborDisjoint).toBe(false);

      const isNeighborTools = isWithinNeighborhood(
        "tools/audit.sh",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborTools).toBe(false);

      const isNeighborPolicy = isWithinNeighborhood(
        "src/runtime/index.ts",
        ["src/policy/repo-policy.ts"],
        2,
      );
      expect(isNeighborPolicy).toBe(true);

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
