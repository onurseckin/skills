import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { dirname, join, resolve, sep } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertSafeToDelete,
  safeCpSync,
  safeMkdirSync,
  safeRenameSync,
  safeRmSync,
  safeWriteFileSync,
  type DestructiveAuditEvent,
} from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("safe-fs: directory guards and atomic operations", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let rootCounter = 0;

  function makeFixtureRoot(): string {
    const root = `/virtual/safe-fs-fixture-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    return root;
  }

  function expectRefusal(fn: () => void, rule: string): HarnessError {
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("PATH_SAFETY");
    expect(error.message).toContain(rule);
    return error;
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("refuses the current working directory and its ancestors", () => {
    const fixtureRoot = makeFixtureRoot();
    const deepCwd = join(fixtureRoot, "a", "b", "c", "d");
    vfs.mkdirSync(deepCwd, { recursive: true });

    const cwdSpy = spyOn(process, "cwd").mockReturnValue(deepCwd);
    try {
      expectRefusal(
        () => safeRmSync(deepCwd, { allowedRoots: [dirname(deepCwd)] }),
        "ABSOLUTE_DENYLIST_CWD",
      );
      const ancestor = dirname(deepCwd);
      expectRefusal(
        () => safeRmSync(ancestor, { allowedRoots: [dirname(ancestor)] }),
        "ABSOLUTE_DENYLIST_CWD_ANCESTOR",
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("refuses paths with fewer than the minimum number of segments", () => {
    const shallow = `${sep}shallow-root-guard-test`;
    expectRefusal(
      () => safeRmSync(shallow, { allowedRoots: [sep] }),
      "ABSOLUTE_DENYLIST_TOO_SHALLOW",
    );
  });

  it("throws when the target does not exist and missingOk is not set", () => {
    const root = makeFixtureRoot();
    const missing = join(root, "does-not-exist");
    let caught: unknown;
    try {
      safeRmSync(missing, { allowedRoots: [root] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("INVALID_STATE");
  });

  it("is a no-op when the target does not exist and missingOk is set", () => {
    const root = makeFixtureRoot();
    const missing = join(root, "does-not-exist");
    expect(() => safeRmSync(missing, { allowedRoots: [root], missingOk: true })).not.toThrow();
    const result = assertSafeToDelete(missing, { allowedRoots: [root], missingOk: true });
    expect(result.exists).toBe(false);
  });

  it("still enforces containment refusal even when missingOk is set", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    vfs.mkdirSync(allowedRoot, { recursive: true });
    const outsideMissing = join(root, "outside-missing");

    expectRefusal(
      () => safeRmSync(outsideMissing, { allowedRoots: [allowedRoot], missingOk: true }),
      "CONTAINMENT",
    );
  });

  it("names the target, the rule, and the allowed roots in a refusal message", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    vfs.mkdirSync(allowedRoot, { recursive: true });
    vfs.mkdirSync(sibling, { recursive: true });

    let caught: unknown;
    try {
      safeRmSync(sibling, { allowedRoots: [allowedRoot] });
    } catch (error) {
      caught = error;
    }
    const error = caught as HarnessError;
    expect(error).toBeInstanceOf(HarnessError);
    expect(error.message).toContain(sibling);
    expect(error.message).toContain(allowedRoot);
    expect(error.message).toContain("CONTAINMENT");
    expect(error.issues[0]).toMatchObject({
      rule: "CONTAINMENT",
      target: sibling,
      allowedRoots: [allowedRoot],
    });
  });

  it("records a successful delete through the audit hook", () => {
    const root = makeFixtureRoot();
    const target = join(root, "audited");
    vfs.mkdirSync(target, { recursive: true });
    const events: DestructiveAuditEvent[] = [];

    safeRmSync(target, { allowedRoots: [root], onAudit: (event) => events.push(event) });

    expect(events).toHaveLength(1);
    expect(events[0]?.operation).toBe("delete");
    expect(events[0]?.resolvedPath).toBe(resolve(target));
    expect(typeof events[0]?.timestamp).toBe("string");
  });

  it("guards safeRenameSync source the same way as a delete", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    const destination = join(root, "moved-out");

    expectRefusal(
      () => safeRenameSync(repo, destination, { allowedRoots: [root] }),
      "REPOSITORY_INTERLOCK",
    );
    expect(vfs.existsSync(repo)).toBe(true);

    const plain = join(root, "plain-source");
    vfs.mkdirSync(plain, { recursive: true });
    safeRenameSync(plain, destination, { allowedRoots: [root] });
    expect(vfs.existsSync(plain)).toBe(false);
    expect(vfs.existsSync(destination)).toBe(true);
  });

  it("refuses safeCpSync onto an existing destination without allowOverwrite", () => {
    const root = makeFixtureRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    vfs.mkdirSync(source, { recursive: true });
    vfs.writeFileSync(join(source, "a.txt"), "one");
    vfs.mkdirSync(destination, { recursive: true });

    expectRefusal(
      () => safeCpSync(source, destination, { allowedRoots: [root] }),
      "COPY_DESTINATION_EXISTS",
    );

    safeCpSync(source, destination, { allowedRoots: [root], allowOverwrite: true });
    expect(vfs.existsSync(join(destination, "a.txt"))).toBe(true);
  });

  it("refuses safeWriteFileSync and safeMkdirSync outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    vfs.mkdirSync(allowedRoot, { recursive: true });
    const outsideFile = join(root, "outside", "file.txt");
    const outsideDir = join(root, "outside", "dir");

    expectRefusal(
      () => safeWriteFileSync(outsideFile, "data", { allowedRoots: [allowedRoot] }),
      "CONTAINMENT",
    );
    expectRefusal(() => safeMkdirSync(outsideDir, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(vfs.existsSync(outsideFile)).toBe(false);
    expect(vfs.existsSync(outsideDir)).toBe(false);

    safeWriteFileSync(join(allowedRoot, "inside.txt"), "data", { allowedRoots: [allowedRoot] });
    safeMkdirSync(join(allowedRoot, "inside-dir"), { allowedRoots: [allowedRoot] });
    expect(vfs.existsSync(join(allowedRoot, "inside.txt"))).toBe(true);
    expect(vfs.existsSync(join(allowedRoot, "inside-dir"))).toBe(true);
  });
});
