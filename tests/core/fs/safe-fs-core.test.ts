import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { safeRmSync } from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("safe-fs destructive guard", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let rootCounter = 0;

  function makeFixtureRoot(): string {
    const root = `/tmp/virtual/safe-fs-test-${++rootCounter}`;
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
    const home = resolve(homedir());
    vfs.mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  it("succeeds deleting a directory strictly inside an allowed root", () => {
    const root = makeFixtureRoot();
    const target = join(root, "nested", "victim");
    vfs.mkdirSync(target, { recursive: true });
    vfs.writeFileSync(join(target, "file.txt"), "data");

    safeRmSync(target, { allowedRoots: [root] });

    expect(vfs.existsSync(target)).toBe(false);
    expect(vfs.existsSync(root)).toBe(true);
  });

  it("refuses to delete the allowed root itself", () => {
    const root = makeFixtureRoot();
    const error = expectRefusal(() => safeRmSync(root, { allowedRoots: [root] }), "CONTAINMENT");
    expect(error.message).toContain(root);
    expect(vfs.existsSync(root)).toBe(true);
  });

  it("refuses to delete an ancestor of an allowed root", () => {
    const root = makeFixtureRoot();
    const nestedRoot = join(root, "nested-root");
    vfs.mkdirSync(nestedRoot, { recursive: true });

    expectRefusal(() => safeRmSync(root, { allowedRoots: [nestedRoot] }), "CONTAINMENT");
    expect(vfs.existsSync(root)).toBe(true);
  });

  it("refuses to delete a sibling directory outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    vfs.mkdirSync(allowedRoot, { recursive: true });
    vfs.mkdirSync(sibling, { recursive: true });

    expectRefusal(() => safeRmSync(sibling, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(vfs.existsSync(sibling)).toBe(true);
  });

  it("refuses a symlinked parent that redirects the target outside the allowed root", () => {
    const root = makeFixtureRoot();
    const allowedRoot = join(root, "allowed");
    const outside = join(root, "outside");
    vfs.mkdirSync(allowedRoot, { recursive: true });
    vfs.mkdirSync(outside, { recursive: true });
    vfs.writeFileSync(join(outside, "leaf.txt"), "secret");
    session.symlinkSync(outside, join(allowedRoot, "escape"));

    const target = join(allowedRoot, "escape", "leaf.txt");
    expectRefusal(() => safeRmSync(target, { allowedRoots: [allowedRoot] }), "CONTAINMENT");
    expect(vfs.existsSync(join(outside, "leaf.txt"))).toBe(true);
  });

  it("deletes a symlink itself without following it into the real target", () => {
    const root = makeFixtureRoot();
    const realTarget = join(root, "real-target");
    vfs.mkdirSync(realTarget, { recursive: true });
    vfs.writeFileSync(join(realTarget, "keep.txt"), "keep me");
    const linkPath = join(root, "link-to-target");
    session.symlinkSync(realTarget, linkPath);

    safeRmSync(linkPath, { allowedRoots: [root] });

    expect(session.symlinks.has(linkPath)).toBe(false);
    expect(vfs.existsSync(linkPath)).toBe(false);
    expect(vfs.existsSync(realTarget)).toBe(true);
    expect(vfs.readFileSync(join(realTarget, "keep.txt"), "utf8")).toBe("keep me");
  });

  it("refuses to recursively delete a directory that itself contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });

    expectRefusal(() => safeRmSync(repo, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");
    expect(vfs.existsSync(repo)).toBe(true);
  });

  it("refuses to delete a subdirectory whose ancestor up to the allowed root contains .git", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.mkdirSync(nested, { recursive: true });

    expectRefusal(() => safeRmSync(nested, { allowedRoots: [root] }), "REPOSITORY_INTERLOCK");
    expect(vfs.existsSync(nested)).toBe(true);
  });

  it("allows deleting inside a git-bearing tree only with an explicit override", () => {
    const root = makeFixtureRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "sub", "dir");
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    vfs.mkdirSync(nested, { recursive: true });

    safeRmSync(nested, { allowedRoots: [root], allowGitRepositoryDeletion: true });
    expect(vfs.existsSync(nested)).toBe(false);
  });

  it("refuses the filesystem root regardless of allowed roots", () => {
    expectRefusal(
      () => safeRmSync("/", { allowedRoots: ["/"] }),
      "ABSOLUTE_DENYLIST_FILESYSTEM_ROOT",
    );
    expect(vfs.existsSync("/")).toBe(true);
  });

  it("refuses the user's home directory regardless of allowed roots", () => {
    const home = resolve(homedir());
    expectRefusal(
      () => safeRmSync(home, { allowedRoots: [dirname(home)] }),
      "ABSOLUTE_DENYLIST_HOME_DIRECTORY",
    );
    expect(vfs.existsSync(home)).toBe(true);
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
