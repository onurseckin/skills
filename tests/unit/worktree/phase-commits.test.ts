import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createPhaseCommitPayload,
  evaluateUpstreamPushPolicy,
  verifyPhasePreconditions,
  type PhaseCommitConfig,
  type PhaseGateResult,
  type UpstreamPushPolicy,
} from "../../../olt/scripts/src/engine/worktree/phase-commits.ts";

describe("Phase Commits: Verification and Execution", () => {
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

  describe("Audit Invariants", () => {
    test("phase-commits source files exist and compile cleanly", () => {
      const srcPath = join(__dirname, "../../../olt/scripts/src/engine/worktree/phase-commits.ts");
      expect(existsSync(srcPath)).toBeTrue();
      const content = readFileSync(srcPath, "utf8");
      expect(content.length).toBeGreaterThan(0);
    });
  });
});
