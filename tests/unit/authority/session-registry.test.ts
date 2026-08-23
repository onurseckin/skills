import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerSessionGrant,
  resolveActiveSession,
  autoDeriveCallerIdentity,
} from "../../../olt/scripts/src/authority/session-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
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

  it("autoDeriveCallerIdentity falls back gracefully to Tier 0 Mind in interactive shell", () => {
    const caller = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
    });

    expect(caller.actor).toBe("mind");
    expect(caller.role).toBe("mind");
    expect(caller.tier).toBe(0);
    expect(caller.mechanisms).toContain("interactive_terminal_fallback");
  });
});
