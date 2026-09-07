import { describe, expect, test } from "bun:test";
import {
  createRepositoryGitCommand,
  repositoryGitEnvironment,
} from "../../../../../olt/scripts/src/packets/repository-git-command.ts";

const restrictedEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
};

const restrictedPrefix = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "pager.diff=false",
  "--no-pager",
];

describe("restricted Git policy - environment and spawn", () => {
  test("builds an exact packet Git environment without ambient helper injection", () => {
    expect(
      repositoryGitEnvironment({
        PATH: "/usr/bin:/bin",
        LANG: "C",
        GIT_DIR: "/poison",
        GIT_EXTERNAL_DIFF: "/poison/diff",
        GIT_PAGER: "/poison/pager",
        GIT_CONFIG_COUNT: "1",
        GIT_NO_REPLACE_OBJECTS: "0",
        GIT_REPLACE_REF_BASE: "refs/poison/",
      }),
    ).toEqual({ ...restrictedEnvironment, LANG: "C", PATH: "/usr/bin:/bin" });
  });

  test("uses exact restricted argv and environment at the packet Git spawn seam", () => {
    const calls: unknown[] = [];
    const command = createRepositoryGitCommand(
      { PATH: "/usr/bin:/bin", LANG: "C" },
      (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return { status: 0, stdout: Buffer.from("ok\n"), stderr: Buffer.alloc(0) };
      },
      { preflight: () => true },
    );
    expect(command("/repo", ["status", "--porcelain=v2"], 64)).toEqual({
      status: 0,
      bytes: Buffer.from("ok\n"),
    });
    expect(calls).toEqual([
      {
        executable: "git",
        argv: [...restrictedPrefix, "-C", "/repo", "status", "--porcelain=v2"],
        options: {
          encoding: "buffer",
          env: { ...restrictedEnvironment, LANG: "C", PATH: "/usr/bin:/bin" },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 65,
          timeout: 15_000,
          killSignal: "SIGKILL",
        },
      },
    ]);
  });

  test("strictly scrubs ambient Git worktree, index, and namespace injection variables", () => {
    const scrubbed = repositoryGitEnvironment({
      PATH: "/usr/bin:/bin",
      LANG: "C",
      GIT_WORK_TREE: "/poison/worktree",
      GIT_INDEX_FILE: "/poison/index",
      GIT_OBJECT_DIRECTORY: "/poison/objects",
      GIT_NAMESPACE: "poison-ns",
      GIT_CONFIG_PARAMETERS: "'evil.setting=1'",
    });
    expect(scrubbed).toEqual({ ...restrictedEnvironment, LANG: "C", PATH: "/usr/bin:/bin" });
    expect(scrubbed.GIT_WORK_TREE).toBeUndefined();
    expect(scrubbed.GIT_INDEX_FILE).toBeUndefined();
    expect(scrubbed.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(scrubbed.GIT_NAMESPACE).toBeUndefined();
    expect(scrubbed.GIT_CONFIG_PARAMETERS).toBeUndefined();
  });

  test("rejects relative or empty PATH in repositoryGitEnvironment", () => {
    expect(() => repositoryGitEnvironment({ PATH: "relative/bin" })).toThrow(
      "repository Git PATH must contain absolute directories",
    );
    expect(() => repositoryGitEnvironment({})).toThrow(
      "repository Git PATH must contain absolute directories",
    );
  });
});
