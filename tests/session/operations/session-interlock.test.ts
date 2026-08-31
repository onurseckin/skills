import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  assertActiveCapsuleLease,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
  requireTurn1Registration,
  registerInMemorySessionGrant,
  type SessionIdentity,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Session Capsule Interlock & Turn 1 Registration", () => {
  const capsuleDir = "/virtual/capsules/run-session-interlock-1";

  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
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
      const emptyRun = "/virtual/capsules/uninitialized-run";
      expect(() => assertActiveCapsuleLease(emptyRun, "impl-1")).toThrow(HarnessError);
    });

    it("rejects when capsule state.json is corrupted", () => {
      setInMemorySessionData(`${capsuleDir}/state.json`, "{invalid-json");
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-1")).toThrow(HarnessError);
    });

    it("rejects agent with no active grant in capsule state", () => {
      const state = { schema_version: 1, run_id: "run-session-interlock-1", tasks: {}, agents: [] };
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));
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
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));
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
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-active")).not.toThrow();
    });

    it("authorizes agent holding valid active task lease", () => {
      const future = new Date(Date.now() + 600000).toISOString();
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
        agents: [],
        tasks: {
          "task-1": {
            lease: {
              agent_id: "impl-leased",
              expires_at: future,
            },
          },
        },
      };
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-leased")).not.toThrow();
    });

    it("rejects agent holding expired task lease", () => {
      const past = new Date(Date.now() - 600000).toISOString();
      const state = {
        schema_version: 1,
        run_id: "run-session-interlock-1",
        agents: [],
        tasks: {
          "task-expired": {
            lease: {
              agent_id: "impl-expired",
              expires_at: past,
            },
          },
        },
      };
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));
      expect(() => assertActiveCapsuleLease(capsuleDir, "impl-expired")).toThrow(HarnessError);
    });
  });

  describe("requireTurn1Registration", () => {
    it("rejects null or undefined session identity", () => {
      const invalid = null as unknown as SessionIdentity;
      expect(() => requireTurn1Registration(invalid)).toThrow(HarnessError);
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
      const uninitDir = "/virtual/capsules/uninitialized-capsule";
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
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify({ schema_version: 1 }));
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
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify({ schema_version: 1 }));
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
      setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));

      const registered = registerInMemorySessionGrant({
        runRoot: "/virtual/repo",
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
