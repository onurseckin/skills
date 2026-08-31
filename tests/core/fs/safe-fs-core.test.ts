import { describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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

function makeFixtureRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "safe-fs-test-")));
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

describe("safe-fs destructive guard", () => {
  it("succeeds deleting a directory strictly inside an allowed root", () => {
    const root = makeFixtureRoot();
    const target = join(root, "nested", "victim");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "file.txt"), "data");

    safeRmSync(target, { allowedRoots: [root] });

    expect(existsSync(target)).toBe(false);
    expect(existsSync(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to delete the allowed root itself", () => {
    const root = makeFixtureRoot();
    const error = expectRefusal(() => safeRmSync(root, { allowedRoots: [root] }), "CONTAINMENT");
    expect(error.message).toContain(root);
    expect(existsSync(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to delete an ancestor of an allowed root", () => {
    const root = makeFixtureRoot();
    const nestedRoot = join(root, "nested-root");
    mkdirSync(nestedRoot, { recursive: true });

    expectRefusal(() => safeRmSync(root, { allowedRoots: [nestedRoot] }), "CONTAINMENT");

    expect(existsSync(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to delete a sibling directory outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(sibling, { recursive: true });

    expectRefusal(() => safeRmSync(sibling, { allowedRoots: [allowedRoot] }), "CONTAINMENT");

    expect(existsSync(sibling)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a symlinked parent that redirects the target outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const outside = join(root, "outside");
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leaf.txt"), "secret");
    symlinkSync(outside, join(allowedRoot, "escape"));

    const target = join(allowedRoot, "escape", "leaf.txt");
    expectRefusal(() => safeRmSync(target, { allowedRoots: [allowedRoot] }), "CONTAINMENT");

    expect(existsSync(join(outside, "leaf.txt"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("deletes a symlink itself without following it into the real target", () => {
    const root = makeFixtureRoot();
    const realTarget = join(root, "real-target");
    mkdirSync(realTarget, { recursive: true });
    writeFileSync(join(realTarget, "keep.txt"), "keep me");
    const linkPath = join(root, "link-to-target");
    symlinkSync(realTarget, linkPath);

    safeRmSync(linkPath, { allowedRoots: [root] });

    expect(() => lstatSync(linkPath)).toThrow();
    expect(existsSync(realTarget)).toBe(true);
    expect(readFileSync(join(realTarget, "keep.txt"), "utf8")).toBe("keep me");
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to recursively delete a directory that itself contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });

    expectRefusal(() => safeRmSync(repo, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");

    expect(existsSync(repo)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to delete a subdirectory whose ancestor up to the allowed root contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    expectRefusal(() => safeRmSync(nested, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");

    expect(existsSync(nested)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows deleting inside a git-bearing tree only with an explicit override", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    safeRmSync(nested, { allowedRoots: [root], allowGitRepositoryDeletion: true });

    expect(existsSync(nested)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses the filesystem root regardless of allowed roots", () => {
    expectRefusal(
      () => safeRmSync("/", { allowedRoots: ["/"] }),
      "ABSOLUTE_DENYLIST_FILESYSTEM_ROOT",
    );
    expect(existsSync("/")).toBe(true);
  });

  it("refuses the user's home directory regardless of allowed roots", () => {
    const home = resolve(homedir());
    expectRefusal(
      () => safeRmSync(home, { allowedRoots: [dirname(home)] }),
      "ABSOLUTE_DENYLIST_HOME_DIRECTORY",
    );
    expect(existsSync(home)).toBe(true);
  });

  it("refuses a direct child of the home directory regardless of allowed roots", () => {
    const home = resolve(homedir());
    const homeChild = join(home, "some-direct-child-that-should-never-be-touched");
    expectRefusal(
      () => safeRmSync(homeChild, { allowedRoots: [home] }),
      "ABSOLUTE_DENYLIST_HOME_CHILD",
    );
  });
});

