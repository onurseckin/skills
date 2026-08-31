import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  registerSessionGrant,
  resolveActiveSession,
  autoDeriveCallerIdentity,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Authority Session Registry - Resolution & Multi-Mechanism", () => {
  const sandboxDir = "/virtual/capsules/registry-resolution";

  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
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
    const workspaceDir = `${sandboxDir}/worktrees/impl-engine-workspace`;
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-engine",
      role: "implementer",
      worktreeDir: workspaceDir,
    });

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
    const deepDir = `${sandboxDir}/deep/nested/workspace`;
    const identityPayload = {
      agent_id: "val-security",
      role: "validator-security",
      token: "tok_sec_val_456",
      can_execute_shell: false,
      can_edit_files: false,
      task_id: "task-audit-1",
      write_scope: ["tests/authority/"],
    };
    setInMemorySessionData(
      `${sandboxDir}/deep/.olt-identity.json`,
      JSON.stringify(identityPayload),
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
    expect(resolved?.write_scope).toEqual(["tests/authority/"]);
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
    const workspaceDir = `${sandboxDir}/worktrees/impl-mind-workspace`;
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
      runRoot: sandboxDir,
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

  it("allows matching explicitActor variants but refuses token-only delegation", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "impl-wave-1",
      role: "implementer",
      pid: 60002,
      ppid: 60001,
      customToken: "tok_delegated_secret",
    });

    const matchId = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "impl-wave-1",
    });
    expect(matchId?.agent_id).toBe("impl-wave-1");

    const matchRole = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "implementer",
    });
    expect(matchRole?.agent_id).toBe("impl-wave-1");

    const matchAgentRole = resolveActiveSession({
      cwd: sandboxDir,
      ppid: 60001,
      explicitActor: "agent-implementer",
    });
    expect(matchAgentRole?.agent_id).toBe("impl-wave-1");

    expect(() =>
      resolveActiveSession({
        cwd: sandboxDir,
        ppid: 60001,
        explicitActor: "coordinator-1",
        explicitToken: "tok_delegated_secret",
      }),
    ).toThrow("cannot delegate another agent's durable grant");
  });

  it("mechanically blocks Actor Spoofing when caller tries to pass another role flag without credentials", () => {
    registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "orchestrator-1",
      role: "orchestrator",
      pid: 40002,
      ppid: 40001,
    });

    expect(() => {
      resolveActiveSession({
        cwd: sandboxDir,
        ppid: 40001,
        explicitActor: "coordinator-1",
      });
    }).toThrow(HarnessError);
  });
});
