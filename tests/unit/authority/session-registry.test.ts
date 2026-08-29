import { describe, it, expect, beforeEach } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  utimesSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  rollbackStagedSessionGrant,
  registerSessionGrant,
  resolveActiveSession,
  stageSessionGrant,
  autoDeriveCallerIdentity,
  pruneStaleSessions,
  setSessionLockCleanupFailureForTesting,
  setSessionPersistenceObserverForTesting,
} from "../../../olt/scripts/src/authority/session-registry.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  findRepoRoot,
  resolveCapsulesDir,
  resolveScratchDir,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

type PersistedSessionReader = (path: string, encoding: "utf8") => string;

function resolveWithInjectedRead(
  options: Parameters<typeof resolveActiveSession>[0],
  readPersistedSessionFile: PersistedSessionReader,
) {
  return resolveActiveSession({
    ...options,
    readPersistedSessionFile,
  });
}

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
      expect(readFileSync(join(sandboxDir, ".olt", ".sessions", `${id}.json`), "utf8")).toContain(
        "tok_newer",
      );
    }
    expect(existsSync(join(sandboxDir, ".olt", ".sessions", "12355.json"))).toBe(false);
  });

  it("rejects traversal-shaped agent identities before creating any process session record", () => {
    const sessions = join(sandboxDir, ".olt", ".sessions");
    expect(() =>
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "../escape",
        role: "implementer",
        pid: 74321,
        ppid: 74320,
      }),
    ).toThrow(HarnessError);
    expect(existsSync(join(sessions, "74321.json"))).toBe(false);
    expect(existsSync(join(sandboxDir, "runtime", "sessions", "..", "escape.json"))).toBe(false);
  });

  it("refuses a symlinked required session record without changing its sentinel", () => {
    const sessions = join(sandboxDir, ".olt", ".sessions");
    const external = join(sandboxDir, "session-sentinel.json");
    writeFileSync(external, "sentinel", "utf8");
    symlinkSync(external, join(sessions, "81231.json"));
    expect(() =>
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "impl-link",
        role: "implementer",
        pid: 81231,
        ppid: 81230,
      }),
    ).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe("sentinel");
  });

  it("rejects a hard-linked required session authority", () => {
    const sessions = join(sandboxDir, ".olt", ".sessions");
    const external = join(sandboxDir, "external-session.json");
    writeFileSync(external, "sentinel", "utf8");
    linkSync(external, join(sessions, "81241.json"));
    expect(() =>
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "impl-hard",
        role: "implementer",
        pid: 81241,
        ppid: 81240,
      }),
    ).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe("sentinel");
  });

  it("refuses a symlinked .olt authority parent without touching its external tree", () => {
    const external = join(sandboxDir, "external-olt");
    const sentinel = join(external, ".sessions", "sentinel");
    rmSync(join(sandboxDir, ".olt"), { recursive: true, force: true });
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, "unchanged", "utf8");
    symlinkSync(external, join(sandboxDir, ".olt"));
    expect(() =>
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "impl-parent-link",
        role: "implementer",
        pid: 81245,
        ppid: 81244,
      }),
    ).toThrow(HarnessError);
    expect(readFileSync(sentinel, "utf8")).toBe("unchanged");
  });

  it("rolls back both required PID records when the second durable record fails", () => {
    const sessions = join(sandboxDir, ".olt", ".sessions");
    const first = join(sessions, "81251.json");
    const second = join(sessions, "81250.json");
    writeFileSync(first, "first-before", "utf8");
    writeFileSync(second, "second-before", "utf8");
    let fsyncs = 0;
    const restore = setSessionPersistenceObserverForTesting((step) => {
      if (step === "file-fsync" && ++fsyncs === 2) throw new Error("second fail");
    });
    try {
      expect(() =>
        registerSessionGrant({
          runRoot: sandboxDir,
          agentId: "impl-rollback",
          role: "implementer",
          pid: 81251,
          ppid: 81250,
        }),
      ).toThrow("second fail");
    } finally {
      restore();
    }
    expect(readFileSync(first, "utf8")).toBe("first-before");
    expect(readFileSync(second, "utf8")).toBe("second-before");
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
    expect(existsSync(join(sandboxDir, ".olt", ".sessions", "81261.json"))).toBe(true);
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

  it("fails registration when process-ancestry session persistence is blocked", () => {
    const globalDir = join(sandboxDir, ".olt", ".sessions");
    const capsuleSessionFile = join(
      sandboxDir,
      "runtime",
      "sessions",
      "impl-persistence-failure.json",
    );
    rmSync(globalDir, { recursive: true, force: true });
    writeFileSync(globalDir, "blocked", "utf8");

    try {
      registerSessionGrant({
        runRoot: sandboxDir,
        agentId: "impl-persistence-failure",
        role: "implementer",
        pid: 42345,
        ppid: 42344,
      });
      expect.unreachable("registration should fail when the process registry cannot be persisted");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain(globalDir);
      expect((error as HarnessError).message).toContain("EEXIST");
    }

    expect(existsSync(capsuleSessionFile)).toBe(false);
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

  it("anchors process-session lookup to the target run repository when cwd is another repository", () => {
    const repoA = join(sandboxDir, "repo-a");
    const repoB = join(sandboxDir, "repo-b");
    mkdirSync(join(repoA, ".olt"), { recursive: true });
    mkdirSync(join(repoB, ".olt"), { recursive: true });

    registerSessionGrant({
      runRoot: repoA,
      agentId: "repo-a-coordinator",
      role: "coordinator",
      pid: process.pid,
      ppid: process.ppid,
    });

    const resolved = resolveActiveSession({
      cwd: repoB,
      runRoot: repoA,
      pid: process.pid,
      ppid: process.ppid,
      env: {},
    });

    expect(resolved?.agent_id).toBe("repo-a-coordinator");
    expect(resolved?.role).toBe("coordinator");
  });

  it("does not authenticate a session registered in cwd repository B for target repository A", () => {
    const repoA = join(sandboxDir, "repo-a");
    const repoB = join(sandboxDir, "repo-b");
    mkdirSync(join(repoA, ".olt"), { recursive: true });
    mkdirSync(join(repoB, ".olt"), { recursive: true });

    registerSessionGrant({
      runRoot: repoB,
      agentId: "repo-b-coordinator",
      role: "coordinator",
      pid: process.pid,
      ppid: process.ppid,
    });

    expect(
      resolveActiveSession({
        cwd: repoB,
        runRoot: repoA,
        pid: process.pid,
        ppid: process.ppid,
        env: {},
      }),
    ).toBeNull();
  });

  it("resolves a relative target runRoot against the supplied cwd", () => {
    const repoA = join(sandboxDir, "repo-a");
    const repoB = join(sandboxDir, "repo-b");
    mkdirSync(join(repoA, ".olt"), { recursive: true });
    mkdirSync(join(repoB, ".olt"), { recursive: true });

    registerSessionGrant({
      runRoot: repoA,
      agentId: "relative-run-coordinator",
      role: "coordinator",
      pid: process.pid,
      ppid: process.ppid,
    });

    const resolved = resolveActiveSession({
      cwd: repoB,
      runRoot: "../repo-a",
      pid: process.pid,
      ppid: process.ppid,
      env: {},
    });

    expect(resolved?.agent_id).toBe("relative-run-coordinator");
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

  it("returns null when persisted and environment session evidence is absent", () => {
    const emptyDir = scratchRoot(import.meta.path, "empty-session");
    const resolved = resolveActiveSession({
      cwd: emptyDir,
      pid: 0,
      ppid: 0,
      env: {},
    });
    expect(resolved).toBeNull();
  });

  it("fails closed when a corrupt process record precedes valid workspace evidence", () => {
    const corruptDir = scratchRoot(import.meta.path, "corrupt-process-workspace");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "55555.json"), "NOT_JSON", "utf8");
    writeFileSync(
      join(corruptDir, ".session.json"),
      JSON.stringify({ agent_id: "workspace-agent", role: "implementer" }),
      "utf8",
    );

    expect(() => resolveActiveSession({ cwd: corruptDir, pid: 55555, ppid: 0, env: {} })).toThrow(
      HarnessError,
    );

    try {
      resolveActiveSession({ cwd: corruptDir, pid: 55555, ppid: 0, env: {} });
    } catch (error: unknown) {
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("process_ancestry_pid_55555");
      expect((error as HarnessError).message).toContain(join(sessionsDir, "55555.json"));
    }
  });

  it("fails closed when a corrupt process record precedes valid environment evidence", () => {
    const corruptDir = scratchRoot(import.meta.path, "corrupt-process-environment");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "55556.json"), "NOT_JSON", "utf8");

    expect(() =>
      resolveActiveSession({
        cwd: corruptDir,
        pid: 55556,
        ppid: 0,
        env: { AGENT_ID: "environment-agent", ROLE: "implementer" },
      }),
    ).toThrow(HarnessError);

    try {
      resolveActiveSession({
        cwd: corruptDir,
        pid: 55556,
        ppid: 0,
        env: { AGENT_ID: "environment-agent", ROLE: "implementer" },
      });
    } catch (error: unknown) {
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("process_ancestry_pid_55556");
      expect((error as HarnessError).message).toContain(join(sessionsDir, "55556.json"));
    }
  });

  it("fails closed when the nearest workspace session is corrupt despite a valid parent identity", () => {
    const workspaceDir = join(scratchRoot(import.meta.path, "corrupt-nearest-workspace"), "child");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, ".session.json"), "{ broken json", "utf8");
    writeFileSync(
      join(dirname(workspaceDir), ".olt-identity.json"),
      JSON.stringify({ agent_id: "parent-agent", role: "implementer" }),
      "utf8",
    );

    expect(() => resolveActiveSession({ cwd: workspaceDir, pid: 0, ppid: 0, env: {} })).toThrow(
      HarnessError,
    );

    try {
      resolveActiveSession({ cwd: workspaceDir, pid: 0, ppid: 0, env: {} });
    } catch (error: unknown) {
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("workspace_directory_session");
      expect((error as HarnessError).message).toContain(join(workspaceDir, ".session.json"));
    }
  });

  it("fails closed when persisted session evidence has an empty agent_id", () => {
    const corruptDir = scratchRoot(import.meta.path, "empty-session-agent-id");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "55557.json");
    writeFileSync(sessionPath, JSON.stringify({ agent_id: "" }), "utf8");

    expect(() => resolveActiveSession({ cwd: corruptDir, pid: 55557, ppid: 0, env: {} })).toThrow(
      HarnessError,
    );

    try {
      resolveActiveSession({ cwd: corruptDir, pid: 55557, ppid: 0, env: {} });
    } catch (error: unknown) {
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("agent_id");
      expect((error as HarnessError).message).toContain(sessionPath);
    }
  });

  it("fails closed when the parent process session is corrupt before a valid child PID record", () => {
    const corruptDir = scratchRoot(import.meta.path, "corrupt-parent-process-precedence");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const parentPath = join(sessionsDir, "55558.json");
    writeFileSync(parentPath, "NOT_JSON", "utf8");
    writeFileSync(
      join(sessionsDir, "55559.json"),
      JSON.stringify({ agent_id: "child-agent", role: "implementer" }),
      "utf8",
    );

    try {
      resolveActiveSession({ cwd: corruptDir, pid: 55559, ppid: 55558, env: {} });
      expect.unreachable("corrupt parent process evidence must take precedence");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("process_ancestry_pid_55558");
      expect((error as HarnessError).message).toContain(parentPath);
    }
  });

  it("treats an injected own-data ENOENT read failure as absent evidence", () => {
    let reads = 0;
    const missing = Object.create(null) as { code?: string; message?: string };
    Object.defineProperty(missing, "code", { value: "ENOENT" });
    Object.defineProperty(missing, "message", { value: "gone" });

    const resolved = resolveWithInjectedRead(
      { cwd: sandboxDir, pid: 55560, ppid: 0, env: {} },
      () => {
        reads += 1;
        throw missing;
      },
    );

    expect(reads).toBeGreaterThan(0);
    expect(resolved).toBeNull();
  });

  it("fails closed for unsafe injected persisted-read error shapes", () => {
    const corruptDir = scratchRoot(import.meta.path, "unreadable-process-record");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    const sessionPath = join(sessionsDir, "55560.json");
    mkdirSync(sessionsDir, { recursive: true });
    let getterRead = false;
    const getterCode = {};
    Object.defineProperty(getterCode, "code", {
      get() {
        getterRead = true;
        return "ENOENT";
      },
    });
    const errorCases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["inherited code", Object.create({ code: "ENOENT" }), "unknown error"],
      ["getter code", getterCode, "unknown error"],
      [
        "proxy descriptor trap",
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw new Error("descriptor trap");
            },
          },
        ),
        "unknown error",
      ],
      ["primitive error", "primitive read failure", "primitive read failure"],
      ["EACCES", { code: "EACCES", message: "permission denied" }, "permission denied"],
    ];

    for (const [name, readError, cause] of errorCases) {
      try {
        resolveWithInjectedRead({ cwd: corruptDir, pid: 55560, ppid: 0, env: {} }, () => {
          throw readError;
        });
        expect.unreachable(`${name} must not be treated as absent`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
        expect((error as HarnessError).message).toContain("process_ancestry_pid_55560");
        expect((error as HarnessError).message).toContain(sessionPath);
        expect((error as HarnessError).message).toContain(cause);
      }
    }

    expect(getterRead).toBe(false);
  });

  it("fails closed for every malformed optional persisted session field", () => {
    const malformedFields: ReadonlyArray<readonly [string, unknown]> = [
      ["role", ""],
      ["role", "   "],
      ["role", null],
      ["role", false],
      ["token", ""],
      ["token", "   "],
      ["token", null],
      ["token", ["tok_hidden_value"]],
      ["can_execute_shell", null],
      ["can_execute_shell", "true"],
      ["can_edit_files", null],
      ["can_edit_files", "false"],
      ["write_scope", "tests/unit"],
      ["write_scope", ["tests/unit", 1]],
      ["task_id", null],
      ["task_id", false],
      ["granted_at", null],
      ["granted_at", false],
    ];
    const corruptDir = scratchRoot(import.meta.path, "malformed-optional-session-fields");
    const sessionsDir = join(corruptDir, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });

    for (const [index, [field, value]] of malformedFields.entries()) {
      const pid = 55600 + index;
      const sessionPath = join(sessionsDir, `${pid}.json`);
      writeFileSync(
        sessionPath,
        JSON.stringify({ agent_id: "valid-agent", [field]: value }),
        "utf8",
      );

      try {
        resolveActiveSession({ cwd: corruptDir, pid, ppid: 0, env: {} });
        expect.unreachable(`malformed ${field} must be rejected`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HarnessError);
        expect((error as HarnessError).code).toBe("INTEGRITY");
        expect((error as HarnessError).message).toContain("process_ancestry_pid_");
        expect((error as HarnessError).message).toContain(sessionPath);
        expect((error as HarnessError).message).not.toContain("tok_hidden_value");
      }
    }
  });

  it("accepts legacy persisted identity records with every optional field omitted", () => {
    const legacyDir = scratchRoot(import.meta.path, "legacy-identity-optional-fields");
    writeFileSync(
      join(legacyDir, ".olt-identity.json"),
      JSON.stringify({ agent_id: "legacy-agent" }),
      "utf8",
    );

    const resolved = resolveActiveSession({ cwd: legacyDir, pid: 0, ppid: 0, env: {} });

    expect(resolved?.agent_id).toBe("legacy-agent");
    expect(resolved?.role).toBe("implementer");
    expect(resolved?.token).toBe("unauthenticated");
    expect(resolved?.mechanisms_detected).toEqual(["workspace_directory_session"]);
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

  it("autoDeriveCallerIdentity returns resolved session identity when active session exists", () => {
    const session = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "agent-caller-1",
      role: "coordinator",
      pid: 33445,
    });

    const resolved = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 33445,
    });

    expect(resolved.actor).toBe("agent-caller-1");
    expect(resolved.role).toBe("coordinator");
    expect(resolved.tier).toBe(2);
    expect(resolved.token).toBe(session.token);
    expect(resolved.mechanisms.some((m) => m.includes("process_ancestry_pid"))).toBe(true);
  });

  it("autoDeriveCallerIdentity falls back to root mind shell when no session or explicit actor is given", () => {
    const defaultCaller = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
    });

    expect(defaultCaller.actor).toBe("mind");
    expect(defaultCaller.role).toBe("mind");
    expect(defaultCaller.tier).toBe(0);
    expect(defaultCaller.mechanisms).toContain("interactive_terminal_fallback");
  });

  it("autoDeriveCallerIdentity handles explicitActor fallback with unmapped role and token", () => {
    const fallbackWithToken = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 0,
      ppid: 0,
      env: {},
      explicitActor: "some-agent-id",
      explicitToken: "tok-explicit-123",
    });

    expect(fallbackWithToken.actor).toBe("some-agent-id");
    expect(fallbackWithToken.token).toBe("tok-explicit-123");
    expect(fallbackWithToken.mechanisms).toContain("interactive_terminal_fallback");
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

  it("does NOT mark a bare registered-session-file caller as verified when no active ledger grant backs it (CRITICAL-1: a session file is just a filesystem-writable JSON blob, forgeable by any caller without ever going through agent:register)", () => {
    const granted = registerSessionGrant({
      runRoot: sandboxDir,
      agentId: "coord-verified",
      role: "coordinator",
      pid: 55123,
    });

    const derived = autoDeriveCallerIdentity({
      cwd: sandboxDir,
      pid: 55123,
      env: {},
    });

    expect(derived.actor).toBe("coord-verified");
    expect(derived.token).toBe(granted.token);
    expect(derived.mechanisms.some((m) => m.startsWith("process_ancestry_pid_"))).toBe(true);
    expect(derived.verified).toBe(false);
  });

  it("marks a caller resolved from a registered session file as verified once it is cross-validated against an active, role-matching grant in the run's own agent ledger", () => {
    const repo = scratchRoot(import.meta.path, "ledger-backed-repo");
    const run = initRun(
      repo,
      "grant-run",
      new TextEncoder().encode("Build the thing"),
      "file",
      true,
    );
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coord-ledger-backed",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const granted = registerSessionGrant({
      runRoot: run,
      agentId: "coord-ledger-backed",
      role: "coordinator",
      pid: 55124,
    });

    const derived = autoDeriveCallerIdentity({
      cwd: run,
      pid: 55124,
      env: {},
      runRoot: run,
    });

    expect(derived.actor).toBe("coord-ledger-backed");
    expect(derived.token).toBe(granted.token);
    expect(derived.mechanisms.some((m) => m.startsWith("process_ancestry_pid_"))).toBe(true);
    expect(derived.verified).toBe(true);
  });

  it("does NOT mark a session file as verified when it names an agent absent from the run's ledger, even though a ledger and other active grants exist", () => {
    const repo = scratchRoot(import.meta.path, "ledger-mismatch-repo");
    const run = initRun(
      repo,
      "grant-run",
      new TextEncoder().encode("Build the thing"),
      "file",
      true,
    );
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "some-other-agent",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    registerSessionGrant({
      runRoot: run,
      agentId: "impostor-mind",
      role: "mind",
      pid: 55125,
    });

    const derived = autoDeriveCallerIdentity({
      cwd: run,
      pid: 55125,
      env: {},
      runRoot: run,
    });

    expect(derived.actor).toBe("impostor-mind");
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

  it("resolveActiveSession handles empty options and resolves global sessions dir with fallback", () => {
    const res = resolveActiveSession({
      cwd: "/tmp/non-repo-dir",
      env: {},
      pid: 0,
      ppid: 0,
    });
    expect(res).toBeNull();
  });

  // Regression test: ensure unqualified/bare run IDs resolve into .olt/capsules/<runId>
  // rather than leaking runtime session directories onto sovereign repository root or cwd.
  it("registers session grant with bare run ID and writes runtime session inside .olt/capsules and NOT on repo root", () => {
    const bareRunId = `test-bare-run-${Date.now()}`;
    const repoRoot = findRepoRoot();
    const expectedCapsuleRunDir = join(resolveCapsulesDir(repoRoot), bareRunId);
    const forbiddenRepoLooseDir = join(repoRoot, bareRunId);
    const forbiddenCwdLooseDir = join(process.cwd(), bareRunId);

    try {
      const session = registerSessionGrant({
        runRoot: bareRunId,
        agentId: "agent-bare-test",
        role: "implementer",
      });

      expect(session.run_id).toBe(bareRunId);
      expect(session.agent_id).toBe("agent-bare-test");
      expect(
        existsSync(join(expectedCapsuleRunDir, "runtime", "sessions", "agent-bare-test.json")),
      ).toBe(true);

      expect(existsSync(forbiddenRepoLooseDir)).toBe(false);
      expect(existsSync(forbiddenCwdLooseDir)).toBe(false);
    } finally {
      if (existsSync(expectedCapsuleRunDir)) {
        rmSync(expectedCapsuleRunDir, { recursive: true, force: true });
      }
      if (existsSync(forbiddenRepoLooseDir)) {
        rmSync(forbiddenRepoLooseDir, { recursive: true, force: true });
      }
      if (existsSync(forbiddenCwdLooseDir)) {
        rmSync(forbiddenCwdLooseDir, { recursive: true, force: true });
      }
    }
  });
});
