import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  captureOpenedPath,
  createGateCaptureBudget,
  openGatePath,
  MAX_GATE_PATH_BINDINGS,
} from "../../../olt/scripts/src/engine/runner/signing/gate-path-tree.ts";
import {
  tempRoot,
  setupVirtualRunnerFS,
  cleanupVirtualRunnerFS,
  createVirtualSymlink,
  closeSync,
} from "../command/fixture.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualRunnerFS();
});

afterEach(cleanupVirtualRunnerFS);

describe("gate-path-tree", () => {
  test("captures file and directory bindings with tree digest", () => {
    const repoRoot = tempRoot("tree-bind");
    const subDir = join(repoRoot, "dir");
    vfs.mkdirSync(subDir);
    vfs.writeFileSync(join(subDir, "file1.txt"), "hello");
    vfs.writeFileSync(join(subDir, "file2.txt"), "world");

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
    const repoRoot = tempRoot("tree-bind");
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
    const repoRoot = tempRoot("tree-bind");
    const filePath = join(repoRoot, "a.txt");
    vfs.writeFileSync(filePath, "a");
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
    const repoRoot = tempRoot("tree-bind");
    const subDir = join(repoRoot, "sub");
    vfs.mkdirSync(subDir);
    vfs.writeFileSync(join(repoRoot, "target.txt"), "target");
    createVirtualSymlink(join(repoRoot, "target.txt"), join(subDir, "link.txt"));

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
    const repoRoot = tempRoot("tree-bind");
    const subDir = join(repoRoot, "sub");
    vfs.mkdirSync(subDir);
    vfs.writeFileSync(join(subDir, "file.txt"), "content");

    const dirFd = openGatePath(subDir);
    try {
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
    const repoRoot = tempRoot("tree-bind");
    const subDir = join(repoRoot, "sub");
    vfs.mkdirSync(subDir);
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

  test("captures empty directory tree binding with 0 entries and deterministic sha256", () => {
    const repoRoot = tempRoot("tree-empty");
    const emptyDir = join(repoRoot, "empty");
    vfs.mkdirSync(emptyDir);

    const dirFd = openGatePath(emptyDir);
    try {
      const dirBinding = captureOpenedPath(dirFd, repoRoot, {
        argv_index: 0,
        argument: "./empty",
        operand: "./empty",
        scope: "repository",
        role: "target",
        canonical_path: emptyDir,
        executable: false,
      });
      expect(dirBinding.kind).toBe("directory");
      expect(dirBinding.entries).toBe(0);
      expect(dirBinding.tree_bytes).toBe(0);
      expect(dirBinding.tree_sha256).toBeDefined();
      expect(typeof dirBinding.tree_sha256).toBe("string");
    } finally {
      closeSync(dirFd);
    }
  });

  test("captures multi-tier nested directory tree recursively in RAM", () => {
    const repoRoot = tempRoot("tree-nested");
    const nestedDir = join(repoRoot, "a", "b");
    vfs.mkdirSync(nestedDir, { recursive: true });
    vfs.writeFileSync(join(nestedDir, "deep.txt"), "deep-content");

    const topDir = join(repoRoot, "a");
    const dirFd = openGatePath(topDir);
    try {
      const dirBinding = captureOpenedPath(dirFd, repoRoot, {
        argv_index: 0,
        argument: "./a",
        operand: "./a",
        scope: "repository",
        role: "target",
        canonical_path: topDir,
        executable: false,
      });
      expect(dirBinding.kind).toBe("directory");
      expect(dirBinding.entries).toBe(2);
      expect(dirBinding.tree_bytes).toBe("deep-content".length);
      expect(dirBinding.tree_sha256).toBeDefined();
    } finally {
      closeSync(dirFd);
    }
  });
});
