import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertDomainIsolation,
  assertNonDestructiveWriteScope,
  buildInclusiveStageArgs,
  commitAndPushDomainSubphase,
  createDomainLedger,
  filterPathsToScope,
  isDomainSyncEligible,
  isPathInWriteScope,
  partitionObservedChanges,
  provisionDomainWorktree,
  validateDomainIsolation,
  type DomainCommitPushInput,
  type DomainScopeEntry,
  type DomainWorktreeConfig,
  type GitRunner,
} from "../../../../olt/scripts/src/engine/worktree/index.ts";
import { tmpdir } from "node:os";

describe("Worktree Isolation - Disjoint Write Scopes", () => {
  it("validates mutually disjoint domain write scopes as isolated", () => {
    const domains: readonly DomainScopeEntry[] = [
      { domain: "auth", writeScope: ["src/auth/**", "tests/auth/**"] },
      { domain: "billing", writeScope: ["src/billing/**", "tests/billing/**"] },
      { domain: "reporting", writeScope: ["src/reporting/**", "tests/reporting/**"] },
    ];
    const result = validateDomainIsolation(domains);
    expect(result.isolated).toBe(true);
    expect(result.conflicts.length).toBe(0);
    expect(() => assertDomainIsolation(domains)).not.toThrow();
  });

  it("detects scope collisions across overlapping domains and throws role confinement violation", () => {
    const conflictingDomains: readonly DomainScopeEntry[] = [
      { domain: "core-engine", writeScope: ["src/core/**"] },
      { domain: "sub-engine", writeScope: ["src/core/utils.ts"] },
    ];
    const result = validateDomainIsolation(conflictingDomains);
    expect(result.isolated).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0]?.domainA).toBe("core-engine");
    expect(result.conflicts[0]?.domainB).toBe("sub-engine");

    expect(() => assertDomainIsolation(conflictingDomains)).toThrow(HarnessError);
    try {
      assertDomainIsolation(conflictingDomains);
    } catch (error) {
      expect((error as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
    }
  });

  it("handles multi-way collisions across multiple domain pairs", () => {
    const multiCollision: readonly DomainScopeEntry[] = [
      { domain: "dom-a", writeScope: ["common/types.ts"] },
      { domain: "dom-b", writeScope: ["common/**"] },
      { domain: "dom-c", writeScope: ["common/types.ts"] },
    ];
    const result = validateDomainIsolation(multiCollision);
    expect(result.isolated).toBe(false);
    expect(result.conflicts.length).toBe(3);
  });
});

describe("Worktree Isolation - Write Scope Path Confinement", () => {
  const allowedScope = ["src/workflow/worktree/**", "tests/workflow/worktree*.ts"];

  it("matches exact, directory prefix, and glob patterns accurately", () => {
    expect(isPathInWriteScope("src/workflow/worktree/manager.ts", allowedScope)).toBe(true);
    expect(isPathInWriteScope("src/workflow/worktree/sub/deep.ts", allowedScope)).toBe(true);
    expect(isPathInWriteScope("tests/workflow/worktree-isolation.test.ts", allowedScope)).toBe(
      true,
    );
    expect(isPathInWriteScope("src/cli/main.ts", allowedScope)).toBe(false);
    expect(isPathInWriteScope("package.json", allowedScope)).toBe(false);
  });

  it("filters paths strictly to assigned scope", () => {
    const paths = [
      "src/workflow/worktree/git.ts",
      "src/workflow/agents/ledger.ts",
      "tests/workflow/worktree.test.ts",
      "docs/readme.md",
    ];
    const filtered = filterPathsToScope(paths, allowedScope);
    expect(filtered).toEqual(["src/workflow/worktree/git.ts", "tests/workflow/worktree.test.ts"]);
  });

  it("asserts non-destructive write scope confinement and rejects out-of-scope edits", () => {
    const validPaths = ["src/workflow/worktree/assign.ts"];
    expect(() => assertNonDestructiveWriteScope(validPaths, allowedScope, "impl-18")).not.toThrow();

    const invalidPaths = ["src/workflow/worktree/assign.ts", "config/global.json"];
    expect(() => assertNonDestructiveWriteScope(invalidPaths, allowedScope, "impl-18")).toThrow(
      HarnessError,
    );
    try {
      assertNonDestructiveWriteScope(invalidPaths, allowedScope, "impl-18");
    } catch (err) {
      expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
    }
  });

  it("partitions observed changes into scoped paths and unfamiliar user modifications", () => {
    const observed = [
      "src/workflow/worktree/landing.ts",
      "untracked-manual-note.txt",
      "tests/workflow/worktree.test.ts",
    ];
    const partition = partitionObservedChanges(observed, allowedScope);
    expect(partition.scopedPaths).toEqual([
      "src/workflow/worktree/landing.ts",
      "tests/workflow/worktree.test.ts",
    ]);
    expect(partition.unfamiliarUserPaths).toEqual(["untracked-manual-note.txt"]);
  });

  it("builds inclusive staging arguments from pathspecs", () => {
    const args = buildInclusiveStageArgs(["src/core/**", "src/auth/*.ts"]);
    expect(args).toEqual(["add", "--", "src/core", ":(glob)src/auth/*.ts"]);
    expect(() => buildInclusiveStageArgs([])).toThrow(HarnessError);
  });
});

describe("Worktree Isolation - Domain Worktree Lifecycle & Commits", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), "worktree-isolation-test");
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("provisions domain worktree in dedicated isolation path", () => {
    const ledger = createDomainLedger(
      "harness-main",
      "abc1234",
      join(testRoot, "worktrees"),
      "main",
    );
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const config = provisionDomainWorktree(
      testRoot,
      ledger,
      "Billing Engine",
      "run-100",
      mockRunner,
    );
    expect(config.domain).toBe("billing-engine");
    expect(config.worktreeId).toBe("domain-billing-engine");
    expect(config.branch).toBe("harness--billing-engine-run-100");
    expect(config.status).toBe("active");
    expect(ledger.domains["billing-engine"]).toBe(config);
    expect(isDomainSyncEligible(config)).toBe(true);

    const staleConfig: DomainWorktreeConfig = { ...config, status: "archived" };
    expect(isDomainSyncEligible(staleConfig)).toBe(false);
  });

  it("enforces conventional commit compliance and write scope confinement during subphase commit", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "diff" && argv.includes("--cached") && argv.includes("--quiet")) {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (argv[0] === "show") {
        return {
          status: 0,
          stdout: "1 file changed, 10 insertions(+), 5 deletions(-)\n",
          stderr: "",
        };
      }
      if (argv[0] === "rev-parse") {
        return { status: 0, stdout: "fedcba9876543210\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const input: DomainCommitPushInput = {
      taskId: "task-wt-1",
      domain: "auth",
      worktreeId: "domain-auth",
      worktreePath: join(testRoot, "wt-auth"),
      writeScope: ["src/auth/**"],
      modifiedPaths: ["src/auth/tokens.ts"],
      label: "Implement JWT validation",
      commitType: "feat",
      runner: mockRunner,
      pushOnCommit: true,
    };

    const outcome = commitAndPushDomainSubphase(input);
    expect(outcome.committed).toBe(true);
    expect(outcome.pushed).toBe(true);
    expect(outcome.commit?.subject).toBe("feat(auth): Implement JWT validation");
    expect(outcome.commit?.domain).toBe("auth");
    expect(outcome.commit?.changedLines).toBe(15);

    const invalidInput: DomainCommitPushInput = {
      ...input,
      commitType: "invalid-type",
    };
    expect(() => commitAndPushDomainSubphase(invalidInput)).toThrow(HarnessError);

    const outOfScopeInput: DomainCommitPushInput = {
      ...input,
      modifiedPaths: ["src/secrets/keys.pem"],
    };
    expect(() => commitAndPushDomainSubphase(outOfScopeInput)).toThrow(HarnessError);
  });
});
