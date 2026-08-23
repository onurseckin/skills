import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import {
  createAgentMetadata,
  writeAgentMetadata,
  readAgentMetadata,
} from "../../../olt/scripts/src/runtime/agent-metadata.ts";
import {
  isPathInScopeList,
  isWithinNeighborhood,
  checkReadScopeAuthorization,
  expandReadScope,
} from "../../../olt/scripts/src/runtime/read-scope-guard.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Runtime Agent Metadata & Read Scope Guard", () => {
  const caller = import.meta.path;

  describe("Agent Metadata Lifecycle", () => {
    it("creates standard agent metadata with default fields", () => {
      const meta = createAgentMetadata({
        agent_id: "imp-task-1",
        role: "implementer",
        tier: 3,
        write_scope: ["src/feature/"],
        allowed_read_scope: ["src/feature/index.ts"],
      });

      expect(meta.agent_id).toBe("imp-task-1");
      expect(meta.role).toBe("implementer");
      expect(meta.tier).toBe(3);
      expect(meta.can_execute_shell).toBe(true);
      expect(meta.write_scope).toEqual(["src/feature/"]);
      expect(meta.allowed_read_scope).toEqual(["src/feature/index.ts"]);
    });

    it("locks shell access for cognitive validator roles", () => {
      const meta = createAgentMetadata({
        agent_id: "val-task-1",
        role: "validator",
      });

      expect(meta.can_execute_shell).toBe(false);
    });

    it("writes and reads agent metadata within isolated scratch directory", () => {
      const scratch = scratchRoot(caller, "metadata-write");
      const meta = createAgentMetadata({
        agent_id: "imp-test-write",
        role: "implementer",
      });

      const writtenPath = writeAgentMetadata(meta, scratch);
      expect(existsSync(writtenPath)).toBe(true);

      const readBack = readAgentMetadata("imp-test-write", scratch);
      expect(readBack).toBeDefined();
      expect(readBack?.agent_id).toBe("imp-test-write");
      expect(readBack?.role).toBe("implementer");
    });
  });

  describe("Read Scope Guard Invariants", () => {
    it("authorizes always accessible global files", () => {
      const meta = createAgentMetadata({
        agent_id: "imp-test",
        role: "implementer",
        write_scope: ["src/core/"],
      });

      expect(checkReadScopeAuthorization(meta, "package.json").authorized).toBe(true);
      expect(checkReadScopeAuthorization(meta, "tsconfig.json").authorized).toBe(true);
      expect(checkReadScopeAuthorization(meta, "bun.lockb").authorized).toBe(true);
      expect(checkReadScopeAuthorization(meta, ".gitignore").authorized).toBe(true);
      expect(checkReadScopeAuthorization(meta, "olt/policy.json").authorized).toBe(true);
    });

    it("authorizes files within assigned write scope", () => {
      const meta = createAgentMetadata({
        agent_id: "imp-test",
        role: "implementer",
        write_scope: ["src/feature/mod.ts"],
      });

      expect(checkReadScopeAuthorization(meta, "src/feature/mod.ts").authorized).toBe(true);
    });

    it("authorizes files within 2-level directory neighborhood", () => {
      const meta = createAgentMetadata({
        agent_id: "imp-test",
        role: "implementer",
        write_scope: ["src/feature/sub/mod.ts"],
      });

      expect(isWithinNeighborhood("src/feature/sub/other.ts", meta.write_scope, 2)).toBe(true);
      expect(isWithinNeighborhood("src/feature/neighbor.ts", meta.write_scope, 2)).toBe(true);
    });

    it("rejects reads outside assigned neighborhood", () => {
      const meta = createAgentMetadata({
        agent_id: "imp-test",
        role: "implementer",
        write_scope: ["src/feature/mod.ts"],
        allowed_read_scope: [],
      });

      const check = checkReadScopeAuthorization(meta, "src/other/deep/nested/other.ts");
      expect(check.authorized).toBe(false);
      expect(check.error_code).toBe("READ_SCOPE_EXCEEDED");
    });

    it("dynamically expands read scope via expandReadScope", () => {
      const scratch = scratchRoot(caller, "scope-expand");
      const meta = createAgentMetadata({
        agent_id: "imp-expand-dynamic",
        role: "implementer",
        write_scope: ["src/feature/mod.ts"],
        allowed_read_scope: [],
      });
      writeAgentMetadata(meta, scratch);

      const expanded = expandReadScope("imp-expand-dynamic", "src/unrelated/other.ts", scratch);
      expect(expanded.success).toBe(true);
      expect(expanded.allowed_read_scope).toContain("src/unrelated/other.ts");

      const checkAfter = checkReadScopeAuthorization(expanded.metadata, "src/unrelated/other.ts");
      expect(checkAfter.authorized).toBe(true);
    });
  });
});
