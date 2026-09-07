import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { assertMutationInterlock } from "../../../../olt/scripts/src/workflow/lease/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("Workflow Mutation Interlock Gate", () => {
  let sandboxDir: string;
  let capsuleDir: string;
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let sc = 0;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    sandboxDir = `/virtual/tmp/mutation-interlock-${++sc}`;
    capsuleDir = join(sandboxDir, ".olt", "capsules", "run-interlock-test-1");
    vfs.mkdirSync(capsuleDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
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
      vfs.writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

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
