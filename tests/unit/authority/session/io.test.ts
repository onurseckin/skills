import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  clearInMemorySessionStore,
  deleteInMemorySessionData,
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  formatSafeErrorCause,
  getInMemorySessionData,
  getInMemorySessionStore,
  inferCanExecute,
  isInMemorySessionStoreEnabled,
  readOwnDataString,
  readPersistedSession,
  restoreSnapshotIfUnchanged,
  secureReadSession,
  setInMemorySessionData,
  snapshotSession,
  withSessionAuthorityLock,
  atomicSessionWrite,
} from "../../../../olt/scripts/src/authority/session/io.ts";
import {
  assertActiveCapsuleLease,
  pruneStaleSessions,
  registerInMemorySessionGrant,
  revokeSessionGrant,
  rollbackStagedSessionGrant,
  stageSessionGrant,
} from "../../../../olt/scripts/src/authority/session/grants.ts";
import {
  setSessionLockCleanupFailureForTesting,
  setSessionPersistenceObserverForTesting,
} from "../../../../olt/scripts/src/authority/session/testing-hooks.ts";

describe("Authority Session IO & In-Memory Storage Management", () => {
  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
  });

  it("manages in-memory session store lifecycle", () => {
    expect(isInMemorySessionStoreEnabled()).toBe(true);
    expect(getInMemorySessionStore()).toBeDefined();

    setInMemorySessionData("/virtual/sessions/100.json", '{"agent_id":"agent-100"}');
    expect(getInMemorySessionData("/virtual/sessions/100.json")).toBe('{"agent_id":"agent-100"}');
    expect(deleteInMemorySessionData("/virtual/sessions/100.json")).toBe(true);
    expect(getInMemorySessionData("/virtual/sessions/100.json")).toBeUndefined();
    expect(deleteInMemorySessionData("/missing")).toBe(false);

    setInMemorySessionData("/virtual/sessions/200.json", '{"agent_id":"agent-200"}');
    clearInMemorySessionStore();
    expect(getInMemorySessionData("/virtual/sessions/200.json")).toBeUndefined();

    disableInMemorySessionStore();
    expect(isInMemorySessionStoreEnabled()).toBe(false);
  });

  it("writes and securely reads sessions in-memory with lifecycle observer", () => {
    const steps: string[] = [];
    const restore = setSessionPersistenceObserverForTesting((step) => steps.push(step));
    try {
      const path = "/virtual/sessions/12345.json";
      const payload = JSON.stringify({ agent_id: "agent-12345", role: "implementer" });
      atomicSessionWrite(path, payload);

      expect(steps).toEqual(["file-fsync", "rename", "directory-fsync"]);
      expect(secureReadSession(path)).toBe(payload);
      expect(() => secureReadSession("/virtual/sessions/absent.json")).toThrow();
    } finally {
      restore();
    }
  });

  it("snapshots and restores in-memory sessions conditionally", () => {
    const path = "/virtual/sessions/snap.json";
    const initial = '{"agent_id":"snap-1"}';
    setInMemorySessionData(path, initial);

    const snapshot = snapshotSession(path);
    expect(snapshot.bytes).toBe(initial);

    const updated = '{"agent_id":"snap-2"}';
    setInMemorySessionData(path, updated);

    restoreSnapshotIfUnchanged(snapshot, updated);
    expect(getInMemorySessionData(path)).toBe(initial);

    const nonExistentSnap = snapshotSession("/virtual/sessions/none.json");
    expect(nonExistentSnap.bytes).toBeNull();
    setInMemorySessionData("/virtual/sessions/none.json", "temp");
    restoreSnapshotIfUnchanged(nonExistentSnap, "temp");
    expect(getInMemorySessionData("/virtual/sessions/none.json")).toBeUndefined();
  });

  it("executes operations within session authority lock and handles injected faults", () => {
    const result = withSessionAuthorityLock("/virtual/root", "/virtual/root/.olt/.sessions", () => {
      return "locked-success";
    });
    expect(result).toBe("locked-success");

    const restoreCleanup = setSessionLockCleanupFailureForTesting(new Error("cleanup-failed"));
    try {
      expect(() =>
        withSessionAuthorityLock("/virtual/root", "/virtual/root/.olt/.sessions", () => {
          return "ok";
        }),
      ).toThrow("cleanup-failed");
    } finally {
      restoreCleanup();
    }
  });

  it("reads and validates persisted sessions with strict schema checks", () => {
    const valid = JSON.stringify({
      agent_id: "agent-test",
      role: "worker",
      token: "tok_123",
      can_execute_shell: true,
      can_edit_files: true,
      write_scope: ["src/"],
    });

    const parsed = readPersistedSession("/virtual/path", "test", () => valid);
    expect(parsed?.agent_id).toBe("agent-test");
    expect(parsed?.role).toBe("worker");

    const missingError = Object.assign(new Error("not found"), { code: "ENOENT" });
    const absent = readPersistedSession("/missing", "test", () => {
      throw missingError;
    });
    expect(absent).toBeNull();

    expect(() => readPersistedSession("/invalid", "test", () => '{"agent_id":""}')).toThrow(
      HarnessError,
    );
  });

  it("infers execute permissions according to agent role", () => {
    const worker = inferCanExecute("implementer");
    expect(worker.can_execute_shell).toBe(true);
    expect(worker.can_edit_files).toBe(true);

    const subWorker = inferCanExecute("sub_task_worker");
    expect(subWorker.can_edit_files).toBe(true);

    const validator = inferCanExecute("cognitive_validator");
    expect(validator.can_execute_shell).toBe(true);
    expect(validator.can_edit_files).toBe(false);

    const mind = inferCanExecute("mind");
    expect(mind.can_execute_shell).toBe(true);
    expect(mind.can_edit_files).toBe(false);
  });

  it("formats safe error causes and extracts own data strings", () => {
    expect(formatSafeErrorCause(new Error("test error"))).toBe("test error");
    expect(formatSafeErrorCause("raw string")).toBe("raw string");
    expect(formatSafeErrorCause(null)).toBe("null");
    expect(readOwnDataString({ code: "ENOENT" }, "code")).toBe("ENOENT");
    expect(readOwnDataString(null, "code")).toBeNull();
  });

  it("stages, registers, rolls back, and revokes session grants in-memory", () => {
    const staged = stageSessionGrant({
      runRoot: "/virtual/capsules/run-1",
      agentId: "agent-stage",
      role: "implementer",
      pid: 5001,
      ppid: 5000,
      worktreeDir: "/virtual/worktrees/wt-1",
    });

    expect(staged.session.agent_id).toBe("agent-stage");
    expect(
      getInMemorySessionData("/virtual/capsules/run-1/runtime/sessions/agent-stage.json"),
    ).toBeDefined();

    rollbackStagedSessionGrant(staged);

    const registered = registerInMemorySessionGrant({
      runRoot: "/virtual/capsules/run-2",
      agentId: "agent-reg",
      role: "implementer",
      pid: 6001,
      ppid: 6000,
      worktreeDir: "/virtual/worktrees/wt-2",
    });

    expect(registered.agent_id).toBe("agent-reg");
    expect(getInMemorySessionData("/virtual/worktrees/wt-2/.session.json")).toBeDefined();

    revokeSessionGrant({
      runRoot: "/virtual/capsules/run-2",
      agentId: "agent-reg",
      pid: 6001,
      ppid: 6000,
    });

    expect(
      getInMemorySessionData("/virtual/capsules/run-2/runtime/sessions/agent-reg.json"),
    ).toBeUndefined();
  });

  it("asserts active capsule leases from in-memory state", () => {
    const runRoot = "/virtual/capsules/lease-run";
    const statePath = `${runRoot}/state.json`;

    const state = {
      agents: [
        {
          id: "agent-active",
          role: "implementer",
          status: "active",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-31T00:00:00.000Z",
        },
      ],
    };
    setInMemorySessionData(statePath, JSON.stringify(state));

    expect(() => assertActiveCapsuleLease(runRoot, "agent-active")).not.toThrow();
    expect(() => assertActiveCapsuleLease(runRoot, "agent-missing")).toThrow(HarnessError);
    expect(() => assertActiveCapsuleLease("", "agent-active")).toThrow(HarnessError);
  });

  it("prunes in-memory session records", () => {
    pruneStaleSessions();
    expect(isInMemorySessionStoreEnabled()).toBe(true);
  });
});
