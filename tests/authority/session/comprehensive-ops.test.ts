import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  assertActiveCapsuleLease,
  autoDeriveCallerIdentity,
  formatSafeErrorCause,
  isSessionLedgerBacked,
  pruneStaleSessions,
  registerSessionGrant,
  requireTurn1Registration,
  resolveActiveSession,
  revokeSessionGrant,
  stageSessionGrant,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
  type SessionIdentity,
} from "../../../olt/scripts/src/authority/session/index.ts";

describe("Authority Session Comprehensive - Operations & Lifecycle", () => {
  const sandbox = "/virtual/capsule-ops";

  beforeEach(() => enableInMemorySessionStore());
  afterEach(() => disableInMemorySessionStore());

  test("resolveActiveSession across diverse detection mechanisms", () => {
    const capsuleDir = `${sandbox}/.olt/capsules/run-active-1`;
    const state = {
      schema_version: 1,
      run_id: "run-active-1",
      tasks: {},
      agents: [
        {
          agent_id: "implementer_task-1",
          role: "implementer",
          status: "active",
          grant: { task_id: "task-1", write_scope: ["src/file.ts"], token: "tok-test-123" },
        },
      ],
    };
    setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(state));

    const envSession = resolveActiveSession({
      cwd: sandbox,
      runRoot: capsuleDir,
      env: { HARNESS_TOKEN: "tok_test_env_1", AGENT_ID: "coordinator_wave-1", ROLE: "coordinator" },
    });
    expect(envSession?.agent_id).toBe("coordinator_wave-1");
    expect(envSession?.role).toBe("coordinator");
    expect(envSession?.token).toBe("tok_test_env_1");

    setInMemorySessionData(
      `${sandbox}/.session.json`,
      JSON.stringify({
        agent_id: "orchestrator_phase-1",
        role: "orchestrator",
        token: "tok_workspace_1",
        can_execute_shell: true,
        can_edit_files: false,
      }),
    );
    const wsSession = resolveActiveSession({ cwd: sandbox, runRoot: capsuleDir, env: {} });
    expect(wsSession?.role).toBe("orchestrator");

    const pidSessionFile = `${sandbox}/.olt/.sessions/98765.json`;
    setInMemorySessionData(
      pidSessionFile,
      JSON.stringify({
        agent_id: "implementer_task-1",
        role: "implementer",
        token: "tok-test-123",
        task_id: "task-1",
        write_scope: ["src/file.ts"],
      }),
    );
    const pidSession = resolveActiveSession({ cwd: sandbox, runRoot: sandbox, pid: 98765, env: {} });
    expect(pidSession?.task_id).toBe("task-1");
  });

  test("stageSessionGrant, registerSessionGrant and cleanupSessionGrants lifecycle", () => {
    const capsuleDir = `${sandbox}/.olt/capsules/run-grants-1`;
    setInMemorySessionData(
      `${capsuleDir}/state.json`,
      JSON.stringify({ schema_version: 1, run_id: "run-grants-1", tasks: {}, agents: [] }),
    );

    const staged = stageSessionGrant({
      agentId: "implementer_task-2-worker",
      role: "implementer",
      runRoot: capsuleDir,
      pid: 44444,
      ppid: 33333,
      taskId: "task-2",
      writeScope: ["src/feature.ts"],
      customToken: "tok_custom_grant_1",
      bindProcessAncestry: true,
    });
    expect(staged.session.agent_id).toBe("implementer_task-2-worker");

    const registered = registerSessionGrant({
      agentId: "validator_subsystem",
      role: "validator",
      runRoot: capsuleDir,
      pid: 55555,
      ppid: 44444,
      customToken: "tok_val_grant_1",
      bindProcessAncestry: true,
    });
    expect(registered.agent_id).toBe("validator_subsystem");
    expect(registered.role).toBe("validator");

    expect(() =>
      revokeSessionGrant({
        runRoot: capsuleDir,
        agentId: registered.agent_id,
        pid: registered.pid,
        ppid: registered.ppid,
      }),
    ).not.toThrow();

    expect(() => pruneStaleSessions(0)).not.toThrow();

    const derived = autoDeriveCallerIdentity({ explicitActor: "implementer_task-1", explicitToken: "tok-1" });
    expect(derived.actor).toBe("implementer_task-1");
    expect(derived.role).toBe("implementer");
    expect(derived.token).toBe("tok-1");
    expect(derived.verified).toBe(false);

    const ledgerBacked = isSessionLedgerBacked(capsuleDir, "implementer_task-1", "implementer");
    expect(typeof ledgerBacked).toBe("boolean");
  });

  test("requireTurn1Registration edge cases and failures", () => {
    expect(() => requireTurn1Registration(null as unknown as SessionIdentity)).toThrow(
      "session identity is required",
    );

    const dummyBase = {
      agent_id: "a1",
      role: "implementer" as const,
      tier: 3,
      pid: 1,
      ppid: 1,
      can_execute_shell: true,
      can_edit_files: true,
      host: "generic",
      granted_at: new Date().toISOString(),
    };

    expect(() =>
      requireTurn1Registration({ ...dummyBase, token: "unauthenticated", mechanisms_detected: ["registration"] }),
    ).toThrow("unauthenticated: turn 1 registration token required");

    expect(() =>
      requireTurn1Registration({ ...dummyBase, token: "tok_valid", mechanisms_detected: ["interactive_terminal_fallback"] }),
    ).toThrow("missing run_id in session identity");

    expect(() =>
      requireTurn1Registration({
        ...dummyBase,
        token: "tok_valid",
        run_id: "run-non-existent-xyz",
        mechanisms_detected: ["interactive_terminal_fallback"],
      }),
    ).toThrow("no valid durable registration mechanism");
  });

  test("requireTurn1Registration and capsule runtime session files", () => {
    const candDir = `${sandbox}/.olt/capsules/run-turn1-found`;
    setInMemorySessionData(
      `${candDir}/state.json`,
      JSON.stringify({ schema_version: 1, run_id: "run-turn1-found", tasks: {}, agents: [] }),
    );

    expect(() =>
      requireTurn1Registration({
        agent_id: "agent-1",
        role: "implementer",
        tier: 3,
        token: "tok_turn1_valid",
        run_id: candDir,
        pid: process.pid,
        ppid: process.ppid,
        can_execute_shell: true,
        can_edit_files: true,
        host: "antigravity",
        granted_at: new Date().toISOString(),
        mechanisms_detected: ["capsule_runtime_session"],
      }),
    ).not.toThrow();

    const runtimeSessionsDir = `${candDir}/runtime/sessions`;
    setInMemorySessionData(
      `${runtimeSessionsDir}/implementer-worker-1.json`,
      JSON.stringify({
        agent_id: "implementer-worker-1",
        role: "implementer",
        token: "tok-rt-session",
        can_execute_shell: true,
        can_edit_files: true,
        task_id: "task-rt-1",
        write_scope: ["src/rt.ts"],
      }),
    );

    const session = resolveActiveSession({
      cwd: sandbox,
      runRoot: candDir,
      explicitActor: "implementer-worker-1",
      env: {},
    });
    expect(session?.agent_id).toBe("implementer-worker-1");
    expect(session?.mechanisms_detected).toContain("capsule_runtime_session");
    expect(session?.task_id).toBe("task-rt-1");
  });

  test("assertActiveCapsuleLease handles active, expired, and corrupt states", () => {
    const capsuleDir = `${sandbox}/.olt/capsules/run-lease-1`;
    expect(() => assertActiveCapsuleLease("", "agent-1")).toThrow("capsule runRoot is required");

    const activeState = {
      schema_version: 1,
      run_id: "run-lease-1",
      tasks: { "task-1": { id: "task-1", lease: { agent_id: "active-worker", expires_at: new Date(Date.now() + 60000).toISOString() } } },
      agents: [],
    };
    setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(activeState));
    expect(() => assertActiveCapsuleLease(capsuleDir, "active-worker")).not.toThrow();

    const expiredState = {
      schema_version: 1,
      run_id: "run-lease-1",
      tasks: { "task-1": { id: "task-1", lease: { agent_id: "expired-worker", expires_at: new Date(Date.now() - 60000).toISOString() } } },
      agents: [],
    };
    setInMemorySessionData(`${capsuleDir}/state.json`, JSON.stringify(expiredState));
    expect(() => assertActiveCapsuleLease(capsuleDir, "expired-worker")).toThrow(
      "does not hold an active lease",
    );

    setInMemorySessionData(`${capsuleDir}/state.json`, "{ invalid json");
    expect(() => assertActiveCapsuleLease(capsuleDir, "any-agent")).toThrow(
      "failed to load capsule state",
    );
  });

  test("formatSafeErrorCause handles throwing objects and symbols", () => {
    const throwingObj = {
      toString() {
        throw new Error("toString failure");
      },
    };
    expect(formatSafeErrorCause(throwingObj)).toBe("unknown error");
  });
});
