import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateCapsuleOverwriteGuard,
  inspectAndGuardPlanInit,
  type CapsuleCheckContext,
  type CapsuleCheckResult,
  type ExistingCapsuleRecord,
} from "../../olt/scripts/src/tooling/plan-init-on-an-existing-run-id-silently-destroys-the-recorded-run-defect-plan-init-destroys-existing-run.ts";

describe("Defect Remediation: defect-plan-init-destroys-existing-run", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-plan-init-destroys-existing-run");
    expect(ERROR_CODE).toBe("PLAN_INIT_DESTROYS_EXISTING_RUN_CAPSULE");
    expect(DEFECT_TITLE.includes("silently destroys")).toBe(true);
  });

  test("allows plan:init on brand new non-existing capsule", () => {
    const ctx: CapsuleCheckContext = {
      capsulePath: ".olt/capsules/brand-new-run",
      runId: "brand-new-run",
    };
    const result: CapsuleCheckResult = inspectAndGuardPlanInit(ctx, undefined);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.exists).toBe(false);
  });

  test("blocks plan:init on completed run to prevent erasure", () => {
    const existing: ExistingCapsuleRecord = {
      runId: "completed-run-123",
      capsulePath: ".olt/capsules/completed-run-123",
      hasEvents: true,
      hasReports: true,
      isCompleted: true,
    };
    const guard = evaluateCapsuleOverwriteGuard(existing, false);
    expect(guard.allowed).toBe(false);
    expect(guard.reason?.includes("Cannot re-initialize completed capsule")).toBe(true);
  });

  test("blocks plan:init on active run with durable events", () => {
    const existing: ExistingCapsuleRecord = {
      runId: "active-run-456",
      capsulePath: ".olt/capsules/active-run-456",
      hasEvents: true,
      hasReports: false,
      isCompleted: false,
    };
    const ctx: CapsuleCheckContext = {
      capsulePath: existing.capsulePath,
      runId: existing.runId,
    };
    const result = inspectAndGuardPlanInit(ctx, existing);
    expect(result.allowed).toBe(false);
    expect(result.reason?.includes("contains durable records")).toBe(true);
  });

  test("allows overwrite only when force flag is explicitly provided", () => {
    const existing: ExistingCapsuleRecord = {
      runId: "active-run-456",
      capsulePath: ".olt/capsules/active-run-456",
      hasEvents: true,
      hasReports: false,
      isCompleted: false,
    };
    const ctx: CapsuleCheckContext = {
      capsulePath: existing.capsulePath,
      runId: existing.runId,
      force: true,
    };
    const result = inspectAndGuardPlanInit(ctx, existing);
    expect(result.allowed).toBe(true);
  });
});
