import { describe, expect, test } from "bun:test";
import { createRepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";

// B38 finding 1: a plain fork+exec `git` spawn can transiently return no status, no error and no
// stderr under process-table pressure — the same shape `process-tree.ts`'s `processSnapshot` already
// retries for `ps`. These prove `createRepositoryGitCommand` now absorbs that shape without either
// masking a genuine git failure or retrying forever.

const environment = { PATH: "/usr/bin:/bin" };
const alwaysPreflight = { preflight: () => true };

function transientResult() {
  return { status: null, stdout: null, stderr: null };
}

describe("createRepositoryGitCommand transient spawn retry", () => {
  test("retries a transient no-status/no-error/no-stderr spawn and returns the eventual success", () => {
    const calls: number[] = [];
    let attempt = 0;
    const command = createRepositoryGitCommand(
      environment,
      (_executable, _argv, _options) => {
        calls.push(attempt);
        attempt += 1;
        if (attempt <= 2) return transientResult();
        return { status: 0, stdout: Buffer.from("ok\n"), stderr: Buffer.alloc(0) };
      },
      alwaysPreflight,
    );

    const result = command("/repo", ["status"], 1024);

    expect(calls).toEqual([0, 1, 2]);
    expect(result.status).toBe(0);
    expect(result.bytes.toString("utf8")).toBe("ok\n");
  });

  test("gives up after the bounded retry count and reports the same honest message as a single failure", () => {
    let calls = 0;
    const command = createRepositoryGitCommand(
      environment,
      () => {
        calls += 1;
        return transientResult();
      },
      alwaysPreflight,
    );

    expect(() => command("/repo", ["status"], 1024)).toThrow(/unaccepted exit status unknown/);
    // One initial attempt plus the bounded retries — never unbounded, never zero.
    expect(calls).toBe(4);
  });

  test("does not retry a real non-zero exit status", () => {
    let calls = 0;
    const command = createRepositoryGitCommand(
      environment,
      () => {
        calls += 1;
        return { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from("fatal: not a repo") };
      },
      alwaysPreflight,
    );

    expect(() => command("/repo", ["status"], 1024)).toThrow(/fatal: not a repo/);
    expect(calls).toBe(1);
  });

  test("does not retry a real spawn error (e.g. ENOENT)", () => {
    let calls = 0;
    const enoent = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    const command = createRepositoryGitCommand(
      environment,
      () => {
        calls += 1;
        return { status: null, stdout: null, stderr: null, error: enoent };
      },
      alwaysPreflight,
    );

    expect(() => command("/repo", ["status"], 1024)).toThrow(/ENOENT/);
    expect(calls).toBe(1);
  });

  test("does not retry a real timeout (ETIMEDOUT)", () => {
    let calls = 0;
    const timedOut = Object.assign(new Error("spawn git ETIMEDOUT"), { code: "ETIMEDOUT" });
    const command = createRepositoryGitCommand(
      environment,
      () => {
        calls += 1;
        return { status: null, stdout: null, stderr: null, error: timedOut };
      },
      alwaysPreflight,
    );

    expect(() => command("/repo", ["status"], 1024)).toThrow(/repository Git command timed out/);
    expect(calls).toBe(1);
  });

  test("does not retry a transient spawn that carried stderr text", () => {
    // Any of the three signals being present means the OS got far enough to report something, so
    // it is not the "spawn itself never happened" shape this retry exists for.
    let calls = 0;
    const command = createRepositoryGitCommand(
      environment,
      () => {
        calls += 1;
        return { status: null, stdout: null, stderr: Buffer.from("some partial diagnostic") };
      },
      alwaysPreflight,
    );

    expect(() => command("/repo", ["status"], 1024)).toThrow(/some partial diagnostic/);
    expect(calls).toBe(1);
  });
});
