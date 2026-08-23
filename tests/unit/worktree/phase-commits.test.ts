import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  assertConventionalCommitCompliance,
  CONVENTIONAL_COMMIT_TYPES,
  createPhaseCommitPayload,
  evaluateUpstreamPushPolicy,
  formatConventionalCommit,
  validatePhaseCommitMessage,
  verifyPhasePreconditions,
  type ConventionalCommitMessage,
  type PhaseCommitConfig,
  type PhaseGateResult,
  type UpstreamPushPolicy,
} from "../../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Phase Commits & Conventional Commit Validation (p09)", () => {
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

  describe("verifyPhasePreconditions", () => {
    const validConfig: PhaseCommitConfig = {
      taskId: "task-p09",
      scope: "worktree",
      commitType: "feat",
      description: "implement phase commits",
      writeScope: ["src/worktree/**", "tests/unit/worktree/**"],
    };

    test("returns verified = true when all preconditions are satisfied", () => {
      const result = verifyPhasePreconditions(validConfig, {
        modifiedPaths: [
          "src/worktree/phase-commits.ts",
          "tests/unit/worktree/phase-commits.test.ts",
        ],
        now: new Date("2026-08-22T17:00:00.000Z"),
      });

      expect(result.verified).toBeTrue();
      expect(result.preconditionsMet).toBeTrue();
      expect(result.writeScopeClean).toBeTrue();
      expect(result.unscopedModifiedPaths).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.verifiedAt).toBe("2026-08-22T17:00:00.000Z");
    });

    test("fails verification when modified paths are out of assigned write scope", () => {
      const result = verifyPhasePreconditions(validConfig, {
        modifiedPaths: ["src/worktree/phase-commits.ts", "unrelated/outside/file.ts"],
      });

      expect(result.verified).toBeFalse();
      expect(result.writeScopeClean).toBeFalse();
      expect(result.unscopedModifiedPaths).toEqual(["unrelated/outside/file.ts"]);
      expect(result.issues.some((i) => i.includes("outside assigned write scope"))).toBeTrue();
    });

    test("fails verification when requirePassingGates is true but gate results are empty", () => {
      const configWithGates: PhaseCommitConfig = {
        ...validConfig,
        requirePassingGates: true,
      };

      const result = verifyPhasePreconditions(configWithGates, {
        gateResults: [],
      });

      expect(result.verified).toBeFalse();
      expect(result.issues.some((i) => i.includes("requirePassingGates is enabled"))).toBeTrue();
    });

    test("fails verification when any gate result has passed = false", () => {
      const configWithGates: PhaseCommitConfig = {
        ...validConfig,
        requirePassingGates: true,
      };

      const gateResults: PhaseGateResult[] = [
        { gateId: "gate-1", passed: true },
        { gateId: "gate-2", passed: false, error: "Assertion failed" },
      ];

      const result = verifyPhasePreconditions(configWithGates, {
        gateResults,
      });

      expect(result.verified).toBeFalse();
      expect(result.issues.some((i) => i.includes("Failing gates detected"))).toBeTrue();
    });

    test("fails verification on empty taskId or empty writeScope", () => {
      const badConfig: PhaseCommitConfig = {
        taskId: "",
        commitType: "feat",
        description: "something",
        writeScope: [],
      };

      const result = verifyPhasePreconditions(badConfig);
      expect(result.verified).toBeFalse();
      expect(result.issues.some((i) => i.includes("Task ID cannot be empty"))).toBeTrue();
      expect(result.issues.some((i) => i.includes("empty writeScope"))).toBeTrue();
    });
  });

  describe("createPhaseCommitPayload", () => {
    const config: PhaseCommitConfig = {
      taskId: "task-p09",
      scope: "worktree",
      commitType: "feat",
      description: "add phase commit payload creation",
      writeScope: ["src/worktree/**", "tests/unit/worktree/**"],
    };

    test("generates complete payload with stage args and push policy", () => {
      const now = new Date("2026-08-22T17:30:00.000Z");
      const payload = createPhaseCommitPayload(config, {
        modifiedPaths: ["src/worktree/phase-commits.ts"],
        now,
      });

      expect(payload.taskId).toBe("task-p09");
      expect(payload.formattedMessage).toBe("feat(worktree): add phase commit payload creation");
      expect(payload.commitMessage.type).toBe("feat");
      expect(payload.commitMessage.scope).toBe("worktree");
      expect(payload.stageArgs).toEqual(["add", "--", "src/worktree", "tests/unit/worktree"]);
      expect(payload.verification.verified).toBeTrue();
      expect(payload.pushPolicy.mode).toBe("on-verified");
      expect(payload.timestamp).toBe("2026-08-22T17:30:00.000Z");
    });

    test("respects custom upstream push policy", () => {
      const customPolicy: UpstreamPushPolicy = {
        mode: "atomic-phase",
        remote: "upstream",
        branch: "feature-branch",
        forceWithLease: true,
      };

      const customConfig: PhaseCommitConfig = {
        ...config,
        upstreamPushPolicy: customPolicy,
      };

      const payload = createPhaseCommitPayload(customConfig);
      expect(payload.pushPolicy.mode).toBe("atomic-phase");
      expect(payload.pushPolicy.remote).toBe("upstream");
      expect(payload.pushPolicy.branch).toBe("feature-branch");
      expect(payload.pushPolicy.forceWithLease).toBeTrue();
    });

    test("strict mode throws HarnessError when preconditions fail", () => {
      const failingConfig: PhaseCommitConfig = {
        ...config,
        requirePassingGates: true,
      };

      expect(() => {
        createPhaseCommitPayload(failingConfig, {
          gateResults: [{ gateId: "gate-1", passed: false, error: "Test timeout" }],
          strict: true,
        });
      }).toThrow(HarnessError);
    });
  });

  describe("evaluateUpstreamPushPolicy", () => {
    const verifiedResult = {
      verified: true,
      preconditionsMet: true,
      gateResults: [],
      writeScopeClean: true,
      unscopedModifiedPaths: [],
      issues: [],
      verifiedAt: "2026-08-22T17:00:00.000Z",
    };

    const unverifiedResult = {
      verified: false,
      preconditionsMet: false,
      gateResults: [{ gateId: "g1", passed: false }],
      writeScopeClean: false,
      unscopedModifiedPaths: ["out/of/scope.ts"],
      issues: ["Gate failed", "Scope violated"],
      verifiedAt: "2026-08-22T17:00:00.000Z",
    };

    test("mode 'never' always prevents push", () => {
      const outcome = evaluateUpstreamPushPolicy(
        { mode: "never", remote: "origin" },
        verifiedResult,
      );
      expect(outcome.shouldPush).toBeFalse();
      expect(outcome.reason).toContain("'never'");
    });

    test("mode 'always' allows push regardless of verification", () => {
      const outcome = evaluateUpstreamPushPolicy(
        { mode: "always", remote: "origin" },
        unverifiedResult,
      );
      expect(outcome.shouldPush).toBeTrue();
      expect(outcome.reason).toContain("'always'");
    });

    test("mode 'on-verified' pushes when verified and skips when unverified", () => {
      const passing = evaluateUpstreamPushPolicy(
        { mode: "on-verified", remote: "origin" },
        verifiedResult,
      );
      expect(passing.shouldPush).toBeTrue();
      expect(passing.reason).toContain("passed");

      const failing = evaluateUpstreamPushPolicy(
        { mode: "on-verified", remote: "origin" },
        unverifiedResult,
      );
      expect(failing.shouldPush).toBeFalse();
      expect(failing.reason).toContain("failed");
    });

    test("mode 'atomic-phase' verifies scope cleanliness before pushing", () => {
      const passing = evaluateUpstreamPushPolicy(
        { mode: "atomic-phase", remote: "origin" },
        verifiedResult,
      );
      expect(passing.shouldPush).toBeTrue();

      const scopeViolation = {
        ...verifiedResult,
        writeScopeClean: false,
      };
      const failing = evaluateUpstreamPushPolicy(
        { mode: "atomic-phase", remote: "origin" },
        scopeViolation,
      );
      expect(failing.shouldPush).toBeFalse();
    });
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies phase-commits module and test file contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/worktree/phase-commits.ts"),
      join(process.cwd(), "tests/unit/worktree/phase-commits.test.ts"),
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
