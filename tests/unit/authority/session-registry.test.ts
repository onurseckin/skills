import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import {
  registerSessionGrant,
  resolveActiveSession,
  autoDeriveCallerIdentity,
  pruneStaleSessions,
} from "../../../olt/scripts/src/authority/session-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { resolveScratchDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Multi-Mechanism Automatic Session Registry & Anti-Spoofing Engine", () => {
  let sandboxDir: string;

  beforeEach(() => {
    sandboxDir = scratchRoot(import.meta.path, "session-registry-test");
    mkdirSync(join(sandboxDir, ".olt", ".sessions"), { recursive: true });
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

    expect(existsSync(join(sandboxDir, ".olt", ".sessions", "12345.json"))).toBe(true);
    expect(existsSync(join(sandboxDir, ".olt", ".sessions", "12344.json"))).toBe(true);
  });

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
    expect(existsSync(join(sandboxDir, "runtime", "sessions", "agent-custom.json"))).toBe(true);
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
      expect(s.can_execute_shell).toBe(false);
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

    const workerRoles = ["implementer", "repairer", "sub-implementer", "custom-role"];
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

  it("auto-derives caller identity from Process Ancestry (PPID) without manual flags", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "coordinator-alpha",
      role: "coordinator",
      pid: 20002,
      ppid: 20001,
    });

    const resolved = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 20001,
      pid: 99999,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("coordinator-alpha");
    expect(resolved?.role).toBe("coordinator");
    expect(resolved?.tier).toBe(2);
    expect(resolved?.can_execute_shell).toBe(true);
    expect(resolved?.can_edit_files).toBe(false);
    expect(resolved?.mechanisms_detected).toContain("process_ancestry_pid_20001");
  });

  it("auto-derives caller identity from Workspace Directory Anchoring (.session.json)", () => {
    const workspaceDir = join(sandboxDir, "worktrees", "impl-engine-workspace");
    mkdirSync(workspaceDir, { recursive: true });

    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-engine",
      role: "implementer",
      worktreeDir: workspaceDir,
    });

    expect(existsSync(join(workspaceDir, ".session.json"))).toBe(true);

    const resolved = resolveActiveSession({
      cwd: workspaceDir,
      pid: 0,
      ppid: 0,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("impl-engine");
    expect(resolved?.role).toBe("implementer");
    expect(resolved?.tier).toBe(3);
    expect(resolved?.mechanisms_detected).toContain("workspace_directory_session");
  });

  it("auto-derives caller identity from .olt-identity.json in parent directories", () => {
    const deepDir = join(sandboxDir, "deep", "nested", "workspace");
    mkdirSync(deepDir, { recursive: true });

    const identityPayload = {
      agent_id: "val-security",
      role: "validator-security",
      token: "tok_sec_val_456",
      can_execute_shell: false,
      can_edit_files: false,
      task_id: "task-audit-1",
      write_scope: ["tests/"],
    };
    writeFileSync(
      join(sandboxDir, "deep", ".olt-identity.json"),
      JSON.stringify(identityPayload),
      "utf8",
    );

    const resolved = resolveActiveSession({
      cwd: deepDir,
      pid: 0,
      ppid: 0,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("val-security");
    expect(resolved?.role).toBe("validator-security");
    expect(resolved?.token).toBe("tok_sec_val_456");
    expect(resolved?.can_execute_shell).toBe(false);
    expect(resolved?.can_edit_files).toBe(false);
    expect(resolved?.task_id).toBe("task-audit-1");
    expect(resolved?.write_scope).toEqual(["tests/"]);
    expect(resolved?.mechanisms_detected).toContain("workspace_directory_session");
  });

  it("auto-derives caller identity from Environment Tokens (Mechanism 1)", () => {
    const resolved = resolveActiveSession({
      cwd: sandboxDir,
      env: {
        HARNESS_TOKEN: "tok_secret_override_999",
        AGENT_ID: "impl-cli",
        ROLE: "implementer",
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("impl-cli");
    expect(resolved?.role).toBe("implementer");
    expect(resolved?.token).toBe("tok_secret_override_999");
    expect(resolved?.mechanisms_detected).toContain("environment_variables");
  });

  it("supports HARNESS_SESSION_TOKEN, HARNESS_AGENT_ID, and HARNESS_ROLE aliases", () => {
    const resolved = resolveActiveSession({
      cwd: sandboxDir,
      env: {
        HARNESS_SESSION_TOKEN: "tok_alias_111",
        HARNESS_AGENT_ID: "agent-alias",
        HARNESS_ROLE: "repairer",
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("agent-alias");
    expect(resolved?.role).toBe("repairer");
    expect(resolved?.token).toBe("tok_alias_111");
  });

  it("aggregates attributes across multiple simultaneous mechanisms", () => {
    const workspaceDir = join(sandboxDir, "worktrees", "impl-mind-workspace");
    mkdirSync(workspaceDir, { recursive: true });

    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-mind",
      role: "implementer",
      pid: 30002,
      ppid: 30001,
      worktreeDir: workspaceDir,
    });

    const resolved = resolveActiveSession({
      cwd: workspaceDir,
      ppid: 30001,
      env: {
        HARNESS_TOKEN: "tok_mind_token",
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.agent_id).toBe("impl-mind");
    expect(resolved?.role).toBe("implementer");
    expect(resolved?.token).toBe("tok_mind_token");
    expect(resolved?.mechanisms_detected).toContain("environment_variables");
    expect(resolved?.mechanisms_detected).toContain("process_ancestry_pid_30001");
    expect(resolved?.mechanisms_detected).toContain("workspace_directory_session");
  });

  it("returns null when no session identity can be detected", () => {
    const emptyDir = scratchRoot(import.meta.path, "empty-session");
    const resolved = resolveActiveSession({
      cwd: emptyDir,
      pid: 0,
      ppid: 0,
      env: {},
    });
    expect(resolved).toBeNull();
  });

  it("handles corrupted JSON in process session files and workspace session files gracefully", () => {
    const corruptDir = scratchRoot(import.meta.path, "corrupt-sessions");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "55555.json"), "NOT_JSON", "utf8");
    writeFileSync(join(corruptDir, ".session.json"), "{ broken json", "utf8");

    const resolved = resolveActiveSession({
      cwd: corruptDir,
      pid: 55555,
      ppid: 0,
      env: {},
    });
    expect(resolved).toBeNull();
  });

  it("allows matching explicitActor variants (agent_id, role, or agent-role) and token delegation", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-wave-1",
      role: "implementer",
      pid: 60002,
      ppid: 60001,
      customToken: "tok_delegated_secret",
    });

    // Match 1: explicitActor matches agent_id
    const matchId = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "impl-wave-1",
    });
    expect(matchId?.agent_id).toBe("impl-wave-1");

    // Match 2: explicitActor matches role
    const matchRole = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "implementer",
    });
    expect(matchRole?.agent_id).toBe("impl-wave-1");

    // Match 3: explicitActor matches agent-role
    const matchAgentRole = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "agent-implementer",
    });
    expect(matchAgentRole?.agent_id).toBe("impl-wave-1");

    // Delegation: explicitActor differs, but matching explicitToken is supplied
    const delegated = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "coordinator-1",
      explicitToken: "tok_delegated_secret",
    });
    expect(delegated?.agent_id).toBe("impl-wave-1");
  });

  it("mechanically blocks Actor Spoofing when caller tries to pass another role flag without credentials", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "orchestrator-1",
      role: "orchestrator",
      pid: 40002,
      ppid: 40001,
    });

    // Caller is verified as orchestrator-1, but tries to pass --actor coordinator-1
    expect(() => {
      resolveActiveSession({
        cwd: sandboxDir,
        ppid: 40001,
        explicitActor: "coordinator-1",
      });
    }).toThrow(HarnessError);

    try {
      resolveActiveSession({
        cwd: sandboxDir,
        ppid: 40001,
        explicitActor: "coordinator-1",
      });
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("AUTHENTICATION_FAILURE");
      expect((err as HarnessError).message).toContain("Actor spoofing blocked");
    }
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

    // Fallback with explicitActor provided
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

  it("pruneStaleSessions prunes expired files and ESRCH dead process session files", () => {
    const sessionsDir = join(resolveScratchDir(), ".sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const now = Date.now();

    // 1. Create a non-json file (should be skipped)
    writeFileSync(join(sessionsDir, "README.txt"), "some notes", "utf8");

    // 2. Create an expired session file (> 24h old)
    const oldFile = join(sessionsDir, "99991.json");
    writeFileSync(oldFile, JSON.stringify({ agent_id: "old-agent" }), "utf8");
    const twoDaysAgo = (now - 172800000) / 1000;
    utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

    // 3. Create a session file for a dead PID (ESRCH)
    const deadPidFile = join(sessionsDir, "9999999.json");
    writeFileSync(deadPidFile, JSON.stringify({ agent_id: "dead-pid-agent" }), "utf8");

    // 4. Create a session file for the current process PID (alive)
    const livePidFile = join(sessionsDir, `${process.pid}.json`);
    writeFileSync(livePidFile, JSON.stringify({ agent_id: "live-agent" }), "utf8");

    // Execute prune
    pruneStaleSessions(86400000);

    expect(existsSync(join(sessionsDir, "README.txt"))).toBe(true);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(deadPidFile)).toBe(false);
    expect(existsSync(livePidFile)).toBe(true);
  });

  it("resolves active session with derived agentId and unauthenticated token when omitted", () => {
    // Only role provided
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

    // Only agent ID provided
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
});
