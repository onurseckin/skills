import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  isDestructiveGitCommand,
  assertZeroDestructiveGit,
  isPathInWriteScope,
  assertNonDestructiveWriteScope,
  buildInclusiveStageArgs,
} from "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  validatePhaseCommitMessage,
} from "../../../olt/scripts/src/engine/worktree/phase-commits.ts";
import {
  createDomainLedger,
  validateDomainIsolation,
  assertDomainIsolation,
  isDomainSyncEligible,
  type DomainWorktreeConfig,
} from "../../../olt/scripts/src/engine/worktree/domain-sync.ts";

describe("Zero-Destructive Git Invariant", () => {
  test("isDestructiveGitCommand detects destructive git commands", () => {
    // git clean
    expect(isDestructiveGitCommand(["clean", "-fd"]).destructive).toBe(true);

    // git reset destructive flags
    expect(isDestructiveGitCommand(["reset", "--hard", "HEAD~1"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["reset", "--merge"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["reset", "--keep"]).destructive).toBe(true);

    // git checkout discarding working tree
    expect(isDestructiveGitCommand(["checkout", "--", "file.ts"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "-f"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "--force"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "."]).destructive).toBe(true);

    // git restore
    expect(isDestructiveGitCommand(["restore", "file.ts"]).destructive).toBe(true);

    // git stash destructive
    expect(isDestructiveGitCommand(["stash", "drop"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["stash", "clear"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["stash", "--hard"]).destructive).toBe(true);
  });

  test("isDestructiveGitCommand allows non-destructive safe commands", () => {
    expect(isDestructiveGitCommand([]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["status"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["add", "file.ts"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["commit", "-m", "feat: test"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["log", "-n", "5"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["diff", "--stat"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["checkout", "-b", "feat/new-branch"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["reset", "--soft", "HEAD~1"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["stash"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["stash", "pop"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["stash", "list"]).destructive).toBe(false);
  });

  test("assertZeroDestructiveGit throws INTEGRITY HarnessError on destructive command", () => {
    expect(() => assertZeroDestructiveGit(["reset", "--hard"])).toThrow(HarnessError);
    try {
      assertZeroDestructiveGit(["clean", "-f"]);
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INTEGRITY");
    }

    // Safe command should not throw
    expect(() => assertZeroDestructiveGit(["status"])).not.toThrow();
  });

  test("isPathInWriteScope validates file containment against exact paths, directories, and globs", () => {
    const scopes = ["src/engine", "tests/unit/**/*.test.ts", "package.json"];

    expect(isPathInWriteScope("src/engine/runner.ts", scopes)).toBe(true);
    expect(isPathInWriteScope("src/engine/nested/deep/file.ts", scopes)).toBe(true);
    expect(isPathInWriteScope("tests/unit/engine/worktree.test.ts", scopes)).toBe(true);
    expect(isPathInWriteScope("package.json", scopes)).toBe(true);

    // Negative cases
    expect(isPathInWriteScope("src/other/module.ts", scopes)).toBe(false);
    expect(isPathInWriteScope("tests/integration/api.test.ts", scopes)).toBe(false);
    expect(isPathInWriteScope("README.md", scopes)).toBe(false);
  });

  test("assertNonDestructiveWriteScope ensures modified paths are strictly within scope", () => {
    const writeScope = ["src/feature-a", "tests/feature-a"];

    expect(() =>
      assertNonDestructiveWriteScope(
        ["src/feature-a/a.ts", "tests/feature-a/a.test.ts"],
        writeScope,
        "task-1",
      ),
    ).not.toThrow();

    expect(() =>
      assertNonDestructiveWriteScope(
        ["src/feature-a/a.ts", "src/unscoped/leak.ts"],
        writeScope,
        "task-1",
      ),
    ).toThrow(HarnessError);
  });

  test("buildInclusiveStageArgs builds arguments for git staging", () => {
    const args = buildInclusiveStageArgs(["src/feature", "package.json"], "/repo");
    expect(args).toContain("src/feature");
    expect(args).toContain("package.json");
  });
});

describe("Phase Commits", () => {
  test("CONVENTIONAL_COMMIT_TYPES includes standard types", () => {
    expect(CONVENTIONAL_COMMIT_TYPES.has("feat")).toBe(true);
    expect(CONVENTIONAL_COMMIT_TYPES.has("fix")).toBe(true);
    expect(CONVENTIONAL_COMMIT_TYPES.has("chore")).toBe(true);
    expect(CONVENTIONAL_COMMIT_TYPES.has("docs")).toBe(true);
    expect(CONVENTIONAL_COMMIT_TYPES.has("refactor")).toBe(true);
    expect(CONVENTIONAL_COMMIT_TYPES.has("test")).toBe(true);
  });

  test("formatConventionalCommit formats standard header, body, breaking change, and trailers", () => {
    const formatted = formatConventionalCommit({
      type: "feat",
      scope: "engine",
      description: "implement zero-destructive worktree sync",
      body: "Provides atomic subphase commits and domain isolation.",
      isBreaking: true,
      breakingChangeDescription: "Changes workflow signature",
      issuesClosed: ["#42", "#43"],
    });

    expect(formatted).toContain("feat(engine)!: implement zero-destructive worktree sync");
    expect(formatted).toContain("Provides atomic subphase commits and domain isolation.");
    expect(formatted).toContain("BREAKING CHANGE: Changes workflow signature");
    expect(formatted).toContain("Closes: #42, #43");
  });

  test("formatConventionalCommit throws HarnessError on invalid type or empty description", () => {
    expect(() =>
      formatConventionalCommit({
        type: "invalid_type",
        description: "valid description",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      formatConventionalCommit({
        type: "feat",
        description: "   ",
      }),
    ).toThrow(HarnessError);
  });

  test("validatePhaseCommitMessage verifies conventional commit format", () => {
    const valid = validatePhaseCommitMessage(
      "feat(runner): support Darwin token owners\n\nDetailed explanation of Darwin sysctl token scanning.",
    );
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);

    const invalidHeader = validatePhaseCommitMessage("random unformatted commit message");
    expect(invalidHeader.valid).toBe(false);
    expect(invalidHeader.errors.length).toBeGreaterThan(0);

    const missingNewline = validatePhaseCommitMessage(
      "feat: support something\nNo newline between header and body",
    );
    expect(missingNewline.valid).toBe(false);
    expect(missingNewline.errors).toContain("Header must be separated from body by an empty line");
  });
});

describe("Domain Sync and Worktree Ledger", () => {
  test("createDomainLedger initializes state with valid parameters and rejects empty inputs", () => {
    const ledger = createDomainLedger("harness-main", "a1b2c3d4e5", ".capsules/worktrees");
    expect(ledger.harnessBranch).toBe("harness-main");
    expect(ledger.baseSha).toBe("a1b2c3d4e5");
    expect(ledger.root).toBe(".capsules/worktrees");
    expect(ledger.domains).toEqual({});
    expect(ledger.commits).toEqual([]);

    expect(() => createDomainLedger("", "sha", "root")).toThrow(HarnessError);
    expect(() => createDomainLedger("branch", "", "root")).toThrow(HarnessError);
    expect(() => createDomainLedger("branch", "sha", "")).toThrow(HarnessError);
  });

  test("validateDomainIsolation and assertDomainIsolation detect overlapping scopes across domains", () => {
    const isolatedDomains = [
      { domain: "frontend", writeScope: ["src/ui", "tests/ui"] },
      { domain: "backend", writeScope: ["src/api", "tests/api"] },
    ];
    const isolatedResult = validateDomainIsolation(isolatedDomains);
    expect(isolatedResult.isolated).toBe(true);
    expect(isolatedResult.conflicts).toHaveLength(0);
    expect(() => assertDomainIsolation(isolatedDomains)).not.toThrow();

    const conflictingDomains = [
      { domain: "domainA", writeScope: ["src/common/utils.ts"] },
      { domain: "domainB", writeScope: ["src/common/**"] },
    ];
    const conflictResult = validateDomainIsolation(conflictingDomains);
    expect(conflictResult.isolated).toBe(false);
    expect(conflictResult.conflicts.length).toBeGreaterThan(0);
    expect(() => assertDomainIsolation(conflictingDomains)).toThrow(HarnessError);
  });

  test("isDomainSyncEligible checks worktree readiness based on active/synced status", () => {
    const activeConfig: DomainWorktreeConfig = {
      domain: "auth",
      worktreeId: "domain-auth",
      worktreePath: "/tmp/auth",
      branch: "harness--auth-run-1",
      baseSha: "123",
      headSha: "456",
      createdAt: "2026-08-24T12:00:00Z",
      status: "active",
      assignedTaskIds: ["task-1"],
    };
    expect(isDomainSyncEligible(activeConfig)).toBe(true);

    const syncedConfig: DomainWorktreeConfig = { ...activeConfig, status: "synced" };
    expect(isDomainSyncEligible(syncedConfig)).toBe(true);

    const reclaimedConfig: DomainWorktreeConfig = { ...activeConfig, status: "reclaimed" };
    expect(isDomainSyncEligible(reclaimedConfig)).toBe(false);

    const conflictConfig: DomainWorktreeConfig = { ...activeConfig, status: "conflict" };
    expect(isDomainSyncEligible(conflictConfig)).toBe(false);

    const syncingConfig: DomainWorktreeConfig = { ...activeConfig, status: "syncing" };
    expect(isDomainSyncEligible(syncingConfig)).toBe(false);
  });
});
