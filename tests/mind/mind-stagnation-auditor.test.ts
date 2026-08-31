import { describe, expect, it } from "bun:test";
import {
  auditMindCreativeStagnation,
  auditMindPreplanningStagnation,
  compareReportDelta,
  computeStateSignature,
  DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES,
  DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES,
  isZeroDeltaReport,
  MIND_CREATIVE_STAGNATION,
  MIND_PREPLANNING_STAGNATION,
  suppressZeroDeltaReport,
} from "../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import {
  CHRONIC_STAGNATION_CYCLE_THRESHOLD,
  executeStagnationShockRecovery,
  MODE_A_AUTONOMIC_DISCOVERY,
  MODE_STANDARD_PREPLAN,
} from "../../olt/scripts/src/mind/auditing/stagnation-recovery-interlock.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
  StagnationAuditResult,
} from "../../olt/scripts/src/mind/preplanning/types.ts";

describe("Active Anti-Passivity: Mind Pre-Planning Stagnation Auditor (Task 3.1)", () => {
  const nowMs = 1756465000000;

  it("reports healthy when no unplanned backlog or defect items exist", () => {
    const plannedBacklog: readonly RawBacklogItem[] = [
      { id: "item-1", title: "Task 1", status: "PLANNED", plan_path: "docs/planning/p1/PLAN.md" },
    ];
    const resolvedDefects: readonly RawDefectItem[] = [
      { id: "def-1", title: "Defect 1", status: "RESOLVED" },
    ];

    const result = auditMindPreplanningStagnation({
      explicitBacklog: plannedBacklog,
      explicitDefects: resolvedDefects,
      nowMs,
    });

    expect(result.is_stagnant).toBe(false);
    expect(result.pending_backlog_count).toBe(0);
    expect(result.open_defects_count).toBe(0);
    expect(result.error_code).toBeUndefined();
    expect(result.findings[0]).toContain("pipeline is healthy");
  });

  it("flags MIND_PREPLANNING_STAGNATION when unplanned items exist and Mind idled past threshold", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-pending-1", title: "Unplanned Task", status: "PENDING" },
      { id: "item-pending-2", title: "Unplanned Task 2", status: "PENDING" },
    ];
    const openDefects: readonly RawDefectItem[] = [
      { id: "def-open-1", title: "Unplanned Defect", status: "OPEN" },
    ];

    const lastPreplanTimestamp = new Date(nowMs - 300_000).toISOString();

    const result = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: openDefects,
      lastPreplanTimestamp,
      nowMs,
    });

    expect(result.is_stagnant).toBe(true);
    expect(result.pending_backlog_count).toBe(2);
    expect(result.open_defects_count).toBe(1);
    expect(result.error_code).toBe(MIND_PREPLANNING_STAGNATION);
    expect(result.recommended_remediation).toBe("RUN_PREPLANNING_FACTORY");
    expect(result.idle_duration_seconds).toBe(300);
    expect(result.findings.some((f) => f.includes("stagnated"))).toBe(true);
  });

  it("allows recent arrivals within threshold window without flagging stagnation", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-new-1", title: "Fresh Task", status: "PENDING" },
    ];

    const lastPreplanTimestamp = new Date(nowMs - 30_000).toISOString();

    const result = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: [],
      lastPreplanTimestamp,
      nowMs,
    });

    expect(result.is_stagnant).toBe(false);
    expect(result.pending_backlog_count).toBe(1);
    expect(result.idle_duration_seconds).toBe(30);
    expect(result.error_code).toBeUndefined();
  });

  it("AGP-3: Stagnation active shock recovery probe triggers shock recovery on stagnant audit", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-pending-1", title: "Unplanned Task", status: "PENDING" },
    ];
    const lastPreplanTimestamp = new Date(nowMs - 300_000).toISOString();
    const auditResult = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: [],
      lastPreplanTimestamp,
      nowMs,
    });

    let actionDispatched = false;
    const shockResult = executeStagnationShockRecovery({
      auditResult,
      consecutiveStagnationCount: 1,
      dispatchAction: () => {
        actionDispatched = true;
      },
    });

    expect(shockResult.triggered).toBe(true);
    expect(shockResult.dispatchedTaskId).toBeDefined();
    expect(shockResult.mode).toBe(MODE_STANDARD_PREPLAN);
    expect(shockResult.escalated).toBe(false);
    expect(shockResult.recoveryAction).toBe("DISPATCH_PREPLANNING_SYNTHESIS");
    expect(actionDispatched).toBe(true);
  });

  it("AGP-4: Chronic Stagnation Mode Escalation Probe auto-escalates to MODE_A_AUTONOMIC_DISCOVERY", () => {
    const openBacklog: readonly RawBacklogItem[] = [
      { id: "item-chronic-1", title: "Chronic Unplanned Task", status: "PENDING" },
    ];
    const lastPreplanTimestamp = new Date(nowMs - 500_000).toISOString();
    const auditResult = auditMindPreplanningStagnation({
      explicitBacklog: openBacklog,
      explicitDefects: [],
      lastPreplanTimestamp,
      nowMs,
    });

    const shockResult = executeStagnationShockRecovery({
      auditResult,
      consecutiveStagnationCount: CHRONIC_STAGNATION_CYCLE_THRESHOLD,
    });

    expect(shockResult.triggered).toBe(true);
    expect(shockResult.mode).toBe(MODE_A_AUTONOMIC_DISCOVERY);
    expect(shockResult.escalated).toBe(true);
    expect(shockResult.recoveryAction).toBe("DISPATCH_AUTONOMIC_DISCOVERY_PULSE");
    expect(shockResult.details).toContain("Chronic stagnation threshold reached");
  });

  it("bypasses shock recovery when audit result is healthy and forceExecution is false", () => {
    const auditResult = auditMindPreplanningStagnation({
      explicitBacklog: [],
      explicitDefects: [],
      nowMs,
    });

    const shockResult = executeStagnationShockRecovery({
      auditResult,
    });

    expect(shockResult.triggered).toBe(false);
    expect(shockResult.mode).toBe(MODE_STANDARD_PREPLAN);
    expect(shockResult.recoveryAction).toBe("NOOP_HEALTHY");
  });

  describe("Zero-Delta Report Comparison & Suppression", () => {
    const baseReport: StagnationAuditResult = {
      is_stagnant: false,
      pending_backlog_count: 3,
      open_defects_count: 1,
      last_preplan_timestamp: "2026-08-30T10:00:00.000Z",
      idle_duration_seconds: 45,
      findings: ["Healthy preplanning cadence."],
    };

    it("computeStateSignature generates deterministic signature for identical state", () => {
      const sig1 = computeStateSignature(baseReport);
      const sig2 = computeStateSignature({ ...baseReport });
      expect(sig1).toBe(sig2);

      const modifiedSig = computeStateSignature({ ...baseReport, pending_backlog_count: 4 });
      expect(modifiedSig).not.toBe(sig1);
    });

    it("compareReportDelta detects zero delta across identical consecutive reports", () => {
      const delta = compareReportDelta(baseReport, baseReport);
      expect(delta.isZeroDelta).toBe(true);
      expect(delta.backlogDelta).toBe(0);
      expect(delta.defectDelta).toBe(0);
      expect(delta.findingsDelta).toBe(false);
      expect(delta.statusDelta).toBe(false);
      expect(delta.signatureChanged).toBe(false);
      expect(delta.suppressed).toBe(true);
    });

    it("compareReportDelta detects item delta when backlog or defects change", () => {
      const updatedReport: StagnationAuditResult = {
        ...baseReport,
        pending_backlog_count: 5,
        open_defects_count: 0,
      };

      const delta = compareReportDelta(updatedReport, baseReport);
      expect(delta.isZeroDelta).toBe(false);
      expect(delta.backlogDelta).toBe(2);
      expect(delta.defectDelta).toBe(-1);
      expect(delta.suppressed).toBe(false);
    });

    it("isZeroDeltaReport returns true for identical reports and false for changed reports", () => {
      expect(isZeroDeltaReport(baseReport, baseReport)).toBe(true);
      expect(isZeroDeltaReport(baseReport, null)).toBe(false);
      expect(isZeroDeltaReport(baseReport, { ...baseReport, findings: ["Changed finding"] })).toBe(
        false,
      );
    });

    it("suppressZeroDeltaReport suppresses duplicate zero-delta reports", () => {
      const suppressed = suppressZeroDeltaReport(baseReport, baseReport);
      expect(suppressed.zero_delta).toBe(true);
      expect(suppressed.suppressed).toBe(true);
      expect(suppressed.delta_summary).toContain("Suppressed duplicate");

      const notSuppressed = suppressZeroDeltaReport(
        { ...baseReport, pending_backlog_count: 10 },
        baseReport,
      );
      expect(notSuppressed.zero_delta).toBe(false);
      expect(notSuppressed.suppressed).toBe(false);
    });

    it("auditMindPreplanningStagnation suppresses zero-delta report when suppressZeroDelta is true", () => {
      const openBacklog: readonly RawBacklogItem[] = [
        { id: "task-1", title: "Task 1", status: "PENDING" },
      ];
      const previousReport = auditMindPreplanningStagnation({
        explicitBacklog: openBacklog,
        explicitDefects: [],
        lastPreplanTimestamp: new Date(nowMs - 10_000).toISOString(),
        nowMs,
      });

      const currentReport = auditMindPreplanningStagnation({
        explicitBacklog: openBacklog,
        explicitDefects: [],
        lastPreplanTimestamp: new Date(nowMs - 10_000).toISOString(),
        nowMs,
        previousReport,
        suppressZeroDelta: true,
      });

      expect(currentReport.zero_delta).toBe(true);
      expect(currentReport.suppressed).toBe(true);
    });
  });

  describe("Creative Stagnation Detection (MIND_CREATIVE_STAGNATION)", () => {
    it("flags MIND_CREATIVE_STAGNATION when Mind is in a maintenance-only loop without product progress", () => {
      const result = auditMindPreplanningStagnation({
        explicitBacklog: [],
        explicitDefects: [{ id: "def-1", title: "Maintenance defect", status: "OPEN" }],
        isMaintenanceOnlyLoop: true,
        consecutiveMaintenanceCycles: 4,
        productProgressMade: false,
        nowMs,
      });

      expect(result.is_stagnant).toBe(true);
      expect(result.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(result.recommended_remediation).toBe("AUTONOMIC_CREATIVE_OVERLOAD");
      expect(result.findings[0]).toContain("maintenance-only loop");
      expect(result.findings[0]).toContain("MIND_CREATIVE_STAGNATION");
    });

    it("flags MIND_CREATIVE_STAGNATION when consecutive pulses produce identical state with 0 delta", () => {
      const openBacklog: readonly RawBacklogItem[] = [
        { id: "task-stalled-1", title: "Stalled Task", status: "PENDING" },
      ];
      const previousReport: StagnationAuditResult = {
        is_stagnant: false,
        pending_backlog_count: 1,
        open_defects_count: 0,
        last_preplan_timestamp: new Date(nowMs - 20_000).toISOString(),
        idle_duration_seconds: 20,
        findings: [
          "Unplanned items exist (1), but idle duration (20.0s) is within the allowable window (180s).",
        ],
      };

      const result = auditMindPreplanningStagnation({
        explicitBacklog: openBacklog,
        explicitDefects: [],
        lastPreplanTimestamp: new Date(nowMs - 20_000).toISOString(),
        nowMs,
        previousReport,
        consecutiveZeroDeltaCount: DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES,
      });

      expect(result.is_stagnant).toBe(true);
      expect(result.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(result.recommended_remediation).toBe("AUTONOMIC_CREATIVE_OVERLOAD");
      expect(result.zero_delta).toBe(true);
      expect(result.findings[0]).toContain("0 delta");
    });

    it("auditMindCreativeStagnation helper directly triggers creative stagnation audit", () => {
      const result = auditMindCreativeStagnation({
        explicitBacklog: [],
        explicitDefects: [],
        consecutiveMaintenanceCycles: DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES,
        nowMs,
      });

      expect(result.is_stagnant).toBe(true);
      expect(result.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(result.recommended_remediation).toBe("AUTONOMIC_CREATIVE_OVERLOAD");
    });

    it("executeStagnationShockRecovery auto-escalates MIND_CREATIVE_STAGNATION to MODE_A_AUTONOMIC_DISCOVERY", () => {
      const creativeStagnantAudit: StagnationAuditResult = {
        is_stagnant: true,
        pending_backlog_count: 0,
        open_defects_count: 0,
        last_preplan_timestamp: null,
        idle_duration_seconds: 0,
        error_code: MIND_CREATIVE_STAGNATION,
        findings: ["Mind in maintenance loop without product progress."],
        recommended_remediation: "AUTONOMIC_CREATIVE_OVERLOAD",
      };

      const shockResult = executeStagnationShockRecovery({
        auditResult: creativeStagnantAudit,
        consecutiveStagnationCount: 1,
      });

      expect(shockResult.triggered).toBe(true);
      expect(shockResult.mode).toBe(MODE_A_AUTONOMIC_DISCOVERY);
      expect(shockResult.escalated).toBe(true);
      expect(shockResult.recoveryAction).toBe("DISPATCH_AUTONOMIC_DISCOVERY_PULSE");
      expect(shockResult.details).toContain("Creative stagnation detected");
    });
  });
});
