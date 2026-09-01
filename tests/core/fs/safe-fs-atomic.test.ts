import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
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
  createSafeFsMockState,
  createSafeFsSpies,
  type SafeFsMockState,
} from "./safe-fs-fixtures.ts";

describe("safe-fs: directory guards and atomic operations", () => {
  let state: SafeFsMockState;
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function makeFixtureRoot(): string {
    const root = `/tmp/virtual/safe-fs-fixture-${++rootCounter}`;
    state.mockDirs.add(root);
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
    state = createSafeFsMockState();
    spies.push(...createSafeFsSpies(state));
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("refuses the current working directory and its ancestors", () => {
    const fixtureRoot = makeFixtureRoot();
    const deepCwd = join(fixtureRoot, "a", "b", "c", "d");
    fs.mkdirSync(deepCwd);

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
    fs.mkdirSync(allowedRoot);
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
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(sibling);

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
    fs.mkdirSync(target);
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
    fs.mkdirSync(join(repo, ".git"));
    const destination = join(root, "moved-out");

    expectRefusal(
      () => safeRenameSync(repo, destination, { allowedRoots: [root] }),
      "REPOSITORY_INTERLOCK",
    );
    expect(fs.existsSync(repo)).toBe(true);

    const plain = join(root, "plain-source");
    fs.mkdirSync(plain);
    safeRenameSync(plain, destination, { allowedRoots: [root] });
    expect(fs.existsSync(plain)).toBe(false);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("refuses safeCpSync onto an existing destination without allowOverwrite", () => {
    const root = makeFixtureRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    fs.mkdirSync(source);
    fs.writeFileSync(join(source, "a.txt"), "one");
    fs.mkdirSync(destination);

    expectRefusal(
      () => safeCpSync(source, destination, { allowedRoots: [root] }),
      "COPY_DESTINATION_EXISTS",
    );

    safeCpSync(source, destination, { allowedRoots: [root], allowOverwrite: true });
    expect(fs.existsSync(join(destination, "a.txt"))).toBe(true);
  });

  it("refuses safeWriteFileSync and safeMkdirSync outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    fs.mkdirSync(allowedRoot);
    const outsideFile = join(root, "outside", "file.txt");
    const outsideDir = join(root, "outside", "dir");

    expectRefusal(
      () => safeWriteFileSync(outsideFile, "data", { allowedRoots: [allowedRoot] }),
      "CONTAINMENT",
    );
    expectRefusal(() => safeMkdirSync(outsideDir, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(fs.existsSync(outsideFile)).toBe(false);
    expect(fs.existsSync(outsideDir)).toBe(false);

    safeWriteFileSync(join(allowedRoot, "inside.txt"), "data", { allowedRoots: [allowedRoot] });
    safeMkdirSync(join(allowedRoot, "inside-dir"), { allowedRoots: [allowedRoot] });
    expect(fs.existsSync(join(allowedRoot, "inside.txt"))).toBe(true);
    expect(fs.existsSync(join(allowedRoot, "inside-dir"))).toBe(true);
  });
});
