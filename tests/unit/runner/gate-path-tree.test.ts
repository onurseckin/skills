import { describe, expect, test } from "bun:test";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureOpenedPath,
  createGateCaptureBudget,
  openGatePath,
  MAX_GATE_PATH_BINDINGS,
} from "../../../olt/scripts/src/engine/runner/gate-path-tree.ts";

describe("gate-path-tree", () => {
  test("captures file and directory bindings with tree digest", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const subDir = join(repoRoot, "dir");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "file1.txt"), "hello");
    writeFileSync(join(subDir, "file2.txt"), "world");

    const fileFd = openGatePath(join(subDir, "file1.txt"));
    const fileBinding = captureOpenedPath(fileFd, repoRoot, {
      argv_index: 0,
      argument: "./dir/file1.txt",
      operand: "./dir/file1.txt",
      scope: "repository",
      role: "target",
      canonical_path: join(subDir, "file1.txt"),
      executable: false,
    });
    closeSync(fileFd);
    expect(fileBinding.kind).toBe("file");
    expect(fileBinding.bytes).toBe(5);

    const dirFd = openGatePath(subDir);
    const dirBinding = captureOpenedPath(dirFd, repoRoot, {
      argv_index: 1,
      argument: "./dir",
      operand: "./dir",
      scope: "repository",
      role: "target",
      canonical_path: subDir,
      executable: false,
    });
    closeSync(dirFd);
    expect(dirBinding.kind).toBe("directory");
    expect(dirBinding.entries).toBe(2);
    expect(dirBinding.tree_bytes).toBe(10);
    expect(dirBinding.tree_sha256).toBeDefined();
  });

  test("rejects system scope on directory", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const dirFd = openGatePath(repoRoot);
    try {
      expect(() =>
        captureOpenedPath(dirFd, repoRoot, {
          argv_index: 0,
          argument: "dir",
          operand: repoRoot,
          scope: "system",
          role: "executable",
          canonical_path: repoRoot,
          executable: true,
        }),
      ).toThrow("system executable cannot be a directory");
    } finally {
      closeSync(dirFd);
    }
  });

  test("rejects when binding budget limit is exceeded", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const filePath = join(repoRoot, "a.txt");
    writeFileSync(filePath, "a");
    const fd = openGatePath(filePath);
    try {
      const budget = createGateCaptureBudget();
      budget.bindings = MAX_GATE_PATH_BINDINGS;
      expect(() =>
        captureOpenedPath(
          fd,
          repoRoot,
          {
            argv_index: 0,
            argument: "./a.txt",
            operand: "./a.txt",
            scope: "repository",
            role: "target",
            canonical_path: filePath,
            executable: false,
          },
          {},
          budget,
        ),
      ).toThrow("gate path capture exceeds binding limit");
    } finally {
      closeSync(fd);
    }
  });

  test("rejects directory containing symlinks or unsafe entries", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const subDir = join(repoRoot, "sub");
    mkdirSync(subDir);
    writeFileSync(join(repoRoot, "target.txt"), "target");
    symlinkSync(join(repoRoot, "target.txt"), join(subDir, "link.txt"));

    const dirFd = openGatePath(subDir);
    try {
      expect(() =>
        captureOpenedPath(dirFd, repoRoot, {
          argv_index: 0,
          argument: "./sub",
          operand: "./sub",
          scope: "repository",
          role: "target",
          canonical_path: subDir,
          executable: false,
        }),
      ).toThrow("gate tree must not contain symbolic links");
    } finally {
      closeSync(dirFd);
    }
  });

  test("rejects unsafe entries or non-regular files in directory tree", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const subDir = join(repoRoot, "sub");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "file.txt"), "content");

    const dirFd = openGatePath(subDir);
    try {
      // Non-regular file hook
      expect(() =>
        captureOpenedPath(
          dirFd,
          repoRoot,
          {
            argv_index: 0,
            argument: "./sub",
            operand: "./sub",
            scope: "repository",
            role: "target",
            canonical_path: subDir,
            executable: false,
          },
          {
            lstatPath: () =>
              ({
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
              }) as never,
          },
        ),
      ).toThrow("gate tree entry is not a regular file or directory");

      // openPath error hook
      expect(() =>
        captureOpenedPath(
          dirFd,
          repoRoot,
          {
            argv_index: 0,
            argument: "./sub",
            operand: "./sub",
            scope: "repository",
            role: "target",
            canonical_path: subDir,
            executable: false,
          },
          {
            openPath: () => {
              throw new Error("open failure");
            },
          },
        ),
      ).toThrow("gate tree contains an unsafe entry");
    } finally {
      closeSync(dirFd);
    }
  });

  test("rejects directory entries exceeding limit or custom directory reader", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "tree-bind-")));
    const subDir = join(repoRoot, "sub");
    mkdirSync(subDir);
    const dirFd = openGatePath(subDir);
    try {
      let readCount = 0;
      expect(() =>
        captureOpenedPath(
          dirFd,
          repoRoot,
          {
            argv_index: 0,
            argument: "./sub",
            operand: "./sub",
            scope: "repository",
            role: "target",
            canonical_path: subDir,
            executable: false,
          },
          {
            openDirectory: () => ({
              readSync: () => {
                readCount += 1;
                return readCount > 15_000 ? null : `f${readCount}`;
              },
              closeSync: () => undefined,
            }),
          },
        ),
      ).toThrow("gate-bound directory exceeds entry limit");
    } finally {
      closeSync(dirFd);
    }
  });
});
