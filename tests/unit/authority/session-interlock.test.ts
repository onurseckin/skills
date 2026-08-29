import { describe, expect, it, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertActiveCapsuleLease,
  registerSessionGrant,
  requireTurn1Registration,
  type SessionIdentity,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Session Capsule Interlock & Turn 1 Registration", () => {
  let sandboxDir: string;
  let capsuleDir: string;

  beforeEach(() => {
    sandboxDir = scratchRoot(import.meta.path, "session-interlock-test");
    capsuleDir = join(sandboxDir, ".olt", "capsules", "run-session-interlock-1");
    mkdirSync(capsuleDir, { recursive: true });
    mkdirSync(join(sandboxDir, ".olt", ".sessions"), { recursive: true });
  });

  describe("assertActiveCapsuleLease", () => {
    it("rejects empty or whitespace runRoot", () => {
      expect(() => assertActiveCapsuleLease("", "impl-1")).toThrow(HarnessError);
      expect(() => assertActiveCapsuleLease("   ", "impl-1")).toThrow(HarnessError);
    });

    it("rejects traversal or unsafe agentId", () => {
      expect(() => assertActiveCapsuleLease(capsuleDir, "../escape")).toThrow(HarnessError);
      expect(() => assertActiveCapsuleLease(capsuleDir, "")).toThrow(HarnessError);
    });

    it("rejects when capsule state.json is missing", () => {
      const emptyRun = join(sandboxDir, ".olt", "capsules", "uninitialized-run");
      mkdirSync(emptyRun, { recursive: true });
      expect(() => assertActiveCapsuleLease(emptyRun, "impl-1")).toThrow(HarnessError);
    });

    it("rejects when capsule state.json is corrupted", () => {
      writeFileSync(join(capsuleDir, "state.json"), "{invalid-json", "utf8");
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-1")).toThrow(HarnessError);
    });

    it("rejects agent with no active grant in capsule state", () => {
      const state = { schema_version: 1, run_id: "run-session-interlock-1", tasks: {}, agents: [] };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");
      expect(() => assertActiveCapsuleLease(capsuleDir, "unregistered-agent")).toThrow(
        HarnessError,
      );
    });

    it("rejects agent whose grant is released", () => {
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
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
            release_reason: "work completed",
          },
        ],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-released")).toThrow(HarnessError);
    });

    it("authorizes agent with active grant in agent ledger", () => {
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
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
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-active")).not.toThrow();
    });

    it("authorizes agent holding valid active task lease", () => {
      const future = new Date(Date.now() + 600000).toISOString();
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            requirement_ids: [],
            attempts: [],
            history: [],
            lease: { agent_id: "impl-leased", token_digest: "hash_abc", expires_at: future },
          },
        },
        agents: [],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-leased")).not.toThrow();
    });

    it("rejects agent with expired task lease and no active grant", () => {
      const past = new Date(Date.now() - 600000).toISOString();
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            requirement_ids: [],
            attempts: [],
            history: [],
            lease: { agent_id: "impl-expired", token_digest: "hash_abc", expires_at: past },
          },
        },
        agents: [],
      };
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf8");
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-expired")).toThrow(HarnessError);
    });
  });

  describe("requireTurn1Registration", () => {
    it("rejects null or undefined session identity", () => {
      expect(() => requireTurn1Registration(null as unknown as SessionIdentity)).toThrow(
        HarnessError,
      );
    });

    it("rejects unauthenticated session token", () => {
      const session: SessionIdentity = {
        agent_id: "impl-1",
        role: "implementer",
        tier: 3,
        token: "unauthenticated",
        pid: 100,
        ppid: 101,
        run_id: capsuleDir,
        can_execute_shell: true,
        can_edit_files: true,
        host: "test-host",
        mechanisms_detected: ["process_ancestry_pid_100"],
        granted_at: new Date().toISOString(),
      };
      expect(() => requireTurn1Registration(session)).toThrow(HarnessError);
    });

    it("rejects missing run_id", () => {
      const session: SessionIdentity = {
        agent_id: "impl-1",
        role: "implementer",
        tier: 3,
        token: "tok_valid_123",
        pid: 100,
        ppid: 101,
        can_execute_shell: true,
        can_edit_files: true,
        host: "test-host",
        mechanisms_detected: ["process_ancestry_pid_100"],
        granted_at: new Date().toISOString(),
      };
      expect(() => requireTurn1Registration(session)).toThrow(HarnessError);
    });

    it("rejects uninitialized capsule state on disk", () => {
      const uninitDir = join(sandboxDir, ".olt", "capsules", "uninitialized-capsule");
      mkdirSync(uninitDir, { recursive: true });

      const session: SessionIdentity = {
        agent_id: "impl-1",
        role: "implementer",
        tier: 3,
        token: "tok_valid_123",
        pid: 100,
        ppid: 101,
        run_id: uninitDir,
        can_execute_shell: true,
        can_edit_files: true,
        host: "test-host",
        mechanisms_detected: ["process_ancestry_pid_100"],
        granted_at: new Date().toISOString(),
      };
      expect(() => requireTurn1Registration(session)).toThrow(HarnessError);
    });

    it("rejects session relying solely on interactive terminal fallback", () => {
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify({ schema_version: 1 }), "utf8");
      const session: SessionIdentity = {
        agent_id: "impl-1",
        role: "implementer",
        tier: 3,
        token: "tok_valid_123",
        pid: 100,
        ppid: 101,
        run_id: capsuleDir,
        can_execute_shell: true,
        can_edit_files: true,
        host: "test-host",
        mechanisms_detected: ["interactive_terminal_fallback"],
        granted_at: new Date().toISOString(),
      };
      expect(() => requireTurn1Registration(session)).toThrow(HarnessError);
    });

    it("passes for durably registered session with initialized capsule state", () => {
      writeFileSync(join(capsuleDir, "state.json"), JSON.stringify({ schema_version: 1 }), "utf8");
      const session: SessionIdentity = {
        agent_id: "impl-registered",
        role: "implementer",
        tier: 3,
        token: "tok_valid_registered",
        pid: 100,
        ppid: 101,
        run_id: capsuleDir,
        can_execute_shell: true,
        can_edit_files: true,
        host: "test-host",
        mechanisms_detected: ["workspace_directory_session"],
        granted_at: new Date().toISOString(),
      };
      expect(() => requireTurn1Registration(session)).not.toThrow();
    });
  });

  describe("End-to-End Interlock Workflow", () => {
    it("validates registration and lease continuity across grant and resolver gates", () => {
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
        tasks: {},
        agents: [
          {
            id: "worker-01",
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

      const registered = registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "worker-01",
        role: "implementer",
        pid: 61001,
        ppid: 61000,
      });

      const sessionWithCapsule: SessionIdentity = {
        ...registered,
        run_id: capsuleDir,
      };

      expect(registered.agent_id).toBe("worker-01");
      expect(() => requireTurn1Registration(sessionWithCapsule)).not.toThrow();
      expect(() => assertActiveCapsuleLease(capsuleDir, "worker-01")).not.toThrow();
    });
  });
});
