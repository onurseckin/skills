import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  executeAutoSyncAndCommit,
  type AutoSyncOptions,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "../../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
} from "../../../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Conventional Commit Message Formatting & Exports", () => {
    test("exports CONVENTIONAL_COMMIT_TYPES set with standard types", () => {
      expect(CONVENTIONAL_COMMIT_TYPES.has("feat")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("fix")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("chore")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("docs")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("refactor")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("perf")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("test")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("build")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("ci")).toBeTrue();
      expect(CONVENTIONAL_COMMIT_TYPES.has("revert")).toBeTrue();
    });

    test("formats feat commit with scope", () => {
      const msg = formatConventionalCommitMessage({
        type: "feat",
        scope: "workflow",
        description: "implement per-task auto-sync routine",
      });
      expect(msg).toBe("feat(workflow): implement per-task auto-sync routine");
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.type).toBe("feat");
      expect(validation.parsed?.scope).toBe("workflow");
      expect(validation.parsed?.description).toBe("implement per-task auto-sync routine");
    });

    test("formats fix commit without scope", () => {
      const msg = formatConventionalCommitMessage({
        type: "fix",
        description: "resolve git staging race condition",
      });
      expect(msg).toBe("fix: resolve git staging race condition");
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.type).toBe("fix");
      expect(validation.parsed?.scope).toBeUndefined();
    });

    test("formats chore commit with body", () => {
      const msg = formatConventionalCommitMessage({
        type: "chore",
        scope: "deps",
        description: "update runtime dependencies",
        body: "Bumps typescript and vitest packages to latest patch versions.",
      });
      expect(msg).toBe(
        "chore(deps): update runtime dependencies\n\nBumps typescript and vitest packages to latest patch versions.",
      );
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.body).toBe(
        "Bumps typescript and vitest packages to latest patch versions.",
      );
    });

    test("formats docs commit with breaking changes footer and closed issues", () => {
      const msg = formatConventionalCommitMessage({
        type: "docs",
        scope: "api",
        description: "document breaking API contracts",
        isBreaking: true,
        breakingChangeDescription: "Payload structure requires new syncResult field.",
        issuesClosed: ["#42", "TASK-101"],
      });
      expect(msg).toBe(
        "docs(api)!: document breaking API contracts\n\nBREAKING CHANGE: Payload structure requires new syncResult field.\n\nCloses: #42, TASK-101",
      );
      const validation = validatePhaseCommitMessage(msg);
      expect(validation.valid).toBeTrue();
      expect(validation.parsed?.isBreaking).toBeTrue();
      expect(validation.parsed?.breakingChangeDescription).toBe(
        "Payload structure requires new syncResult field.",
      );
      expect(validation.parsed?.issuesClosed).toEqual(["#42", "TASK-101"]);
    });

    test("throws HarnessError on invalid commit type", () => {
      expect(() => {
        formatConventionalCommitMessage({
          type: "invalid_type",
          description: "something invalid",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on empty description", () => {
      expect(() => {
        formatConventionalCommitMessage({
          type: "feat",
          description: "   ",
        });
      }).toThrow(HarnessError);
    });
  });
