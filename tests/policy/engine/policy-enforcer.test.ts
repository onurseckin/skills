import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  enforceRepoPolicy,
  generateDefaultRepoPolicy,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

const mockPolicy: RepoPolicy = {
  ...generateDefaultRepoPolicy("/mock/repo"),
  forbidden_commands: ["rm -rf /", "git push --force"],
  planning: {
    mandatory_brainstorming_rounds: 2,
    socratic_expansion_depth: 3,
    enforce_edge_case_matrix: true,
    min_tasks_per_complex_prompt: 4,
    max_files_per_task: 5,
    reject_shallow_umbrella_compression: true,
  },
};

describe("Central Policy Enforcement Engine", () => {
  describe("Worktree Policy Rules", () => {
    test("allows compliant worktree provision and write scope", () => {
      const result = enforceRepoPolicy(mockPolicy, {
        type: "worktree",
        trackId: "track-lane-1",
        worktreePath: "/mock/repo/.olt/worktrees/track-lane-1",
        branch: "track/track-lane-1",
        writeScope: ["src/engine/**"],
        modifiedPaths: ["src/engine/runner.ts"],
      });

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test("rejects invalid track ID format", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "worktree",
          trackId: "invalid/track/id",
          worktreePath: "/mock/repo/.olt/worktrees/invalid",
        }),
      ).toThrow(HarnessError);
    });

    test("rejects worktree path outside designated roots", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "worktree",
          trackId: "track-1",
          worktreePath: "/etc/worktree",
        }),
      ).toThrow(HarnessError);
    });

    test("rejects non-standard worktree branch prefix", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "worktree",
          trackId: "track-1",
          worktreePath: "/mock/repo/.olt/worktrees/track-1",
          branch: "feature/my-branch",
        }),
      ).toThrow(HarnessError);
    });

    test("rejects modifications outside write scope", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "worktree",
          trackId: "track-1",
          worktreePath: "/mock/repo/.olt/worktrees/track-1",
          writeScope: ["src/engine/**"],
          modifiedPaths: ["src/core/types.ts"],
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Commit Conventions Rules", () => {
    test("allows valid conventional commit messages", () => {
      const result1 = enforceRepoPolicy(mockPolicy, {
        type: "commit",
        message: "feat(engine): add policy enforcer",
        changedLines: 150,
        maxCommitLines: 400,
      });
      expect(result1.allowed).toBe(true);

      const result2 = enforceRepoPolicy(mockPolicy, {
        type: "commit",
        message: "fix: correct worktree teardown sequence\n\nResolved hanging lock issue.",
      });
      expect(result2.allowed).toBe(true);
    });

    test("rejects empty or non-conventional commit messages", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "commit",
          message: "",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "commit",
          message: "update stuff without prefix",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "commit",
          message: "unknown(engine): invalid type tag",
        }),
      ).toThrow(HarnessError);
    });

    test("emits warning when commit line count exceeds target limit", () => {
      const result = enforceRepoPolicy(mockPolicy, {
        type: "commit",
        message: "feat(engine): large change",
        changedLines: 550,
        maxCommitLines: 400,
      });

      expect(result.allowed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("exceeding target limit");
    });
  });

  describe("File Density Constraints Rules", () => {
    test("allows compliant source files within density bounds", () => {
      const result = enforceRepoPolicy(mockPolicy, {
        type: "file_density",
        filePath: "olt/scripts/src/policy/enforcer.ts",
        lineCount: 180,
        siblingFileCount: 6,
        maxLinesPerFile: 300,
        maxFilesPerDirectory: 10,
      });

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test("rejects files exceeding physical line limits", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "file_density",
          filePath: "src/engine/huge-file.ts",
          lineCount: 350,
          maxLinesPerFile: 300,
        }),
      ).toThrow(HarnessError);
    });

    test("rejects directories exceeding maximum file count", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "file_density",
          filePath: "src/engine/worktree/extra.ts",
          siblingFileCount: 14,
          maxFilesPerDirectory: 10,
        }),
      ).toThrow(HarnessError);
    });

    test("rejects forbidden defect and feedback filename prefixes in production sources", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "file_density",
          filePath: "olt/scripts/src/engine/defect-worktree-fix.ts",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "file_density",
          filePath: "olt/scripts/src/policy/fb-central-policy.ts",
        }),
      ).toThrow(HarnessError);
    });

    test("permits defect/feedback filenames in documentation and test paths", () => {
      const resultDoc = enforceRepoPolicy(mockPolicy, {
        type: "file_density",
        filePath: "docs/planning/defect-report.md",
      });
      expect(resultDoc.allowed).toBe(true);

      const resultTest = enforceRepoPolicy(mockPolicy, {
        type: "file_density",
        filePath: "tests/policy/defect-store.test.ts",
      });
      expect(resultTest.allowed).toBe(true);
    });
  });

  describe("Command & Planning Execution Rules", () => {
    test("rejects forbidden commands specified in policy", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "command",
          command: "git push --force origin main",
        }),
      ).toThrow(HarnessError);
    });

    test("rejects untargeted test sweeps executed by implementers", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "command",
          command: "bun test",
          role: "implementer",
        }),
      ).toThrow(HarnessError);

      const allowedResult = enforceRepoPolicy(mockPolicy, {
        type: "command",
        command: "bun test tests/policy/policy-enforcer.test.ts",
        role: "implementer",
      });
      expect(allowedResult.allowed).toBe(true);
    });

    test("enforces planning file and task bounds", () => {
      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "planning",
          fileCount: 8,
        }),
      ).toThrow(HarnessError);

      expect(() =>
        enforceRepoPolicy(mockPolicy, {
          type: "planning",
          promptComplexity: "complex",
          taskCount: 2,
        }),
      ).toThrow(HarnessError);
    });

    test("returns violation results without throwing when assert is false", () => {
      const result = enforceRepoPolicy(
        mockPolicy,
        {
          type: "command",
          command: "bun test",
          role: "implementer",
        },
        { assert: false },
      );

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });
  });
});
