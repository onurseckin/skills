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

const dummyGit = (): GitExecutionOutput => ({ exitCode: 0, stdout: "", stderr: "" });
const dummySync = (): SyncExecutionOutput => ({ exitCode: 0, stdout: "", stderr: "" });

describe("Task 1.9: Defect Remediation - Subagent Premature Termination", () => {
  test("1. Defect metadata, invariants and canonical constants match contracts", () => {
    expect(DEFECT_REF).toBe("defect-subagent-premature-termination-without-commit-push");
    expect(DEFECT_ERROR_CODE).toBe("PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH");
    expect(ERROR_CODE).toBe("PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH");
    expect(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH).toBe(
      "PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH",
    );
    expect(INVARIANT_NUMBER).toBe(9);
    expect(INVARIANT_REF).toBe("Invariant 1.9");
    expect(INVARIANT_DESCRIPTION).toContain("pre-termination release gate");
    expect(CANONICAL_GLOBAL_SYNC_SCRIPT).toBe("scripts/sync-global.ts");
    expect(CANONICAL_DEFAULT_REMOTE).toBe("origin");
    expect(CANONICAL_DEFAULT_BRANCH).toBe("main");
    expect(CANONICAL_RELEASE_GATE_STEPS).toEqual([
      "verification_receipt",
      "conventional_commit",
      "git_push",
      "global_skill_sync",
    ]);
  });

  test("2. Verification Receipt generator produces deterministic checksum and id", () => {
    const r1 = generateVerificationReceipt({
      taskId: "task-1",
      testPassed: true,
      exitCode: 0,
      timestamp: "2026-08-29T12:00:00.000Z",
    });
    expect(r1.receiptId.startsWith("rcpt-")).toBe(true);
    expect(r1.testPassed).toBe(true);
    expect(r1.checksum).toHaveLength(64);
    const r2 = generateVerificationReceipt({ taskId: "task-2", testPassed: false, exitCode: 1 });
    expect(r2.testPassed).toBe(false);
    expect(r2.exitCode).toBe(1);
    const r3 = generateVerificationReceipt({ taskId: "task-3" });
    expect(r3.testPassed).toBe(true);
  });

  test("3. SubagentTerminationGuardError retains error details and prototype", () => {
    const err = new SubagentTerminationGuardError("Teardown blocked", {
      taskId: "t-99",
      subagentId: "agent-1",
      failedStep: "git_push",
      errors: ["Push rejected"],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SubagentTerminationGuardError);
    expect(err.code).toBe(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH);
    expect(err.taskId).toBe("t-99");
    expect(err.subagentId).toBe("agent-1");
    expect(err.failedStep).toBe("git_push");
    expect(err.errors).toEqual(["Push rejected"]);
  });

  test("4. Default runners handle basic and edge invocations", () => {
    expect(defaultGitRunner("", process.cwd()).exitCode).toBe(1);
    expect(defaultGitRunner("git --version", process.cwd()).exitCode).toBe(0);
    expect(defaultSyncRunner("/invalid/path.ts", process.cwd()).exitCode).toBe(1);
  });

  test("5. executePreTerminationReleaseGate succeeds when all 4 steps pass", async () => {
    const mockGit = (cmd: string): GitExecutionOutput =>
      cmd.startsWith("git rev-parse HEAD")
        ? { exitCode: 0, stdout: "abc1234", stderr: "" }
        : { exitCode: 0, stdout: "", stderr: "" };
    const res = await executePreTerminationReleaseGate({
      taskId: "t-100",
      subagentId: "sub-1",
      writeScope: ["src/index.ts"],
      testPassed: true,
      customGitRunner: mockGit,
      customSyncRunner: dummySync,
    });
    expect(res.allowed).toBe(true);
    expect(res.pushed).toBe(true);
    expect(res.synced).toBe(true);
    expect(res.commitSha).toBe("abc1234");
    expect(res.steps).toHaveLength(4);
  });

  test("6. executePreTerminationReleaseGate fails fast on receipt or test failure", async () => {
    const res1 = await executePreTerminationReleaseGate({
      taskId: "t-fail",
      testPassed: false,
      customGitRunner: dummyGit,
      customSyncRunner: dummySync,
    });
    expect(res1.allowed).toBe(false);
    expect(res1.failedStep).toBe("verification_receipt");
    const res2 = await executePreTerminationReleaseGate({
      taskId: "t-throw",
      customReceiptGenerator: () => {
        throw new Error("Crash");
      },
    });
    expect(res2.allowed).toBe(false);
    expect(res2.failedStep).toBe("verification_receipt");
  });

  test("7. executePreTerminationReleaseGate handles clean working tree and git errors", async () => {
    const cleanGit = (cmd: string): GitExecutionOutput =>
      cmd.startsWith("git commit")
        ? { exitCode: 1, stdout: "nothing to commit, working tree clean", stderr: "" }
        : { exitCode: 0, stdout: "head-sha", stderr: "" };
    const resClean = await executePreTerminationReleaseGate({
      taskId: "t-clean",
      testPassed: true,
      customGitRunner: cleanGit,
      customSyncRunner: dummySync,
    });
    expect(resClean.allowed).toBe(true);
    const failGit = (cmd: string): GitExecutionOutput =>
      cmd.startsWith("git add")
        ? { exitCode: 128, stdout: "", stderr: "fatal error" }
        : { exitCode: 0, stdout: "", stderr: "" };
    const resFail = await executePreTerminationReleaseGate({
      taskId: "t-add-fail",
      testPassed: true,
      writeScope: ["f.ts"],
      customGitRunner: failGit,
      customSyncRunner: dummySync,
    });
    expect(resFail.allowed).toBe(false);
    expect(resFail.failedStep).toBe("conventional_commit");
  });

  test("8. executePreTerminationReleaseGate handles push and sync failures", async () => {
    const failPush = (cmd: string): GitExecutionOutput =>
      cmd.startsWith("git push")
        ? { exitCode: 1, stdout: "", stderr: "push error" }
        : { exitCode: 0, stdout: "", stderr: "" };
    const resPush = await executePreTerminationReleaseGate({
      taskId: "t-push-fail",
      testPassed: true,
      customGitRunner: failPush,
      customSyncRunner: dummySync,
    });
    expect(resPush.allowed).toBe(false);
    expect(resPush.failedStep).toBe("git_push");
    const failSync = (): SyncExecutionOutput => ({ exitCode: 1, stdout: "", stderr: "sync error" });
    const resSync = await executePreTerminationReleaseGate({
      taskId: "t-sync-fail",
      testPassed: true,
      customGitRunner: dummyGit,
      customSyncRunner: failSync,
    });
    expect(resSync.allowed).toBe(false);
    expect(resSync.failedStep).toBe("global_skill_sync");
  });

  test("9. executePreTerminationReleaseGate supports skip flags", async () => {
    const res = await executePreTerminationReleaseGate({
      taskId: "t-skip",
      testPassed: true,
      allowUncommitted: true,
      skipPush: true,
      skipSync: true,
      customGitRunner: dummyGit,
      customSyncRunner: dummySync,
    });
    expect(res.allowed).toBe(true);
    for (const step of res.steps.slice(1)) expect(step.status).toBe("skipped");
  });

  test("10. assertSubagentTerminationAllowed guards termination and throws on violation", async () => {
    const okRes: ReleaseGateResult = {
      allowed: true,
      defectRef: DEFECT_REF,
      taskId: "t-ok",
      pushed: true,
      synced: true,
      steps: [],
      errors: [],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    expect((await assertSubagentTerminationAllowed(okRes)).allowed).toBe(true);
    const badRes: ReleaseGateResult = {
      allowed: false,
      defectRef: DEFECT_REF,
      taskId: "t-bad",
      pushed: false,
      synced: false,
      failedStep: "git_push",
      steps: [],
      errors: ["Push rejected"],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    await expect(assertSubagentTerminationAllowed(badRes)).rejects.toThrow(
      SubagentTerminationGuardError,
    );
    const badOpt: ReleaseGateOptions = {
      taskId: "t-bad-opt",
      testPassed: false,
      customGitRunner: dummyGit,
      customSyncRunner: dummySync,
    };
    await expect(assertSubagentTerminationAllowed(badOpt)).rejects.toThrow(
      SubagentTerminationGuardError,
    );
  });

  test("11. auditSubagentTerminationReleaseGates aggregates gate results correctly", () => {
    const okRes: ReleaseGateResult = {
      allowed: true,
      defectRef: DEFECT_REF,
      taskId: "t-1",
      pushed: true,
      synced: true,
      steps: [],
      errors: [],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    const badRes: ReleaseGateResult = {
      allowed: false,
      defectRef: DEFECT_REF,
      taskId: "t-2",
      pushed: false,
      synced: false,
      failedStep: "git_push",
      steps: [],
      errors: ["err"],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    const repPass = auditSubagentTerminationReleaseGates([okRes]);
    expect(repPass.resolved).toBe(true);
    expect(repPass.passedCount).toBe(1);
    const repFail = auditSubagentTerminationReleaseGates([okRes, badRes]);
    expect(repFail.resolved).toBe(false);
    expect(repFail.failedCount).toBe(1);
    expect(auditSubagentTerminationReleaseGates([]).resolved).toBe(false);
  });

  test("12. Defect Proof and Entry generators return valid contracts", () => {
    const proof = createSubagentTerminationDefectProof();
    expect(proof.commit_sha).toBeDefined();
    expect(proof.task_id).toBe(`task-remediate-${DEFECT_REF}`);
    expect(proof.verified).toBe(true);
    const entry = createSubagentTerminationDefectEntry({ taskId: "t-entry", errors: ["err"] });
    expect(entry.domain).toBe("tooling");
    expect(entry.error_code).toBe(PREMATURE_TERMINATION_WITHOUT_COMMIT_PUSH);
    expect(entry.resolution?.verified).toBe(true);
  });
});
