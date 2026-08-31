import { describe, expect, it, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMutationInterlock,
  verifyMutationInterlock,
} from "../../../olt/scripts/src/workflow/lease/index.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Workflow Mutation Interlock Gate", () => {
  let sandboxDir: string;
  let capsuleDir: string;

  beforeEach(() => {
    sandboxDir = scratchRoot(import.meta.path, "workflow-mutation-interlock");
    capsuleDir = join(sandboxDir, ".olt", "capsules", "run-interlock-test-1");
    mkdirSync(capsuleDir, { recursive: true });
  });

  describe("verifyMutationInterlock", () => {
    it("rejects empty runId or agentId", () => {
      const res1 = verifyMutationInterlock("", "impl-1");
      expect(res1.allowed).toBe(false);
      expect(res1.reason).toContain("runId is required");

      const res2 = verifyMutationInterlock(capsuleDir, "");
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toContain("agentId is required");
    });

    it("rejects when capsule state.json is not found on disk", () => {
      const missingRun = join(sandboxDir, "nonexistent-run");
      const res = verifyMutationInterlock(missingRun, "impl-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("capsule state not found");
    });

    it("rejects when capsule state.json contains corrupted JSON", () => {
      writeFileSync(join(capsuleDir, "state.json"), "invalid json {", "utf8");
      const res = verifyMutationInterlock(capsuleDir, "impl-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("failed to read capsule state");
    });

    it("blocks cognitive validator roles with role confinement violation", () => {
      const validatorRoles = [
        "validator",
        "completeness-critic",
        "plan-validator",
        "mechanic-validator",
        "sub-validator",
        "sub-investigator",
        "skill-auditor",
        "mind-auditor",
      ];

      for (const role of validatorRoles) {
        const state = {
          schema_version: 1,
          run_id: "run-interlock-test-1",
          tasks: {},
          agents: [
            {
              id: `agent-${role}`,
              role,
              parent_agent_id: null,
              parent_task_id: null,
              host: "test-host",
              granted_at: new Date().toISOString(),
              status: "active",
            },
          ],
        };
        writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

        const res = verifyMutationInterlock(capsuleDir, `agent-${role}`, "file:edit");
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain("ROLE_CONFINEMENT_VIOLATION");
      }
    });

    it("rejects agent with released grant", () => {
      const stateReleased = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {},
        agents: [
          {
            id: "impl-released",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
            status: "released",
            released_at: new Date().toISOString(),
            release_reason: "finished",
          },
        ],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(stateReleased), "utf8");

      const resReleased = verifyMutationInterlock(capsuleDir, "impl-released");
      expect(resReleased.allowed).toBe(false);
      expect(resReleased.reason).toContain("has been released");
    });

    it("rejects unleased agent not present in ledger or tasks", () => {
      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {},
        agents: [],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      const res = verifyMutationInterlock(capsuleDir, "ghost-agent");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("holds no active grant or task lease");
    });

    it("authorizes ungranted agent that holds an active unexpired task lease", () => {
      const future = new Date(Date.now() + 600000).toISOString();
      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            lease: { agent_id: "leased-worker", expires_at: future },
          },
        },
        agents: [],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      const res = verifyMutationInterlock(capsuleDir, "leased-worker");
      expect(res.allowed).toBe(true);
    });

    it("authorizes active implementer holding active grant", () => {
      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {},
        agents: [
          {
            id: "impl-active",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      const res = verifyMutationInterlock(capsuleDir, "impl-active", "file:edit");
      expect(res.allowed).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it("validates specific task lease with token, lease holder, and expiration check", () => {
      const token = "tok_secret_task_123";
      const digest = tokenDigest(token);
      const future = new Date(Date.now() + 600000).toISOString();
      const past = new Date(Date.now() - 600000).toISOString();

      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {
          "task-active": {
            id: "task-active",
            status: "leased",
            requirement_ids: [],
            attempts: [],
            history: [],
            lease: { agent_id: "impl-task", token_digest: digest, expires_at: future },
          },
          "task-other-agent": {
            id: "task-other-agent",
            status: "leased",
            requirement_ids: [],
            attempts: [],
            history: [],
            lease: { agent_id: "other-agent", token_digest: digest, expires_at: future },
          },
          "task-no-lease": {
            id: "task-no-lease",
            status: "ready",
          },
          "task-expired": {
            id: "task-expired",
            status: "leased",
            requirement_ids: [],
            attempts: [],
            history: [],
            lease: { agent_id: "impl-task", token_digest: digest, expires_at: past },
          },
        },
        agents: [],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      const resValid = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-active",
        token,
      });
      expect(resValid.allowed).toBe(true);

      const resNoTask = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-nonexistent",
      });
      expect(resNoTask.allowed).toBe(false);
      expect(resNoTask.reason).toContain("has no active lease");

      const resNoLease = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-no-lease",
      });
      expect(resNoLease.allowed).toBe(false);
      expect(resNoLease.reason).toContain("has no active lease");

      const resWrongAgent = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-other-agent",
      });
      expect(resWrongAgent.allowed).toBe(false);
      expect(resWrongAgent.reason).toContain("lease held by 'other-agent', not 'impl-task'");

      const resMismatch = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-active",
        token: "tok_wrong",
      });
      expect(resMismatch.allowed).toBe(false);
      expect(resMismatch.reason).toContain("token mismatch");

      const resExpired = verifyMutationInterlock(capsuleDir, "impl-task", {
        taskId: "task-expired",
        token,
      });
      expect(resExpired.allowed).toBe(false);
      expect(resExpired.reason).toContain("LEASE_EXPIRED");
    });

    it("enforces write scope restrictions on target files", () => {
      const state = {
        schema_version: 1,
        run_id: "run-interlock-test-1",
        tasks: {},
        agents: [
          {
            id: "impl-scoped",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");

      const allowedRes = verifyMutationInterlock(capsuleDir, "impl-scoped", {
        targetFile: "olt/scripts/src/workflow/lease/mutation-interlock.ts",
        writeScope: ["olt/scripts/src/workflow/lease/"],
      });
      expect(allowedRes.allowed).toBe(true);

      const deniedRes = verifyMutationInterlock(capsuleDir, "impl-scoped", {
        targetFile: "docs/planning/unauthorized.md",
        writeScope: ["olt/scripts/src/workflow/lease/"],
      });
      expect(deniedRes.allowed).toBe(false);
      expect(deniedRes.reason).toContain("outside write scope");
    });
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
