import { describe, expect, test } from "bun:test";
import { createRepositoryGitCommand } from "../../../../../olt/scripts/src/packets/repository-git-command.ts";

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
