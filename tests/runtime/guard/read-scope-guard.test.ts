import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  createAgentMetadata,
  readAgentMetadata,
  writeAgentMetadata,
} from "../../../olt/scripts/src/runtime/index.ts";
import {
  checkReadScopeAuthorization,
  expandReadScope,
  isWithinNeighborhood,
} from "../../../olt/scripts/src/runtime/read-scope-guard.ts";
import { createRuntimeFsHarness, type RuntimeFsHarness } from "../fixtures/runtime-fixture.ts";

describe("Runtime Agent Metadata & Read Scope Guard (in-memory virtualization)", () => {
  let harness: RuntimeFsHarness;

  beforeEach(() => {
    harness = createRuntimeFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

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
      const scratch = "/virtual/runtime/metadata-write";
      const meta = createAgentMetadata({
        agent_id: "imp-test-write",
        role: "implementer",
      });

      const writtenPath = writeAgentMetadata(meta, scratch);
      expect(fs.existsSync(writtenPath)).toBe(true);

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
      const scratch = "/virtual/runtime/scope-expand";
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

    it("retains both concurrent read-scope expansions", async () => {
      const scratch = "/virtual/runtime/scope-expand-concurrent";
      const agentId = "imp-expand-concurrent";
      writeAgentMetadata(
        createAgentMetadata({ agent_id: agentId, role: "implementer", allowed_read_scope: [] }),
        scratch,
      );

      await Promise.all([
        Promise.resolve().then(() => expandReadScope(agentId, "src/concurrent/one.ts", scratch)),
        Promise.resolve().then(() => expandReadScope(agentId, "src/concurrent/two.ts", scratch)),
      ]);

      const stored = readAgentMetadata(agentId, scratch);
      expect(stored?.allowed_read_scope).toContain("src/concurrent/one.ts");
      expect(stored?.allowed_read_scope).toContain("src/concurrent/two.ts");
    });

    it("refuses scope expansion through a hard-linked metadata authority", () => {
      const scratch = "/virtual/runtime/scope-expand-hard-link";
      const agentId = "imp-expand-hard-link";
      const runtime = resolve(scratch, "runtime");
      const targetPath = resolve(runtime, `agent-${agentId}.json`);
      const bytes = JSON.stringify(
        createAgentMetadata({ agent_id: agentId, role: "implementer", allowed_read_scope: [] }),
      );

      harness.files.set(targetPath, bytes);
      harness.dirs.add(scratch);
      harness.dirs.add(runtime);
      harness.fileNlinks.set(targetPath, 2);

      expect(() => expandReadScope(agentId, "src/forbidden.ts", scratch)).toThrow(HarnessError);
    });
  });
});
