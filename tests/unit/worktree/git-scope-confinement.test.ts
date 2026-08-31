import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNonDestructiveWriteScope,
  buildInclusiveStageArgs,
  filterPathsToScope,
  isPathInWriteScope,
  partitionObservedChanges,
} from "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts";
import {
  createGitRunner,
  git,
  worktreeGitEnvironment,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("P55 Write Scope Confinement and Unfamiliar User Edits Preservation", () => {
  test("isPathInWriteScope correctly evaluates exact files, directory trees, and wildcards", () => {
    const writeScope = ["src/authority", "tests/unit/worktree/**/*.ts", "docs/*.md", "config.json"];

    expect(isPathInWriteScope("src/authority/thread-identifier.ts", writeScope)).toBe(true);
    expect(isPathInWriteScope("src/authority/sub/deep/module.ts", writeScope)).toBe(true);
    expect(isPathInWriteScope("tests/unit/worktree/git-preservation.test.ts", writeScope)).toBe(
      true,
    );
    expect(isPathInWriteScope("tests/unit/worktree/nested/deep.test.ts", writeScope)).toBe(true);
    expect(isPathInWriteScope("docs/guide.md", writeScope)).toBe(true);
    expect(isPathInWriteScope("config.json", writeScope)).toBe(true);

    expect(isPathInWriteScope("src/unrelated/feature.ts", writeScope)).toBe(false);
    expect(isPathInWriteScope("tests/unit/other/test.ts", writeScope)).toBe(false);
    expect(isPathInWriteScope("docs/nested/deep.md", writeScope)).toBe(false);
    expect(isPathInWriteScope("other-config.json", writeScope)).toBe(false);
    expect(isPathInWriteScope(".env.local", writeScope)).toBe(false);
  });

  test("filterPathsToScope filters arbitrary file lists strictly to assigned write scope", () => {
    const scope = ["src/workflow/worktree", "tests/unit/worktree"];
    const observedFiles = [
      "src/workflow/worktree/git.ts",
      "src/workflow/worktree/git-ops.ts",
      "src/other-feature/wip.ts",
      "tests/unit/worktree/git-preservation.test.ts",
      "user-notes.txt",
    ];

    const scopedOnly = filterPathsToScope(observedFiles, scope);
    expect(scopedOnly).toEqual([
      "src/workflow/worktree/git.ts",
      "src/workflow/worktree/git-ops.ts",
      "tests/unit/worktree/git-preservation.test.ts",
    ]);
  });

  test("assertNonDestructiveWriteScope prevents agent from touching out-of-scope files", () => {
    const scope = ["src/authority"];
    const agentId = "implementer_task-p54";

    expect(() =>
      assertNonDestructiveWriteScope(
        ["src/authority/thread-identifier.ts", "src/authority/manifest-parser.ts"],
        scope,
        agentId,
      ),
    ).not.toThrow();

    expect(() =>
      assertNonDestructiveWriteScope(
        ["src/authority/thread-identifier.ts", "user-wip/feature.ts"],
        scope,
        agentId,
      ),
    ).toThrow(HarnessError);

    try {
      assertNonDestructiveWriteScope(
        ["src/authority/thread-identifier.ts", "user-wip/feature.ts", "package.json"],
        scope,
        agentId,
      );
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toContain("user-wip/feature.ts");
      expect(harnessErr.message).toContain("package.json");
      expect(harnessErr.message).toContain(agentId);
    }
  });

  test("partitionObservedChanges separates agent-scoped edits from user WIP edits", () => {
    const scope = ["src/workflow/worktree", "tests/unit/worktree"];
    const changes = [
      "src/workflow/worktree/git.ts",
      "tests/unit/worktree/git-preservation.test.ts",
      "src/user-feature/button.tsx",
      "docs/user-draft.md",
      ".env.secret",
    ];

    const partitioned = partitionObservedChanges(changes, scope);
    expect(partitioned.scopedPaths).toEqual([
      "src/workflow/worktree/git.ts",
      "tests/unit/worktree/git-preservation.test.ts",
    ]);
    expect(partitioned.unfamiliarUserPaths).toEqual([
      "src/user-feature/button.tsx",
      "docs/user-draft.md",
      ".env.secret",
    ]);
  });

  test("buildInclusiveStageArgs constructs explicit non-destructive git add arguments", () => {
    const simpleScope = ["src/workflow/worktree", "tests/unit/worktree"];
    expect(buildInclusiveStageArgs(simpleScope)).toEqual([
      "add",
      "--",
      "src/workflow/worktree",
      "tests/unit/worktree",
    ]);

    const globScope = ["src/**/*.ts", "docs/*.md"];
    expect(buildInclusiveStageArgs(globScope)).toEqual([
      "add",
      "--",
      ":(glob)src/**/*.ts",
      ":(glob)docs/*.md",
    ]);

    expect(() => buildInclusiveStageArgs([])).toThrow(HarnessError);
  });
});

describe("Git Helper Utilities & Environment Sanitization", () => {
  test("worktreeGitEnvironment sets non-interactive flags and preserves safe variables", () => {
    const mockEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/Users/dev",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
      UNSAFE_SECRET_VAR: "secret123",
    };

    const sanitized = worktreeGitEnvironment(mockEnv);
    expect(sanitized.GIT_TERMINAL_PROMPT).toBe("0");
    expect(sanitized.GIT_PAGER).toBe("cat");
    expect(sanitized.PAGER).toBe("cat");
    expect(sanitized.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(sanitized.HOME).toBe("/Users/dev");
    expect(sanitized.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
    expect(sanitized.UNSAFE_SECRET_VAR).toBeUndefined();
  });

  test("git wrapper function throws HarnessError with stderr on non-zero exit", () => {
    const failingSpawn: GitSpawn = () => ({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository\n",
    });
    const failingRunner = createGitRunner(failingSpawn);

    expect(() => git("/invalid", ["status"], failingRunner)).toThrow(HarnessError);
    try {
      git("/invalid", ["status"], failingRunner);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INTEGRITY");
      expect(harnessErr.message).toContain("fatal: not a git repository");
    }
  });
});

describe("Invariants & TypeScript Strictness Audit", () => {
  test("zero TypeScript any and zero suppressions across zero-destructive-policy files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts"),
      join(__dirname, "../../../olt/scripts/src/workflow/worktree/git.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const lintSuppressionA = "es" + "lint-disable";
    const lintSuppressionB = "ox" + "lint-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(lintSuppressionA)).toBe(false);
      expect(content.includes(lintSuppressionB)).toBe(false);
    }
  });
});
