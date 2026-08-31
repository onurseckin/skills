import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  assertConventionalCommitCompliance,
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  validatePhaseCommitMessage,
  type ConventionalCommitMessage,
} from "../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Phase Commits: Conventional Commit Validation", () => {
  describe("CONVENTIONAL_COMMIT_TYPES", () => {
    test("contains standard conventional commit types", () => {
      const expectedTypes = [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "revert",
        "hotfix",
        "security",
        "deps",
        "migration",
      ];
      for (const type of expectedTypes) {
        expect(CONVENTIONAL_COMMIT_TYPES.has(type)).toBeTrue();
      }
    });
  });

  describe("formatConventionalCommit", () => {
    test("formats standard type and description without scope", () => {
      const formatted = formatConventionalCommit({
        type: "feat",
        description: "add user profile component",
      });
      expect(formatted).toBe("feat: add user profile component");
    });

    test("formats standard type with scope", () => {
      const formatted = formatConventionalCommit({
        type: "fix",
        scope: "auth",
        description: "prevent token expiration race condition",
      });
      expect(formatted).toBe("fix(auth): prevent token expiration race condition");
    });

    test("formats breaking change with exclamation mark and footer", () => {
      const formatted = formatConventionalCommit({
        type: "refactor",
        scope: "api",
        description: "restructure v1 payload responses",
        isBreaking: true,
        breakingChangeDescription: "v1 payload endpoints return wrapped response object",
      });
      expect(formatted).toBe(
        "refactor(api)!: restructure v1 payload responses\n\nBREAKING CHANGE: v1 payload endpoints return wrapped response object",
      );
    });

    test("formats commit with body and closed issues", () => {
      const formatted = formatConventionalCommit({
        type: "chore",
        scope: "deps",
        description: "upgrade typescript and bun types",
        body: "Updates devDependencies to match upstream runtime version.",
        issuesClosed: ["#101", "REQ-202"],
      });
      expect(formatted).toBe(
        "chore(deps): upgrade typescript and bun types\n\nUpdates devDependencies to match upstream runtime version.\n\nCloses: #101, REQ-202",
      );
    });

    test("throws HarnessError on invalid commit type", () => {
      expect(() =>
        formatConventionalCommit({
          type: "invalid_type",
          description: "do something",
        }),
      ).toThrow(HarnessError);
    });

    test("throws HarnessError on empty description", () => {
      expect(() =>
        formatConventionalCommit({
          type: "feat",
          description: "   ",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("validatePhaseCommitMessage", () => {
    test("validates and parses a standard single-line commit message", () => {
      const raw = "feat(worktree): implement phase commit validation";
      const result = validatePhaseCommitMessage(raw);
      expect(result.valid).toBeTrue();
      expect(result.errors).toEqual([]);
      expect(result.parsed).toBeDefined();
      expect(result.parsed?.type).toBe("feat");
      expect(result.parsed?.scope).toBe("worktree");
      expect(result.parsed?.isBreaking).toBeFalse();
      expect(result.parsed?.description).toBe("implement phase commit validation");
      expect(result.parsed?.raw).toBe(raw);
    });

    test("validates and parses a breaking change commit message with exclamation mark", () => {
      const raw = "feat(cli)!: change flag syntax for runner";
      const result = validatePhaseCommitMessage(raw);
      expect(result.valid).toBeTrue();
      expect(result.parsed?.isBreaking).toBeTrue();
    });

    test("validates and parses commit message with body, breaking footer, and issues closed", () => {
      const raw = [
        "refactor(store): migrate to atomic json commits",
        "",
        "This replaces individual write calls with transaction batches.",
        "",
        "BREAKING CHANGE: Store format v1 is no longer supported.",
        "",
        "Closes: #42, #43",
      ].join("\n");

      const result = validatePhaseCommitMessage(raw);
      expect(result.valid).toBeTrue();
      expect(result.parsed?.type).toBe("refactor");
      expect(result.parsed?.scope).toBe("store");
      expect(result.parsed?.isBreaking).toBeTrue();
      expect(result.parsed?.description).toBe("migrate to atomic json commits");
      expect(result.parsed?.body).toBe(
        "This replaces individual write calls with transaction batches.",
      );
      expect(result.parsed?.breakingChangeDescription).toBe(
        "Store format v1 is no longer supported.",
      );
      expect(result.parsed?.issuesClosed).toEqual(["#42", "#43"]);
    });

    test("returns errors on empty message", () => {
      const result = validatePhaseCommitMessage("");
      expect(result.valid).toBeFalse();
      expect(result.errors).toContain("Commit message cannot be empty");
    });

    test("returns errors on non-conventional format header", () => {
      const result = validatePhaseCommitMessage("Updated readme files");
      expect(result.valid).toBeFalse();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("does not conform to Conventional Commits format");
    });

    test("returns errors when header and body are not separated by an empty line", () => {
      const raw = "feat(core): add feature\nDirect body line without empty separator";
      const result = validatePhaseCommitMessage(raw);
      expect(result.valid).toBeFalse();
      expect(result.errors).toContain("Header must be separated from body by an empty line");
    });

    test("returns errors on unrecognised commit type in header", () => {
      const raw = "unknown(core): do something";
      const result = validatePhaseCommitMessage(raw);
      expect(result.valid).toBeFalse();
      expect(result.errors.some((e) => e.includes("not recognized"))).toBeTrue();
    });
  });

  describe("assertConventionalCommitCompliance", () => {
    test("does not throw on valid commit message string", () => {
      expect(() => {
        assertConventionalCommitCompliance("docs(readme): clarify phase commits");
      }).not.toThrow();
    });

    test("does not throw on valid ConventionalCommitMessage object", () => {
      const message: ConventionalCommitMessage = {
        type: "test",
        scope: "worktree",
        isBreaking: false,
        description: "add tests for phase commits",
        raw: "test(worktree): add tests for phase commits",
      };
      expect(() => {
        assertConventionalCommitCompliance(message);
      }).not.toThrow();
    });

    test("throws HarnessError on invalid commit message string", () => {
      expect(() => {
        assertConventionalCommitCompliance("WIP: saving progress");
      }).toThrow(HarnessError);
    });
  });
});
