import { describe, expect, test } from "bun:test";
import {
  assertSubagentTerminationAllowed,
  auditSubagentTerminationReleaseGates,
  CANONICAL_DEFAULT_BRANCH,
  CANONICAL_DEFAULT_REMOTE,
  CANONICAL_GLOBAL_SYNC_SCRIPT,
  CANONICAL_RELEASE_GATE_STEPS,
  createSubagentTerminationDefectEntry,
  createSubagentTerminationDefectProof,
  defaultGitRunner,
  defaultSyncRunner,
  DEFECT_ERROR_CODE,
  DEFECT_REF,
  ERROR_CODE,
  executePreTerminationReleaseGate,
  generateVerificationReceipt,
  type GitExecutionOutput,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH,
  type ReleaseGateOptions,
  type ReleaseGateResult,
  SubagentTerminationGuardError,
  type SyncExecutionOutput,
} from "../../../olt/scripts/src/tooling/defect-subagent-premature-termination-without-commit-push.ts";

const dummyGitSuccess = (): GitExecutionOutput => ({ exitCode: 0, stdout: "", stderr: "" });
const dummySyncSuccess = (): SyncExecutionOutput => ({ exitCode: 0, stdout: "", stderr: "" });

describe("Task 1.9: Defect Remediation - Subagent Premature Termination Without Commit and Push", () => {
  describe("1. Defect Metadata, Invariants & Canonical Constants", () => {
    test("defect identifiers and error codes match architectural specifications", () => {
      expect(DEFECT_REF).toBe("defect-subagent-premature-termination-without-commit-push");
      expect(DEFECT_ERROR_CODE).toBe("PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH");
      expect(ERROR_CODE).toBe("PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH");
      expect(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH).toBe(
        "PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH",
      );
      expect(INVARIANT_NUMBER).toBe(9);
      expect(INVARIANT_REF).toBe("Invariant 1.9");
      expect(INVARIANT_DESCRIPTION).toContain("pre-termination release gate");
    });

    test("canonical paths and release gate steps are correctly configured", () => {
      expect(CANONICAL_GLOBAL_SYNC_SCRIPT).toBe("scripts/sync-global.ts");
      expect(CANONICAL_DEFAULT_REMOTE).toBe("origin");
      expect(CANONICAL_DEFAULT_BRANCH).toBe("main");
      expect(Object.isFrozen(CANONICAL_RELEASE_GATE_STEPS)).toBe(true);
      expect(CANONICAL_RELEASE_GATE_STEPS).toEqual([
        "verification_receipt",
        "conventional_commit",
        "git_push",
        "global_skill_sync",
      ]);
    });
  });

  describe("2. Verification Receipt Generator", () => {
    test("generates passing verification receipt with deterministic checksum and id", () => {
      const receipt = generateVerificationReceipt({
        taskId: "task-101",
        subagentId: "subagent-alpha",
        testFile: "tests/unit/example.test.ts",
        testCommand: "bun test tests/unit/example.test.ts",
        testPassed: true,
        exitCode: 0,
        timestamp: "2026-08-29T12:00:00.000Z",
      });

      expect(receipt.receiptId.startsWith("rcpt-")).toBe(true);
      expect(receipt.taskId).toBe("task-101");
      expect(receipt.subagentId).toBe("subagent-alpha");
      expect(receipt.testPassed).toBe(true);
      expect(receipt.exitCode).toBe(0);
      expect(receipt.checksum).toHaveLength(64);
      expect(receipt.timestamp).toBe("2026-08-29T12:00:00.000Z");
      expect(receipt.summary).toContain("100% success");
    });

    test("generates failing verification receipt when exitCode is non-zero or testPassed is false", () => {
      const receipt = generateVerificationReceipt({
        taskId: "task-102",
        testPassed: false,
        exitCode: 1,
        summary: "1 test failed",
        details: { failureReason: "assertion failed" },
      });

      expect(receipt.testPassed).toBe(false);
      expect(receipt.exitCode).toBe(1);
      expect(receipt.summary).toBe("1 test failed");
      expect(receipt.details?.failureReason).toBe("assertion failed");
    });

    test("infers testPassed and exitCode when omitted", () => {
      const receipt1 = generateVerificationReceipt({ taskId: "task-default" });
      expect(receipt1.testPassed).toBe(true);
      expect(receipt1.exitCode).toBe(0);

      const receipt2 = generateVerificationReceipt({ taskId: "task-fail-inferred", exitCode: 2 });
      expect(receipt2.testPassed).toBe(false);
      expect(receipt2.exitCode).toBe(2);
    });
  });

  describe("3. SubagentTerminationGuardError Class", () => {
    test("instantiates with default error code and defect reference", () => {
      const err = new SubagentTerminationGuardError("Teardown blocked");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SubagentTerminationGuardError);
      expect(err.name).toBe("SubagentTerminationGuardError");
      expect(err.code).toBe(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.taskId).toBe("unknown-task");
      expect(err.errors).toEqual([]);
      expect(err.subagentId).toBeUndefined();
      expect(err.failedStep).toBeUndefined();
    });

    test("retains detailed context and options", () => {
      const err = new SubagentTerminationGuardError("Gate failed", {
        code: "CUSTOM_ERROR_CODE",
        defectRef: "custom-defect",
        taskId: "task-999",
        subagentId: "agent-omega",
        failedStep: "git_push",
        errors: ["Push rejected: non-fast-forward"],
      });

      expect(err.code).toBe("CUSTOM_ERROR_CODE");
      expect(err.defectRef).toBe("custom-defect");
      expect(err.taskId).toBe("task-999");
      expect(err.subagentId).toBe("agent-omega");
      expect(err.failedStep).toBe("git_push");
      expect(err.errors).toEqual(["Push rejected: non-fast-forward"]);
    });
  });

  describe("4. Default Runners", () => {
    test("defaultGitRunner handles empty command gracefully", () => {
      const res = defaultGitRunner("", process.cwd());
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Empty command");
    });

    test("defaultGitRunner runs real git command without throwing", () => {
      const res = defaultGitRunner("git --version", process.cwd());
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("git version");
    });

    test("defaultSyncRunner handles invalid script gracefully", () => {
      const res = defaultSyncRunner("/non/existent/script-file-xyz.ts", process.cwd());
      expect(res.exitCode).toBe(1);
    });
  });

  describe("5. executePreTerminationReleaseGate", () => {
    test("passes full 4-step pipeline on valid test, clean commit, push, and sync", async () => {
      const mockGitRunner = (cmd: string): GitExecutionOutput => {
        if (cmd.startsWith("git add")) {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (cmd.startsWith("git commit")) {
          return { exitCode: 0, stdout: "[main abc1234] feat: complete task", stderr: "" };
        }
        if (cmd.startsWith("git rev-parse HEAD")) {
          return { exitCode: 0, stdout: "abc1234567890abcdef1234567890abcdef1234", stderr: "" };
        }
        if (cmd.startsWith("git push")) {
          return { exitCode: 0, stdout: "To origin/main\n   abc1234..def5678 main -> main", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const mockSyncRunner = (scriptPath: string): SyncExecutionOutput => {
        return { exitCode: 0, stdout: `Synced successfully via ${scriptPath}`, stderr: "" };
      };

      const result = await executePreTerminationReleaseGate({
        taskId: "task-complete-1",
        subagentId: "sub-1",
        writeScope: ["src/index.ts", "tests/index.test.ts"],
        commitType: "feat",
        commitScope: "core",
        commitDescription: "add new feature",
        testFile: "tests/index.test.ts",
        testPassed: true,
        customGitRunner: mockGitRunner,
        customSyncRunner: mockSyncRunner,
      });

      expect(result.allowed).toBe(true);
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.taskId).toBe("task-complete-1");
      expect(result.subagentId).toBe("sub-1");
      expect(result.receipt?.testPassed).toBe(true);
      expect(result.commitSha).toBe("abc1234567890abcdef1234567890abcdef1234");
      expect(result.pushed).toBe(true);
      expect(result.synced).toBe(true);
      expect(result.failedStep).toBeUndefined();
      expect(result.errors).toEqual([]);
      expect(result.steps.length).toBe(4);

      for (const step of result.steps) {
        expect(step.status).toBe("passed");
        expect(step.exitCode).toBe(0);
      }
    });

    test("fails release gate when verification receipt fails (tests failed)", async () => {
      const result = await executePreTerminationReleaseGate({
        taskId: "task-failing-tests",
        testPassed: false,
        testSummary: "2 tests failed with TypeError",
        customGitRunner: dummyGitSuccess,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("verification_receipt");
      expect(result.errors.some((e) => e.includes("Verification receipt failed"))).toBe(true);

      const receiptStep = result.steps.find((s) => s.step === "verification_receipt");
      expect(receiptStep?.status).toBe("failed");

      const commitStep = result.steps.find((s) => s.step === "conventional_commit");
      expect(commitStep?.status).toBe("skipped");
    });

    test("fails release gate when custom receipt generator throws", async () => {
      const result = await executePreTerminationReleaseGate({
        taskId: "task-generator-throws",
        customGitRunner: dummyGitSuccess,
        customSyncRunner: dummySyncSuccess,
        customReceiptGenerator: () => {
          throw new Error("Disk full while generating receipt");
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("verification_receipt");
      expect(result.errors.some((e) => e.includes("Disk full"))).toBe(true);
    });

    test("handles clean working tree (nothing to commit) without failing", async () => {
      const mockGitRunner = (cmd: string): GitExecutionOutput => {
        if (cmd.startsWith("git add")) return { exitCode: 0, stdout: "", stderr: "" };
        if (cmd.startsWith("git commit")) {
          return { exitCode: 1, stdout: "nothing to commit, working tree clean", stderr: "" };
        }
        if (cmd.startsWith("git rev-parse HEAD")) {
          return { exitCode: 0, stdout: "clean-tree-sha", stderr: "" };
        }
        if (cmd.startsWith("git push")) return { exitCode: 0, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await executePreTerminationReleaseGate({
        taskId: "task-clean-tree",
        testPassed: true,
        customGitRunner: mockGitRunner,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(true);
      const commitStep = result.steps.find((s) => s.step === "conventional_commit");
      expect(commitStep?.status).toBe("passed");
      expect(commitStep?.message).toContain("Working tree clean");
    });

    test("fails release gate when git stage fails", async () => {
      const mockGitRunner = (cmd: string): GitExecutionOutput => {
        if (cmd.startsWith("git add")) {
          return { exitCode: 128, stdout: "", stderr: "fatal: pathspec does not match any files" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await executePreTerminationReleaseGate({
        taskId: "task-stage-fails",
        testPassed: true,
        writeScope: ["nonexistent.ts"],
        customGitRunner: mockGitRunner,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("conventional_commit");
      expect(result.errors.some((e) => e.includes("Git stage failed"))).toBe(true);
    });

    test("fails release gate when git commit fails with real error", async () => {
      const mockGitRunner = (cmd: string): GitExecutionOutput => {
        if (cmd.startsWith("git add")) return { exitCode: 0, stdout: "", stderr: "" };
        if (cmd.startsWith("git commit")) {
          return { exitCode: 1, stdout: "", stderr: "error: unable to write loose object" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await executePreTerminationReleaseGate({
        taskId: "task-commit-fails",
        testPassed: true,
        customGitRunner: mockGitRunner,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("conventional_commit");
      expect(result.errors.some((e) => e.includes("Git commit failed"))).toBe(true);
    });

    test("fails release gate when git push fails", async () => {
      const mockGitRunner = (cmd: string): GitExecutionOutput => {
        if (cmd.startsWith("git push")) {
          return { exitCode: 1, stdout: "", stderr: "fatal: remote origin unreachable" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await executePreTerminationReleaseGate({
        taskId: "task-push-fails",
        testPassed: true,
        customGitRunner: mockGitRunner,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("git_push");
      expect(result.pushed).toBe(false);
      expect(result.errors.some((e) => e.includes("Git push failed"))).toBe(true);
    });

    test("fails release gate when global skill sync fails", async () => {
      const mockGitRunner = (): GitExecutionOutput => ({ exitCode: 0, stdout: "", stderr: "" });
      const mockSyncRunner = (): SyncExecutionOutput => ({
        exitCode: 1,
        stdout: "",
        stderr: "Sync error: manifest mismatch",
      });

      const result = await executePreTerminationReleaseGate({
        taskId: "task-sync-fails",
        testPassed: true,
        customGitRunner: mockGitRunner,
        customSyncRunner: mockSyncRunner,
      });

      expect(result.allowed).toBe(false);
      expect(result.failedStep).toBe("global_skill_sync");
      expect(result.synced).toBe(false);
      expect(result.errors.some((e) => e.includes("Global skill sync failed"))).toBe(true);
    });

    test("supports skipping commit (allowUncommitted), push (skipPush), and sync (skipSync)", async () => {
      const result = await executePreTerminationReleaseGate({
        taskId: "task-read-only",
        testPassed: true,
        allowUncommitted: true,
        skipPush: true,
        skipSync: true,
        customGitRunner: dummyGitSuccess,
        customSyncRunner: dummySyncSuccess,
      });

      expect(result.allowed).toBe(true);
      const commitStep = result.steps.find((s) => s.step === "conventional_commit");
      const pushStep = result.steps.find((s) => s.step === "git_push");
      const syncStep = result.steps.find((s) => s.step === "global_skill_sync");

      expect(commitStep?.status).toBe("skipped");
      expect(pushStep?.status).toBe("skipped");
      expect(syncStep?.status).toBe("skipped");
    });
  });

  describe("6. assertSubagentTerminationAllowed Guard", () => {
    test("resolves cleanly when given a passing ReleaseGateResult", async () => {
      const passedResult: ReleaseGateResult = {
        allowed: true,
        defectRef: DEFECT_REF,
        taskId: "task-clean-pass",
        pushed: true,
        synced: true,
        steps: [],
        errors: [],
        durationMs: 10,
        timestamp: new Date().toISOString(),
      };

      const res = await assertSubagentTerminationAllowed(passedResult);
      expect(res.allowed).toBe(true);
    });

    test("throws SubagentTerminationGuardError when given a failing ReleaseGateResult", async () => {
      const failedResult: ReleaseGateResult = {
        allowed: false,
        defectRef: DEFECT_REF,
        taskId: "task-bad",
        subagentId: "subagent-gamma",
        pushed: false,
        synced: false,
        failedStep: "git_push",
        steps: [],
        errors: ["Push rejected: hook failure"],
        durationMs: 15,
        timestamp: new Date().toISOString(),
      };

      await expect(assertSubagentTerminationAllowed(failedResult)).rejects.toThrow(
        SubagentTerminationGuardError,
      );

      try {
        await assertSubagentTerminationAllowed(failedResult);
      } catch (err) {
        expect(err).toBeInstanceOf(SubagentTerminationGuardError);
        const guardErr = err as SubagentTerminationGuardError;
        expect(guardErr.taskId).toBe("task-bad");
        expect(guardErr.subagentId).toBe("subagent-gamma");
        expect(guardErr.failedStep).toBe("git_push");
        expect(guardErr.errors).toEqual(["Push rejected: hook failure"]);
      }
    });

    test("executes ReleaseGateOptions and throws if gate fails", async () => {
      const options: ReleaseGateOptions = {
        taskId: "task-failing-options",
        testPassed: false,
        customGitRunner: dummyGitSuccess,
        customSyncRunner: dummySyncSuccess,
      };

      await expect(assertSubagentTerminationAllowed(options)).rejects.toThrow(
        SubagentTerminationGuardError,
      );
    });

    test("executes ReleaseGateOptions and passes if gate succeeds", async () => {
      const options: ReleaseGateOptions = {
        taskId: "task-passing-options",
        testPassed: true,
        allowUncommitted: true,
        skipPush: true,
        skipSync: true,
        customGitRunner: dummyGitSuccess,
        customSyncRunner: dummySyncSuccess,
      };

      const res = await assertSubagentTerminationAllowed(options);
      expect(res.allowed).toBe(true);
    });
  });

  describe("7. auditSubagentTerminationReleaseGates", () => {
    test("reports resolved = true when all gates passed", () => {
      const results: ReleaseGateResult[] = [
        {
          allowed: true,
          defectRef: DEFECT_REF,
          taskId: "t-1",
          pushed: true,
          synced: true,
          steps: [],
          errors: [],
          durationMs: 5,
          timestamp: new Date().toISOString(),
        },
        {
          allowed: true,
          defectRef: DEFECT_REF,
          taskId: "t-2",
          pushed: true,
          synced: true,
          steps: [],
          errors: [],
          durationMs: 5,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = auditSubagentTerminationReleaseGates(results);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.errorCode).toBe(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH);
      expect(report.resolved).toBe(true);
      expect(report.totalAudited).toBe(2);
      expect(report.passedCount).toBe(2);
      expect(report.failedCount).toBe(0);
      expect(report.violations).toHaveLength(0);
    });

    test("reports resolved = false and lists violations when failures exist", () => {
      const results: ReleaseGateResult[] = [
        {
          allowed: true,
          defectRef: DEFECT_REF,
          taskId: "t-1",
          pushed: true,
          synced: true,
          steps: [],
          errors: [],
          durationMs: 5,
          timestamp: new Date().toISOString(),
        },
        {
          allowed: false,
          defectRef: DEFECT_REF,
          taskId: "t-2",
          subagentId: "worker-beta",
          failedStep: "git_push",
          pushed: false,
          synced: false,
          steps: [],
          errors: ["Connection timeout"],
          durationMs: 5,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = auditSubagentTerminationReleaseGates(results);
      expect(report.resolved).toBe(false);
      expect(report.totalAudited).toBe(2);
      expect(report.passedCount).toBe(1);
      expect(report.failedCount).toBe(1);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]).toContain("t-2");
      expect(report.violations[0]).toContain("worker-beta");
      expect(report.violations[0]).toContain("git_push");
    });

    test("reports resolved = false on empty list", () => {
      const report = auditSubagentTerminationReleaseGates([]);
      expect(report.resolved).toBe(false);
      expect(report.totalAudited).toBe(0);
    });
  });

  describe("8. Defect Proof & Entry Contracts", () => {
    test("createSubagentTerminationDefectProof generates compliant DefectResolutionProof", () => {
      const proof = createSubagentTerminationDefectProof();
      expect(proof.commit_sha).toBeDefined();
      expect(proof.task_id).toBe(`task-remediate-${DEFECT_REF}`);
      expect(proof.test_assertion).toContain("executePreTerminationReleaseGate");
      expect(proof.empirical_command).toBe(
        "bun test tests/unit/tooling/defect-subagent-premature-termination-without-commit-push.test.ts",
      );
      expect(proof.verified).toBe(true);
    });

    test("createSubagentTerminationDefectEntry generates compliant DefectEntry", () => {
      const entry = createSubagentTerminationDefectEntry({
        id: "custom-entry-id",
        taskId: "task-defect-audit",
        subagentId: "agent-123",
        errors: ["Failed to push to origin/main"],
      });

      expect(entry.id).toBe("custom-entry-id");
      expect(entry.domain).toBe("tooling");
      expect(entry.error_code).toBe(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH);
      expect(entry.status).toBe("resolved");
      expect(entry.type).toBe("LIFECYCLE_ORDERING");
      expect(entry.category).toBe("boundary_violation");
      expect(entry.severity).toBe("high");
      expect(entry.resolution?.verified).toBe(true);
    });
  });
});
