import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  assertActiveCapsuleLease,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
  requireTurn1Registration,
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
    const validSession: SessionIdentity = {
      agent_id: "agent-interlock-1",
      role: "implementer",
      token: "tok_turn1_valid",
      can_execute_shell: true,
      can_edit_files: true,
      tier: 3,
      host: "antigravity",
    };

    it("passes validation on valid turn 1 matching registered session", () => {
      expect(() =>
        requireTurn1Registration({
          session: validSession,
          expectedAgentId: "agent-interlock-1",
          turn: 1,
        }),
      ).not.toThrow();
    });

    it("throws HarnessError on turn 1 identity mismatch", () => {
      expect(() =>
        requireTurn1Registration({
          session: validSession,
          expectedAgentId: "agent-mismatch",
          turn: 1,
        }),
      ).toThrow(HarnessError);
    });

    it("throws HarnessError when session is missing on turn 1", () => {
      expect(() =>
        requireTurn1Registration({
          session: null,
          expectedAgentId: "agent-interlock-1",
          turn: 1,
        }),
      ).toThrow(HarnessError);
    });

    it("passes without session if turn is greater than 1", () => {
      expect(() =>
        requireTurn1Registration({
          session: null,
          expectedAgentId: "agent-interlock-1",
          turn: 2,
        }),
      ).not.toThrow();
    });
  });
});
