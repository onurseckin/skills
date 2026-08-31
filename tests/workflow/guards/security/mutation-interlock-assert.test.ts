import { describe, expect, it, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMutationInterlock,
  verifyMutationInterlock,
} from "../../../../olt/scripts/src/workflow/lease/index.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Workflow Mutation Interlock Gate", () => {
  let sandboxDir: string;
  let capsuleDir: string;

  beforeEach(() => {
    sandboxDir = mkdtempSync(join(tmpdir(), "mutation-interlock-"));
    capsuleDir = join(sandboxDir, ".olt", "capsules", "run-interlock-test-1");
    mkdirSync(capsuleDir, { recursive: true });
  });

  describe("assertMutationInterlock", () => {
    it("throws HarnessError on denied mutations and succeeds on authorized mutations", () => {
      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {},
        agents: [
          {
            id: "impl-assert",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "val-assert",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      expect(() => assertMutationInterlock(capsuleDir, "impl-assert")).not.toThrow();

      expect(() => assertMutationInterlock(capsuleDir, "val-assert")).toThrow(HarnessError);
      try {
        assertMutationInterlock(capsuleDir, "val-assert");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }

      expect(() => assertMutationInterlock(capsuleDir, "ghost")).toThrow(HarnessError);
      try {
        assertMutationInterlock(capsuleDir, "ghost");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("PERMISSION_DENIED");
      }
    });
  });
});
