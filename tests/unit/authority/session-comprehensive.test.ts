import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertActiveCapsuleLease,
  assertRealDirectory,
  assertSafeSessionComponent,
  assertSessionPid,
  assertSingleLinkRegular,
  autoDeriveCallerIdentity,
  formatSafeErrorCause,
  inferCanExecute,
  isSessionLedgerBacked,
  openVerifiedDirectory,
  pruneStaleSessions,
  readOwnDataString,
  readPersistedSession,
  registerSessionGrant,
  requireTurn1Registration,
  resolveActiveSession,
  resolveCapsuleStateCandidate,
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  revokeSessionGrant,
  rollbackStagedSessionGrant,
  sameInode,
  stageSessionGrant,
  withSessionAuthorityLock,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Authority Session Paths, Resolver, IO, Grants & Interlock Comprehensive", () => {
  test("session paths utilities and validations", () => {
    const scratch = scratchRoot(import.meta.path, "session-paths-test");
    const testDir = join(scratch, "real-dir");
    mkdirSync(testDir, { recursive: true });

    // resolveGlobalSessionsDir
    const globalDir = resolveGlobalSessionsDir(scratch);
    expect(globalDir).toBeDefined();

    // resolveSessionRepositoryRoot
    expect(resolveSessionRepositoryRoot(undefined, scratch)).toBeDefined();
    expect(resolveSessionRepositoryRoot("   ", scratch)).toBeDefined();
    expect(resolveSessionRepositoryRoot(scratch, scratch)).toBeDefined();

    // sameInode
    const stat = assertRealDirectory(testDir, "test directory");
    expect(sameInode(stat, stat)).toBe(true);
    expect(sameInode(stat, { dev: stat.dev + 1, ino: stat.ino })).toBe(false);

    // openVerifiedDirectory
    const opened = openVerifiedDirectory(join(scratch, "new-sub-dir"), true, "new dir");
    expect(opened.fd).toBeGreaterThan(0);
    expect(opened.stat.isDirectory()).toBe(true);

    // assertSingleLinkRegular
    expect(assertSingleLinkRegular(join(scratch, "non-existent-file"))).toBeUndefined();
    const regularFilePath = join(scratch, "regular.json");
    writeFileSync(regularFilePath, "{}", "utf-8");
    expect(assertSingleLinkRegular(regularFilePath)).toBeDefined();

    // assertSafeSessionComponent
    expect(assertSafeSessionComponent("valid-component", "field")).toBe("valid-component");
    expect(() => assertSafeSessionComponent("", "field")).toThrow(
      "must be a safe single path component",
    );
    expect(() => assertSafeSessionComponent(".", "field")).toThrow(
      "must be a safe single path component",
    );
    expect(() => assertSafeSessionComponent("..", "field")).toThrow(
      "must be a safe single path component",
    );
    expect(() => assertSafeSessionComponent("a/b", "field")).toThrow(
      "must be a safe single path component",
    );
    expect(() => assertSafeSessionComponent("a\\b", "field")).toThrow(
      "must be a safe single path component",
    );

    // assertSessionPid
    expect(assertSessionPid(1234, "pid")).toBe(1234);
    expect(() => assertSessionPid(-1, "pid")).toThrow("must be a positive safe integer");
    expect(() => assertSessionPid(0, "pid")).toThrow("must be a positive safe integer");
    expect(() => assertSessionPid(NaN, "pid")).toThrow("must be a positive safe integer");

    // resolveCapsuleStateCandidate
    const capsuleDir = join(scratch, ".olt", "capsules", "run-candidate-1");
    mkdirSync(capsuleDir, { recursive: true });
    writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ run_id: "run-candidate-1" }),
      "utf-8",
    );

    const foundCand = resolveCapsuleStateCandidate("run-candidate-1", scratch);
    expect(foundCand).toBeDefined();
    expect(resolveCapsuleStateCandidate("non-existent-run-xyz", scratch)).toBeUndefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("session io utilities and error formatting", () => {
    expect(formatSafeErrorCause(new Error("custom error"))).toBe("custom error");
    expect(formatSafeErrorCause("string error")).toBe("string error");
    expect(formatSafeErrorCause({ code: "EACCES" })).toBe("unknown error");

    expect(inferCanExecute("implementer")).toEqual({
      can_execute_shell: true,
      can_edit_files: true,
    });
    expect(inferCanExecute("validator")).toEqual({
      can_execute_shell: true,
      can_edit_files: false,
    });
    expect(inferCanExecute("coordinator")).toEqual({
      can_execute_shell: true,
      can_edit_files: false,
    });

    // readOwnDataString
    const errObj = { code: "ENOENT", message: "file not found" };
    expect(readOwnDataString(errObj, "code")).toBe("ENOENT");
    expect(readOwnDataString(errObj, "message")).toBe("file not found");
    expect(readOwnDataString(null, "code")).toBeNull();
    expect(readOwnDataString("primitive", "code")).toBeNull();

    // withSessionAuthorityLock
    const scratch = scratchRoot(import.meta.path, "session-io-test");
    const sessionsDir = join(scratch, ".olt", ".sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const lockResult = withSessionAuthorityLock(scratch, sessionsDir, () => 42);
    expect(lockResult).toBe(42);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("resolveActiveSession across diverse detection mechanisms", () => {
    const scratch = scratchRoot(import.meta.path, "session-resolve-test");
    const capsuleDir = join(scratch, ".olt", "capsules", "run-active-1");
    mkdirSync(capsuleDir, { recursive: true });
    const state = {
      schema_version: 1,
      run_id: "run-active-1",
      tasks: {},
      agents: [
        {
          agent_id: "implementer_task-1",
          role: "implementer",
          status: "active",
          grant: {
            task_id: "task-1",
            write_scope: ["src/file.ts"],
            token: "tok-test-123",
          },
        },
      ],
    };
    writeFileSync(join(capsuleDir, "state.json"), JSON.stringify(state), "utf-8");

    // 1. Resolve via Environment Variables
    const envSession = resolveActiveSession({
      cwd: scratch,
      runRoot: capsuleDir,
      env: {
        HARNESS_TOKEN: "tok_test_env_1",
        AGENT_ID: "coordinator_wave-1",
        ROLE: "coordinator",
      },
    });
    expect(envSession).toBeDefined();
    expect(envSession?.agent_id).toBe("coordinator_wave-1");
    expect(envSession?.role).toBe("coordinator");
    expect(envSession?.token).toBe("tok_test_env_1");

    // 2. Resolve via Workspace Session File
    const workspaceSessionFile = join(scratch, ".session.json");
    writeFileSync(
      workspaceSessionFile,
      JSON.stringify({
        agent_id: "orchestrator_phase-1",
        role: "orchestrator",
        token: "tok_workspace_1",
        can_execute_shell: true,
        can_edit_files: false,
      }),
      "utf-8",
    );

    const wsSession = resolveActiveSession({
      cwd: scratch,
      runRoot: capsuleDir,
      env: {},
    });
    expect(wsSession).toBeDefined();
    expect(wsSession?.role).toBe("orchestrator");

    // 3. Resolve via Process Ancestry PID file
    const globalSessions = resolveGlobalSessionsDir(scratch);
    mkdirSync(globalSessions, { recursive: true });
    const pidSessionFile = join(globalSessions, "98765.json");
    writeFileSync(
      pidSessionFile,
      JSON.stringify({
        agent_id: "implementer_task-1",
        role: "implementer",
        token: "tok-test-123",
        task_id: "task-1",
        write_scope: ["src/file.ts"],
      }),
      "utf-8",
    );

    const pidSession = resolveActiveSession({
      cwd: scratch,
      runRoot: capsuleDir,
      pid: 98765,
      env: {},
    });
    expect(pidSession).toBeDefined();
    expect(pidSession?.task_id).toBe("task-1");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("stageSessionGrant, registerSessionGrant and cleanupSessionGrants lifecycle", () => {
    const scratch = scratchRoot(import.meta.path, "session-grants-test");
    const capsuleDir = join(scratch, ".olt", "capsules", "run-grants-1");
    mkdirSync(capsuleDir, { recursive: true });
    writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ schema_version: 1, run_id: "run-grants-1", tasks: {}, agents: [] }),
      "utf-8",
    );

    // stageSessionGrant
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

    // rollbackStagedSessionGrant
    expect(() => rollbackStagedSessionGrant(staged)).not.toThrow();

    // registerSessionGrant
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

    // revokeSessionGrant
    expect(() =>
      revokeSessionGrant({
        runRoot: capsuleDir,
        agentId: registered.agent_id,
        pid: registered.pid,
        ppid: registered.ppid,
      }),
    ).not.toThrow();

    // pruneStaleSessions
    expect(() => pruneStaleSessions(0)).not.toThrow();

    // autoDeriveCallerIdentity & isSessionLedgerBacked
    const derived = autoDeriveCallerIdentity({
      explicitActor: "implementer_task-1",
      explicitToken: "tok-1",
    });
    expect(derived.actor).toBe("implementer_task-1");
    expect(derived.role).toBe("implementer");
    expect(derived.token).toBe("tok-1");
    expect(derived.verified).toBe(false);

    const ledgerBacked = isSessionLedgerBacked(capsuleDir, "implementer_task-1");
    expect(typeof ledgerBacked).toBe("boolean");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("requireTurn1Registration edge cases and failures", () => {
    expect(() => requireTurn1Registration(null as unknown as SessionIdentity)).toThrow(
      "session identity is required",
    );

    expect(() =>
      requireTurn1Registration({
        agent_id: "a1",
        role: "implementer",
        tier: 3,
        token: "unauthenticated",
        pid: 1,
        ppid: 1,
        host: "generic",
        granted_at: new Date().toISOString(),
        mechanisms_detected: ["registration"],
      }),
    ).toThrow("unauthenticated: turn 1 registration token required");

    expect(() =>
      requireTurn1Registration({
        agent_id: "a1",
        role: "implementer",
        tier: 3,
        token: "tok_valid",
        pid: 1,
        ppid: 1,
        host: "generic",
        granted_at: new Date().toISOString(),
        mechanisms_detected: ["interactive_terminal_fallback"],
      }),
    ).toThrow("missing run_id in session identity");

    expect(() =>
      requireTurn1Registration({
        agent_id: "a1",
        role: "implementer",
        tier: 3,
        token: "tok_valid",
        run_id: "run-non-existent-xyz",
        pid: 1,
        ppid: 1,
        host: "generic",
        granted_at: new Date().toISOString(),
        mechanisms_detected: ["interactive_terminal_fallback"],
      }),
    ).toThrow("no valid durable registration mechanism");
  });
});
