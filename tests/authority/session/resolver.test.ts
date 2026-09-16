import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  autoDeriveCallerIdentity,
  isEnvironmentTokenValid,
  resolveActiveSession,
} from "../../../olt/scripts/src/authority/session/resolver.ts";

describe("authority/session/resolver", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(process.cwd(), { recursive: true });
    vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });

  function setupTestCapsule(options: {
    agents: Array<{ id: string; role: string; status: string }>;
    sessions: Record<string, { token: string; role?: string }>;
  }): { runRoot: string } {
    const dir = `/tmp/olt-resolver-test-${Math.random().toString(36).slice(2, 7)}`;
    vfs.mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    vfs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          schema: "harness.run-state",
          version: 1,
          agents: options.agents.map((a) => ({
            id: a.id,
            role: a.role,
            status: a.status,
            parent_agent_id: null,
            parent_task_id: null,
            host: "test-host",
            granted_at: new Date().toISOString(),
          })),
          tasks: {},
          commands: {},
        },
        null,
        2,
      ),
    );
    const sessionsDir = join(dir, "runtime", "sessions");
    vfs.mkdirSync(sessionsDir, { recursive: true });
    for (const [agentId, sessionData] of Object.entries(options.sessions)) {
      const sessionFile = join(sessionsDir, `${agentId}.json`);
      vfs.writeFileSync(
        sessionFile,
        JSON.stringify(
          {
            agent_id: agentId,
            role: sessionData.role ?? "implementer",
            tier: 3,
            token: sessionData.token,
            pid: 1000,
            ppid: 999,
            can_execute_shell: true,
            can_edit_files: true,
            host: "test-host",
            mechanisms_detected: ["registration"],
            granted_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    }
    return {
      runRoot: dir,
    };
  }

  it("authenticates valid environment token against active ledger and runtime sessions", () => {
    const { runRoot } = setupTestCapsule({
      agents: [{ id: "imp-1", role: "implementer", status: "active" }],
      sessions: { "imp-1": { token: "tok_valid_123", role: "implementer" } },
    });
    const identity = autoDeriveCallerIdentity({
      runRoot,
      env: {
        HARNESS_TOKEN: "tok_valid_123",
        AGENT_ID: "imp-1",
        ROLE: "implementer",
      },
    });

    expect(identity.verified).toBe(true);
    expect(identity.actor).toBe("imp-1");
    expect(identity.role).toBe("implementer");
    expect(identity.token).toBe("tok_valid_123");
    expect(identity.mechanisms).toContain("capsule_runtime_session");
    expect(identity.mechanisms).toContain("environment_variables");
  });

  it("rejects mismatched environment token", () => {
    const { runRoot } = setupTestCapsule({
      agents: [{ id: "imp-1", role: "implementer", status: "active" }],
      sessions: { "imp-1": { token: "tok_valid_123", role: "implementer" } },
    });
    const identity = autoDeriveCallerIdentity({
      runRoot,
      env: {
        HARNESS_TOKEN: "tok_wrong_token",
        AGENT_ID: "imp-1",
        ROLE: "implementer",
      },
    });

    expect(identity.verified).toBe(false);
    expect(identity.actor).toBe("imp-1");
  });

  it("blocks cross-agent token spoofing when claiming an explicit agent ID", () => {
    const { runRoot } = setupTestCapsule({
      agents: [
        { id: "imp-1", role: "implementer", status: "active" },
        { id: "val-1", role: "validator", status: "active" },
      ],
      sessions: {
        "val-1": { token: "tok_val_token", role: "validator" },
      },
    });
    const identity = autoDeriveCallerIdentity({
      runRoot,
      env: {
        HARNESS_TOKEN: "tok_val_token",
        AGENT_ID: "imp-1",
        ROLE: "implementer",
      },
    });

    // Cannot validate imp-1 with val-1's token
    expect(identity.verified).toBe(false);
  });

  it("auto-derives authenticated agent from token alone when AGENT_ID is not provided", () => {
    const { runRoot } = setupTestCapsule({
      agents: [{ id: "val-1", role: "validator", status: "active" }],
      sessions: { "val-1": { token: "tok_val_standalone", role: "validator" } },
    });
    const identity = autoDeriveCallerIdentity({
      runRoot,
      env: {
        HARNESS_TOKEN: "tok_val_standalone",
      },
    });

    expect(identity.verified).toBe(true);
    expect(identity.actor).toBe("val-1");
    expect(identity.role).toBe("validator");
    expect(identity.token).toBe("tok_val_standalone");
  });

  it("rejects token when agent is released/inactive in ledger", () => {
    const { runRoot } = setupTestCapsule({
      agents: [{ id: "imp-1", role: "implementer", status: "released" }],
      sessions: { "imp-1": { token: "tok_inactive_123", role: "implementer" } },
    });
    const identity = autoDeriveCallerIdentity({
      runRoot,
      env: {
        HARNESS_TOKEN: "tok_inactive_123",
        AGENT_ID: "imp-1",
      },
    });

    expect(identity.verified).toBe(false);
  });

  it("isEnvironmentTokenValid returns valid: false for missing or unauthenticated inputs", () => {
    expect(isEnvironmentTokenValid(undefined, "a", "r", "tok")).toEqual({ valid: false });
    expect(isEnvironmentTokenValid("/some/path", "a", "r", "")).toEqual({ valid: false });
    expect(isEnvironmentTokenValid("/some/path", "a", "r", "unauthenticated")).toEqual({
      valid: false,
    });
  });
});
