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
    const cDir = `${sandbox}/.olt/capsules/run-active-1`;
    setInMemorySessionData(
      `${cDir}/state.json`,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-active-1",
        tasks: {},
        agents: [
          {
            agent_id: "impl_t1",
            role: "implementer",
            status: "active",
            grant: { task_id: "t1", write_scope: ["src/a.ts"], token: "tok-123" },
          },
        ],
      }),
    );

    const envS = resolveActiveSession({
      cwd: sandbox,
      runRoot: cDir,
      env: { HARNESS_TOKEN: "tok_e1", AGENT_ID: "coord_w1", ROLE: "coordinator" },
    });
    expect(envS?.agent_id).toBe("coord_w1");
    expect(envS?.role).toBe("coordinator");
    expect(envS?.token).toBe("tok_e1");

    setInMemorySessionData(
      `${sandbox}/.session.json`,
      JSON.stringify({
        agent_id: "orch_p1",
        role: "orchestrator",
        token: "tok_w1",
        can_execute_shell: true,
        can_edit_files: false,
      }),
    );
    expect(resolveActiveSession({ cwd: sandbox, runRoot: cDir, env: {} })?.role).toBe(
      "orchestrator",
    );

    setInMemorySessionData(
      `${sandbox}/.olt/.sessions/98765.json`,
      JSON.stringify({
        agent_id: "impl_t1",
        role: "implementer",
        token: "tok-123",
        task_id: "t1",
        write_scope: ["src/a.ts"],
      }),
    );
    expect(
      resolveActiveSession({ cwd: sandbox, runRoot: sandbox, pid: 98765, env: {} })?.task_id,
    ).toBe("t1");
  });

  test("stageSessionGrant, registerSessionGrant and cleanupSessionGrants lifecycle", () => {
    const cDir = `${sandbox}/.olt/capsules/run-grants-1`;
    setInMemorySessionData(
      `${cDir}/state.json`,
      JSON.stringify({ schema_version: 1, run_id: "run-grants-1", tasks: {}, agents: [] }),
    );

    const staged = stageSessionGrant({
      agentId: "impl_w2",
      role: "implementer",
      runRoot: cDir,
      pid: 44444,
      ppid: 33333,
      taskId: "t2",
      writeScope: ["src/f.ts"],
      customToken: "tok_g1",
      bindProcessAncestry: true,
    });
    expect(staged.session.agent_id).toBe("impl_w2");

    const reg = registerSessionGrant({
      agentId: "val_sub",
      role: "validator",
      runRoot: cDir,
      pid: 55555,
      ppid: 44444,
      customToken: "tok_vg1",
      bindProcessAncestry: true,
    });
    expect(reg.agent_id).toBe("val_sub");
    expect(reg.role).toBe("validator");

    expect(() =>
      revokeSessionGrant({ runRoot: cDir, agentId: reg.agent_id, pid: reg.pid, ppid: reg.ppid }),
    ).not.toThrow();
    expect(() => pruneStaleSessions(0)).not.toThrow();

    const derived = autoDeriveCallerIdentity({ explicitActor: "impl_t1", explicitToken: "tok-1" });
    expect(derived.actor).toBe("impl_t1");
    expect(derived.role).toBe("implementer");
    expect(derived.verified).toBe(false);
    expect(typeof isSessionLedgerBacked(cDir, "impl_t1", "implementer")).toBe("boolean");
  });

  test("requireTurn1Registration edge cases and failures", () => {
    expect(() => requireTurn1Registration(null as unknown as SessionIdentity)).toThrow(
      "session identity is required",
    );
    const base = {
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
      requireTurn1Registration({
        ...base,
        token: "unauthenticated",
        mechanisms_detected: ["registration"],
      }),
    ).toThrow("turn 1 registration token required");
    expect(() =>
      requireTurn1Registration({
        ...base,
        token: "tok_valid",
        mechanisms_detected: ["interactive_terminal_fallback"],
      }),
    ).toThrow("missing run_id");
    expect(() =>
      requireTurn1Registration({
        ...base,
        token: "tok_valid",
        run_id: "run-xyz",
        mechanisms_detected: ["interactive_terminal_fallback"],
      }),
    ).toThrow("no valid durable registration");
  });

  test("requireTurn1Registration and capsule runtime session files", () => {
    const candDir = `${sandbox}/.olt/capsules/run-turn1-found`;
    setInMemorySessionData(
      `${candDir}/state.json`,
      JSON.stringify({ schema_version: 1, run_id: "run-turn1-found", tasks: {}, agents: [] }),
    );

    expect(() =>
      requireTurn1Registration({
        agent_id: "a1",
        role: "implementer",
        tier: 3,
        token: "tok_v",
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

    setInMemorySessionData(
      `${candDir}/runtime/sessions/impl_w1.json`,
      JSON.stringify({
        agent_id: "impl_w1",
        role: "implementer",
        token: "tok-rt",
        can_execute_shell: true,
        can_edit_files: true,
        task_id: "t_rt",
        write_scope: ["src/rt.ts"],
      }),
    );

    const session = resolveActiveSession({
      cwd: sandbox,
      runRoot: candDir,
      explicitActor: "impl_w1",
      env: {},
    });
    expect(session?.agent_id).toBe("impl_w1");
    expect(session?.mechanisms_detected).toContain("capsule_runtime_session");
    expect(session?.task_id).toBe("t_rt");
  });

  test("assertActiveCapsuleLease handles active, expired, and corrupt states", () => {
    const cDir = `${sandbox}/.olt/capsules/run-lease-1`;
    expect(() => assertActiveCapsuleLease("", "a1")).toThrow("capsule runRoot is required");

    const mk = (w: string, ms: number) =>
      JSON.stringify({
        schema_version: 1,
        run_id: "run-lease-1",
        agents: [],
        tasks: {
          t1: {
            id: "t1",
            lease: { agent_id: w, expires_at: new Date(Date.now() + ms).toISOString() },
          },
        },
      });

    setInMemorySessionData(`${cDir}/state.json`, mk("w_act", 60000));
    expect(() => assertActiveCapsuleLease(cDir, "w_act")).not.toThrow();

    setInMemorySessionData(`${cDir}/state.json`, mk("w_exp", -60000));
    expect(() => assertActiveCapsuleLease(cDir, "w_exp")).toThrow("does not hold an active lease");

    setInMemorySessionData(`${cDir}/state.json`, "{ invalid json");
    expect(() => assertActiveCapsuleLease(cDir, "any")).toThrow("failed to load capsule state");
  });

  test("formatSafeErrorCause handles throwing objects and symbols", () => {
    expect(
      formatSafeErrorCause({
        toString() {
          throw new Error("fail");
        },
      }),
    ).toBe("unknown error");
  });
});
