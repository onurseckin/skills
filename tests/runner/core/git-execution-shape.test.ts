import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { gitExecutionArgvIssues } from "../../../olt/scripts/src/engine/runner/core/git-execution-shape.ts";

function createCommandRecord(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    schema: "harness.command",
    version: 1,
    id: "cmd-1",
    task_id: "task-1",
    gate_id: "gate-1",
    role: "validator",
    agent_id: "agent-1",
    action: "gate",
    argv: ["git", "diff", "--check"],
    cwd: "/repo",
    environment_variables: {},
    path_bindings: [
      {
        argv_index: 0,
        argument: "git",
        operand: "/usr/bin/git",
        scope: "system",
        role: "executable",
        canonical_path: "/usr/bin/git",
        executable: true,
        kind: "file",
        device: "1",
        inode: "1",
        mode: 0o755,
        bytes: 100,
        sha256: "0".repeat(64),
      },
    ],
    execution_argv: [
      "/usr/bin/git",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.external=",
      "-c",
      "pager.diff=false",
      "--no-pager",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--check",
    ],
    attempts: [],
    ...overrides,
  };
}

describe("git-execution-shape", () => {
  test("returns issue when Git gate command is not an accepted restricted diff check", () => {
    const record = createCommandRecord({
      argv: ["git", "checkout", "main"],
      execution_argv: undefined,
    });
    expect(gitExecutionArgvIssues(record)).toEqual([
      "Git gate command is not an accepted restricted diff check",
    ]);
  });

  test("handles non-restricted gates with or without execution_argv", () => {
    const validNonGit = createCommandRecord({
      argv: ["echo", "hello"],
      gate_id: null,
      execution_argv: undefined,
      path_bindings: [],
    });
    expect(gitExecutionArgvIssues(validNonGit)).toEqual([]);

    const invalidNonGit = createCommandRecord({
      argv: ["echo", "hello"],
      gate_id: "gate-1",
      execution_argv: ["/bin/echo", "hello"],
      path_bindings: [],
    });
    expect(gitExecutionArgvIssues(invalidNonGit)).toEqual([
      "non-Git gate contains a restricted execution argv",
    ]);
  });

  test("validates restricted Git gate execution_argv against policy", () => {
    const validGitGate = createCommandRecord();
    expect(gitExecutionArgvIssues(validGitGate)).toEqual([]);

    const mismatchedGitGate = createCommandRecord({
      execution_argv: ["/usr/bin/git", "diff", "--check"],
    });
    expect(gitExecutionArgvIssues(mismatchedGitGate)).toEqual([
      "Git gate execution argv does not match its restricted policy",
    ]);

    const errorGitGate = createCommandRecord({
      argv: ["git", "diff", "--check"],
      path_bindings: [], // Missing executable binding at index 0 will throw in executionArgv
    });
    expect(gitExecutionArgvIssues(errorGitGate)).toEqual([
      "Git gate execution argv does not match its restricted policy",
    ]);
  });
});
