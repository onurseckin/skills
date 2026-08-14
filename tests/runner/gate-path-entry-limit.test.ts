import { afterEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOpenedPath } from "../../orchestrating-long-tasks/scripts/src/runner/gate-path-tree.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function repository(): { root: string; suite: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-path-entry-limit-")));
  roots.push(root);
  const suite = join(root, "suite");
  mkdirSync(suite);
  return { root, suite: realpathSync(suite) };
}

function files(directory: string, count: number): void {
  for (let index = 0; index < count; index += 1)
    writeFileSync(join(directory, index.toString().padStart(5, "0")), "");
}

function capture(root: string, suite: string) {
  const descriptor = openSync(
    suite,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return captureOpenedPath(descriptor, root, {
      argv_index: 2,
      argument: "suite",
      operand: "suite",
      scope: "repository",
      role: "target",
      canonical_path: suite,
      relative_path: "suite",
      executable: false,
    });
  } finally {
    closeSync(descriptor);
  }
}

describe("gate path tree global entry cap", () => {
  test("accepts exactly 10,000 enumerated nodes", () => {
    const { root, suite } = repository();
    files(suite, 10_000);
    expect(capture(root, suite).entries).toBe(10_000);
  });

  test("rejects a nested 10,001st node reserved behind buffered siblings", () => {
    const { root, suite } = repository();
    const first = join(suite, "a");
    mkdirSync(first);
    mkdirSync(join(suite, "z"));
    files(first, 9_999);
    expect(() => capture(root, suite)).toThrow("gate-bound directory exceeds entry limit");
  });
});
