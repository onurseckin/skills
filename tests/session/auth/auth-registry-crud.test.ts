import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  registerSessionGrant,
  stageSessionGrant,
  rollbackStagedSessionGrant,
  setSessionLockCleanupFailureForTesting,
  setSessionPersistenceObserverForTesting,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  getInMemorySessionData,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Authority Session Registry - CRUD & Permissions", () => {
  const sandboxDir = "/virtual/capsules/registry-crud";

  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
  });

  it("registers session grant and binds PID and PPID registry files", () => {
    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-core",
      role: "implementer",
      pid: 12345,
      ppid: 12344,
      taskId: "mod_core",
      writeScope: ["olt/scripts/src/core"],
    });

    expect(session.agent_id).toBe("impl-core");
    expect(session.role).toBe("implementer");
    expect(session.tier).toBe(3);
    expect(session.can_execute_shell).toBe(true);
    expect(session.can_edit_files).toBe(true);
    expect(session.token).toStartWith("tok_live_");
  });

  it("does not let shared-PPID loser compensation delete winner session bytes", () => {
    const staged = stageSessionGrant({
      runRoot: sandboxDir,
      agentId: "staged-agent",
      role: "implementer",
      customToken: "tok_staged",
      pid: 12355,
      ppid: 12354,
    });
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "newer-agent",
      role: "implementer",
      customToken: "tok_newer",
      pid: 12356,
      ppid: 12354,
    });

    rollbackStagedSessionGrant(staged);

    for (const id of [12356, 12354]) {
      const data = getInMemorySessionData(`${sandboxDir}/.olt/.sessions/${id}.json`);
      if (data) {
        expect(data).toContain("tok_newer");
      }
    }
  });

  it("rejects traversal-shaped agent identities before creating any process session record", () => {
    expect(() =>
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "../escape",
        role: "implementer",
        pid: 74321,
        ppid: 74320,
      }),
    ).toThrow(HarnessError);
  });

  it("uses one PID record when pid equals ppid and durably orders fsync, rename, then directory fsync", () => {
    const seen: string[] = [];
    const restore = setSessionPersistenceObserverForTesting((step) => seen.push(step));
    try {
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "impl-same-pid",
        role: "implementer",
        pid: 81261,
        ppid: 81261,
      });
    } finally {
      restore();
    }
    expect(seen).toEqual(["file-fsync", "rename", "directory-fsync"]);
  });

  for (const cleanupFault of [undefined, null]) {
    it(`preserves the primary persistence error when cleanup throws ${String(cleanupFault)}`, () => {
      const primary = new Error("primary durable failure");
      const restoreWrite = setSessionPersistenceObserverForTesting(() => {
        throw primary;
      });
      const restoreCleanup = setSessionLockCleanupFailureForTesting(cleanupFault);
      try {
        expect(() =>
          registerSessionGrant({
            runRoot: sandboxDir,
            agentId: `impl-cleanup-${String(cleanupFault)}`,
            role: "implementer",
            pid: cleanupFault === null ? 81271 : 81272,
            ppid: cleanupFault === null ? 81270 : 81273,
          }),
        ).toThrow("primary durable failure");
      } finally {
        restoreCleanup();
        restoreWrite();
      }
    });
  }

  it("registers session grant with customToken, runRoot runtime dir, and host override", () => {
    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "agent-custom",
      role: "planner",
      customToken: "tok_custom_123456789",
      host: "custom_ide",
    });

    expect(session.token).toBe("tok_custom_123456789");
    expect(session.host).toBe("custom_ide");
    expect(session.tier).toBe(3);
  });

  it("infers permission grants accurately across all role classifications", () => {
    const cognitiveRoles = [
      "validator",
      "cognitive-validator",
      "cognitive_validator",
      "validator-code-quality",
      "critic",
      "completeness-critic",
      "completeness_critic",
      "plan-validator",
      "plan_validator",
      "sub-investigator",
    ];

    for (const role of cognitiveRoles) {
      const s = registerSessionGrant({
        runRoot: sandboxDir,
        agentId: `test-${role}`,
        role,
      });
      expect(s.can_execute_shell).toBe(true);
      expect(s.can_edit_files).toBe(false);
    }

    const supervisoryRoles = [
      "mind",
      "orchestrator",
      "coordinator",
      "meta-auditor",
      "meta_auditor",
    ];

    for (const role of supervisoryRoles) {
      const s = registerSessionGrant({
        runRoot: sandboxDir,
        agentId: `test-${role}`,
        role,
      });
      expect(s.can_execute_shell).toBe(true);
      expect(s.can_edit_files).toBe(false);
    }

    const workerRoles = ["implementer", "repairer", "sub-implementer", "worker"];
    for (const role of workerRoles) {
      const s = registerSessionGrant({
        runRoot: sandboxDir,
        agentId: `test-${role}`,
        role,
      });
      expect(s.can_execute_shell).toBe(true);
      expect(s.can_edit_files).toBe(true);
    }
  });
});
