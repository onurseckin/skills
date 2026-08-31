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

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies auto-sync and phase-commits modules and tests contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/workflow/completion/auto-sync-and-commit.ts"),
      join(process.cwd(), "olt/scripts/src/engine/worktree/phase-commits.ts"),
      join(process.cwd(), "tests/workflow/guards/sync/sync-core.test.ts"),
      join(process.cwd(), "tests/workflow/guards/sync/sync-commit.test.ts"),
      join(process.cwd(), "tests/workflow/guards/sync/sync-flags.test.ts"),
      join(process.cwd(), "tests/workflow/guards/sync/sync-recovery.test.ts"),
      join(process.cwd(), "tests/workflow/guards/sync/sync-static.test.ts"),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBeTrue();
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
