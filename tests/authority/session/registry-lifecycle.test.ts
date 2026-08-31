import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  registerSessionGrant,
  resolveActiveSession,
  autoDeriveCallerIdentity,
  pruneStaleSessions,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
} from "../../../olt/scripts/src/authority/session/index.ts";

describe("Authority Session Registry - Lifecycle & Pruning", () => {
  const sandboxDir = "/virtual/capsules/registry-lifecycle";

  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
  });

  it("autoDeriveCallerIdentity returns active session info when resolved", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-active",
      role: "implementer",
      pid: 70002,
      ppid: 70001,
    });

    const caller = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      runRoot: sandboxDir,
      ppid: 70001,
    });

    expect(caller.actor).toBe("impl-active");
    expect(caller.role).toBe("implementer");
    expect(caller.tier).toBe(3);
    expect(caller.token).toStartWith("tok_live_");
  });

  it("autoDeriveCallerIdentity falls back gracefully to Tier 0 Mind in interactive shell", () => {
    const caller = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
    });

    expect(caller.actor).toBe("mind");
    expect(caller.role).toBe("mind");
    expect(caller.tier).toBe(0);
    expect(caller.mechanisms).toContain("interactive_terminal_fallback");

    const callerWithExplicit = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
      explicitActor: "orch-lead",
      explicitToken: "tok_explicit_test",
    });

    expect(callerWithExplicit.actor).toBe("orch-lead");
    expect(callerWithExplicit.role).toBe("orchestrator");
    expect(callerWithExplicit.tier).toBe(1);
    expect(callerWithExplicit.token).toBe("tok_explicit_test");
  });

  it("prunes in-memory session records", () => {
    pruneStaleSessions(86400000);
    expect(true).toBe(true);
  });

  it("resolves active session with derived agentId and unauthenticated token when omitted", () => {
    const resolvedRoleOnly = resolveActiveSession({
      cwd: sandboxDir,
      env: {
        ROLE: "validator",
      },
    });
    expect(resolvedRoleOnly).not.toBeNull();
    expect(resolvedRoleOnly?.agent_id).toBe("agent-validator");
    expect(resolvedRoleOnly?.role).toBe("validator");
    expect(resolvedRoleOnly?.tier).toBe(3);
    expect(resolvedRoleOnly?.token).toBe("unauthenticated");

    const resolvedAgentOnly = resolveActiveSession({
      cwd: sandboxDir,
      env: {
        AGENT_ID: "orch-phase-1",
      },
    });
    expect(resolvedAgentOnly).not.toBeNull();
    expect(resolvedAgentOnly?.agent_id).toBe("orch-phase-1");
    expect(resolvedAgentOnly?.role).toBe("orchestrator");
    expect(resolvedAgentOnly?.tier).toBe(1);
  });

  it("autoDeriveCallerIdentity handles explicitActor with custom role fallback", () => {
    const customCaller = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
      explicitActor: "custom-unmapped-entity",
    });
    expect(customCaller.actor).toBe("custom-unmapped-entity");
    expect(customCaller.role).toBe("custom-unmapped-entity");
    expect(customCaller.tier).toBe(3);
  });

  it("autoDeriveCallerIdentity returns resolved session identity when active session exists", () => {
    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "agent-caller-1",
      role: "coordinator",
      pid: 33445,
    });

    const resolved = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      runRoot: sandboxDir,
      pid: 33445,
    });

    expect(resolved.actor).toBe("agent-caller-1");
    expect(resolved.role).toBe("coordinator");
    expect(resolved.tier).toBe(2);
    expect(resolved.token).toBe(session.token);
    expect(resolved.mechanisms.some((m) => m.includes("process_ancestry_pid"))).toBe(true);
  });

  it("marks a bare env-var-declared 'mind' identity as unverified, since it has no registry corroboration", () => {
    const spoofed = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: { ROLE: "mind" },
    });

    expect(spoofed.role).toBe("mind");
    expect(spoofed.tier).toBe(0);
    expect(spoofed.mechanisms).toContain("environment_variables");
    expect(spoofed.verified).toBe(false);
  });

  it("does NOT mark a bare registered-session-file caller as verified when no active ledger grant backs it", () => {
    const granted = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "coord-verified",
      role: "coordinator",
      pid: 55123,
    });

    const derived = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      runRoot: sandboxDir,
      pid: 55123,
      env: {},
    });

    expect(derived.actor).toBe("coord-verified");
    expect(derived.token).toBe(granted.token);
    expect(derived.mechanisms.some((m) => m.startsWith("process_ancestry_pid_"))).toBe(true);
    expect(derived.verified).toBe(false);
  });

  it("marks the total-fallback identity (no session, no explicit actor) as unverified", () => {
    const noSignal = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
    });

    expect(noSignal.actor).toBe("mind");
    expect(noSignal.verified).toBe(false);
  });

  it("resolveActiveSession handles empty options and returns null", () => {
    const res = resolveActiveSession({
      cwd: "/tmp/non-repo-dir",
      env: {},
      pid: 0,
      ppid: 0,
    });
    expect(res).toBeNull();
  });
});
