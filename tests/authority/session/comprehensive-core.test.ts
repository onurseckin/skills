import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  assertSafeSessionComponent,
  assertSessionPid,
  formatSafeErrorCause,
  inferCanExecute,
  readOwnDataString,
  resolveCapsuleStateCandidate,
  resolveGlobalSessionsDir,
  resolveSessionRepositoryRoot,
  sameInode,
  enableInMemorySessionStore,
  disableInMemorySessionStore,
  setInMemorySessionData,
} from "../../../olt/scripts/src/authority/session/index.ts";

describe("Authority Session Comprehensive - Core Paths & Validation", () => {
  beforeEach(() => {
    enableInMemorySessionStore();
  });

  afterEach(() => {
    disableInMemorySessionStore();
  });

  test("session paths utilities and validations", () => {
    const sandboxDir = "/virtual/sandbox";

    const globalDir = resolveGlobalSessionsDir(sandboxDir);
    expect(globalDir).toBeDefined();
    const globalDefault = resolveGlobalSessionsDir();
    expect(globalDefault).toBeDefined();

    expect(resolveSessionRepositoryRoot(undefined, sandboxDir)).toBeDefined();
    expect(resolveSessionRepositoryRoot("   ", sandboxDir)).toBeDefined();
    expect(resolveSessionRepositoryRoot(sandboxDir, sandboxDir)).toBeDefined();

    const fakeStat = { dev: 1, ino: 100 };
    expect(sameInode(fakeStat, fakeStat)).toBe(true);
    expect(sameInode(fakeStat, { dev: 2, ino: 100 })).toBe(false);

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

    expect(assertSessionPid(1234, "pid")).toBe(1234);
    expect(() => assertSessionPid(-1, "pid")).toThrow("must be a positive safe integer");
    expect(() => assertSessionPid(0, "pid")).toThrow("must be a positive safe integer");
    expect(() => assertSessionPid(NaN, "pid")).toThrow("must be a positive safe integer");
  });

  test("resolveCapsuleStateCandidate with in-memory paths", () => {
    const sandbox = "/virtual/capsule-test";
    const capsuleDir = `${sandbox}/.olt/capsules/run-candidate-1`;
    setInMemorySessionData(
      `${capsuleDir}/state.json`,
      JSON.stringify({ run_id: "run-candidate-1" }),
    );

    const foundCand = resolveCapsuleStateCandidate("run-candidate-1", sandbox);
    expect(foundCand).toBeDefined();

    const looseCapsuleDir = `${sandbox}/capsules/run-candidate-2`;
    setInMemorySessionData(
      `${looseCapsuleDir}/state.json`,
      JSON.stringify({ run_id: "run-candidate-2" }),
    );
    const foundLoose = resolveCapsuleStateCandidate("run-candidate-2", sandbox);
    expect(foundLoose).toBeDefined();

    const foundDirect = resolveCapsuleStateCandidate(looseCapsuleDir);
    expect(foundDirect).toBeDefined();

    expect(resolveCapsuleStateCandidate("non-existent-run-xyz", sandbox)).toBeUndefined();
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

    const errObj = { code: "ENOENT", message: "file not found" };
    expect(readOwnDataString(errObj, "code")).toBe("ENOENT");
    expect(readOwnDataString(errObj, "message")).toBe("file not found");
    expect(readOwnDataString(null, "code")).toBeNull();
    expect(readOwnDataString("primitive", "code")).toBeNull();
  });
});
