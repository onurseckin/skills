import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  FALLBACK_MARKER,
  guardedRemoveSync,
  logDestructiveOp,
  smartEnsureSymlink,
} from "../../../scripts/sync/fs-helpers.ts";
import { cleanupVirtualSyncFS, scratchRoot, setupVirtualSyncFS } from "../../sync/sync-fixture.ts";

beforeEach(() => {
  setupVirtualSyncFS();
});
afterEach(() => {
  cleanupVirtualSyncFS();
});

function initRealGitRepoAt(dirPath: string): void {
  mkdirSync(join(dirPath, ".git"), { recursive: true });
  writeFileSync(join(dirPath, "precious.txt"), "do-not-delete-me\n", "utf-8");
}

function setupAssistantRoots(testName: string) {
  const root = scratchRoot(import.meta.path, testName);
  const assistantDir = join(root, "assistant-skills");
  const targetOlt = join(root, "olt-deployment");
  mkdirSync(assistantDir, { recursive: true });
  mkdirSync(targetOlt, { recursive: true });
  return { root, assistantDir, targetOlt, linkPath: join(assistantDir, "olt") };
}

describe("logDestructiveOp", () => {
  test("writes audit event JSON to stderr", () => {
    let captured = "";
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      logDestructiveOp({
        operation: "delete",
        requestedPath: "/tmp/foo",
        resolvedPath: "/tmp/foo",
        timestamp: "2026-08-30T00:00:00Z",
      });
      expect(captured).toContain("[sync-audit]");
      expect(captured).toContain('"requestedPath":"/tmp/foo"');
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

describe("smartEnsureSymlink refuses to destroy a real directory", () => {
  test("a real git-repo directory at the link path throws and survives untouched", () => {
    const { assistantDir, targetOlt, linkPath } = setupAssistantRoots("symlink-vs-git-repo");
    writeFileSync(join(targetOlt, "SKILL.md"), "canonical\n", "utf-8");
    initRealGitRepoAt(linkPath);

    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );
    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(false);
    expect(existsSync(join(linkPath, ".git"))).toBe(true);
    expect(readFileSync(join(linkPath, "precious.txt"), "utf-8")).toBe("do-not-delete-me\n");
  });

  test("a real plain directory (no .git) at the link path also throws and survives untouched", () => {
    const { assistantDir, targetOlt, linkPath } = setupAssistantRoots("symlink-vs-plain-dir");
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "keepme.txt"), "still-here\n", "utf-8");

    let caught: unknown;
    try {
      smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("PATH_SAFETY");
    expect((caught as HarnessError).message).toContain(linkPath);
    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isDirectory()).toBe(true);
    expect(readFileSync(join(linkPath, "keepme.txt"), "utf-8")).toBe("still-here\n");
  });

  test("a real file at the link path throws and survives untouched", () => {
    const { assistantDir, targetOlt, linkPath } = setupAssistantRoots("symlink-vs-plain-file");
    writeFileSync(linkPath, "not-a-symlink\n", "utf-8");

    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );
    expect(readFileSync(linkPath, "utf-8")).toBe("not-a-symlink\n");
  });

  test("throws when readExistingEntry encounters non-ENOENT error", () => {
    const root = scratchRoot(import.meta.path, "symlink-non-enoent");
    const linkPath = join(root, "test-entry");
    const customDriver = {
      lstatSync: () => {
        const err = new Error("Permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
    };
    expect(() =>
      smartEnsureSymlink(join(root, "target"), linkPath, {
        allowedRoots: [root],
        fsDriver: customDriver,
      }),
    ).toThrow("Permission denied");
  });

  test("describeKind covers non-symlink non-file non-directory branch", () => {
    const root = scratchRoot(import.meta.path, "symlink-other-kind");
    const mockStats = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as unknown as Stats;
    expect(() =>
      smartEnsureSymlink(join(root, "target"), join(root, "special"), {
        allowedRoots: [root],
        fsDriver: { lstatSync: () => mockStats },
      }),
    ).toThrow(HarnessError);
  });
});

describe("smartEnsureSymlink normal operation", () => {
  test("creates a symlink atomically where nothing existed before", () => {
    const { assistantDir, targetOlt, linkPath } = setupAssistantRoots("symlink-create");
    const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });
    expect(status).toBe("created");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(targetOlt);
  });

  test("is idempotent when the symlink already points at target", () => {
    const { assistantDir, targetOlt, linkPath } = setupAssistantRoots("symlink-idempotent");
    symlinkSync(targetOlt, linkPath);
    const status = smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] });
    expect(status).toBe("skipped");
    expect(readlinkSync(linkPath)).toBe(targetOlt);
  });

  test("re-points a stale symlink that targets something else atomically", () => {
    const { root, assistantDir, linkPath } = setupAssistantRoots("symlink-repoint");
    const oldTarget = join(root, "old-olt-deployment");
    const newTarget = join(root, "new-olt-deployment");
    mkdirSync(oldTarget, { recursive: true });
    mkdirSync(newTarget, { recursive: true });

    symlinkSync(oldTarget, linkPath);
    const status = smartEnsureSymlink(newTarget, linkPath, { allowedRoots: [assistantDir] });
    expect(status).toBe("created");
    expect(readlinkSync(linkPath)).toBe(newTarget);
  });

  test("re-points a broken symlink where readlinkSync throws", () => {
    const { root, assistantDir, linkPath } = setupAssistantRoots("symlink-broken-readlink");
    const newTarget = join(root, "new-olt-deployment");
    mkdirSync(newTarget, { recursive: true });

    symlinkSync(join(root, "non-existent-target"), linkPath);

    const status = smartEnsureSymlink(newTarget, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: {
        readlinkSync: () => {
          throw new Error("Broken link read error");
        },
      },
    });
    expect(status).toBe("created");
  });

  test("falls back to safeCpSync if symlinkSync throws", () => {
    const { root, assistantDir } = setupAssistantRoots("symlink-fallback-cp");
    const targetFile = join(root, "target.txt");
    writeFileSync(targetFile, "content-to-copy", "utf-8");

    const linkPath = join(assistantDir, "copied-file.txt");
    const status = smartEnsureSymlink(targetFile, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: {
        symlinkSync: () => {
          throw new Error("Operation not supported");
        },
      },
    });
    expect(status).toBe("created");
    expect(existsSync(linkPath)).toBe(true);
    expect(readFileSync(linkPath, "utf-8")).toBe("content-to-copy");
  });

  test("tags directory fallback copy with marker and permits subsequent sync runs", () => {
    const { root, assistantDir } = setupAssistantRoots("symlink-fallback-dir");
    const targetDir = join(root, "canonical-skill-dir");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "canonical\n", "utf-8");

    const linkPath = join(assistantDir, "olt");
    const mockDriver = {
      symlinkSync: () => {
        throw new Error("Operation not supported");
      },
    };
    const status1 = smartEnsureSymlink(targetDir, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: mockDriver,
    });
    expect(status1).toBe("created");
    expect(existsSync(join(linkPath, FALLBACK_MARKER))).toBe(true);

    const status2 = smartEnsureSymlink(targetDir, linkPath, {
      allowedRoots: [assistantDir],
      fsDriver: mockDriver,
    });
    expect(status2).toBe("created");
    expect(existsSync(join(linkPath, "SKILL.md"))).toBe(true);
  });

  test("refuses when the link path falls outside the declared allowed roots", () => {
    const { root, assistantDir, targetOlt } = setupAssistantRoots("symlink-outside-root");
    const otherDir = join(root, "unrelated-dir");
    mkdirSync(otherDir, { recursive: true });

    const linkPath = join(otherDir, "olt");
    expect(() => smartEnsureSymlink(targetOlt, linkPath, { allowedRoots: [assistantDir] })).toThrow(
      HarnessError,
    );
    expect(existsSync(linkPath)).toBe(false);
  });
});

describe("guardedRemoveSync", () => {
  test("removes a plain file inside the allowed root", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-file");
    const victim = join(root, "nested", "victim.txt");
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(victim, "gone-soon\n", "utf-8");

    const audits: unknown[] = [];
    guardedRemoveSync(victim, { allowedRoots: [root], onAudit: (e) => audits.push(e) });
    expect(existsSync(victim)).toBe(false);
    expect(audits.length).toBeGreaterThan(0);
  });

  test("is a no-op by default when the target is already missing", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-missing");
    expect(() =>
      guardedRemoveSync(join(root, "never-existed"), { allowedRoots: [root] }),
    ).not.toThrow();
  });

  test("refuses to delete a directory containing a .git entry without an explicit override", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo");
    const repoDir = join(root, "some-repo");
    initRealGitRepoAt(repoDir);
    expect(() => guardedRemoveSync(repoDir, { allowedRoots: [root] })).toThrow(HarnessError);
    expect(existsSync(repoDir)).toBe(true);
    expect(existsSync(join(repoDir, ".git"))).toBe(true);
  });

  test("allows deleting git repo when allowGitRepositoryDeletion is true", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-git-repo-override");
    const repoDir = join(root, "removable-repo");
    initRealGitRepoAt(repoDir);
    guardedRemoveSync(repoDir, { allowedRoots: [root], allowGitRepositoryDeletion: true });
    expect(existsSync(repoDir)).toBe(false);
  });

  test("refuses to delete outside the declared allowed roots even when the caller asks", () => {
    const root = scratchRoot(import.meta.path, "guarded-remove-outside-root");
    const allowedRoot = join(root, "allowed");
    const sibling = join(root, "sibling");
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "keep.txt"), "keep\n", "utf-8");
    expect(() => guardedRemoveSync(sibling, { allowedRoots: [allowedRoot] })).toThrow(HarnessError);
    expect(existsSync(join(sibling, "keep.txt"))).toBe(true);
  });
});
