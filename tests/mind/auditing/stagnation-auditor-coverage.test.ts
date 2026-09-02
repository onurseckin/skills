import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditMindPreplanningStagnation,
  auditMindCreativeStagnation,
  auditMindPreplanningLiveness,
  MIND_PREPLANNING_STAGNATION,
  MIND_CREATIVE_STAGNATION,
  DEFAULT_STAGNATION_THRESHOLD_SECONDS,
  DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES,
  DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES,
} from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import type {
  RawBacklogItem,
  RawDefectItem,
  StagnationAuditResult,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Mind Stagnation Auditor Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stagnation-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const makeBacklog = (id: string, status = "PENDING"): RawBacklogItem => ({
    id,
    title: `Backlog ${id}`,
    status,
    priority: "HIGH",
    domain: "core",
  });

  const makeDefect = (id: string, status = "OPEN"): RawDefectItem => ({
    id,
    title: `Defect ${id}`,
    status,
    severity: "HIGH",
    error_code: "SAMPLE_ERR",
  });

  describe("Constants & Function Aliases", () => {
    it("exports default threshold constants and error codes", () => {
      expect(MIND_PREPLANNING_STAGNATION).toBe("MIND_PREPLANNING_STAGNATION");
      expect(MIND_CREATIVE_STAGNATION).toBe("MIND_CREATIVE_STAGNATION");
      expect(DEFAULT_STAGNATION_THRESHOLD_SECONDS).toBe(180);
      expect(DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES).toBe(2);
      expect(DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES).toBe(2);
      expect(auditMindPreplanningLiveness).toBe(auditMindPreplanningStagnation);
    });
  });

  describe("auditMindPreplanningStagnation - Healthy vs Idle Stagnation", () => {
    it("returns healthy report when empty backlog and defects are provided", () => {
      const report = auditMindPreplanningStagnation({ explicitBacklog: [], explicitDefects: [] });
      expect(report.is_stagnant).toBe(false);
      expect(report.pending_backlog_count).toBe(0);
      expect(report.open_defects_count).toBe(0);
      expect(report.findings[0]).toContain("healthy");
      expect(typeof report.cognitive_challenge_prompt).toBe("string");
    });

    it("evaluates default invocation without options against repository root", () => {
      const report = auditMindPreplanningStagnation();
      expect(typeof report.is_stagnant).toBe("boolean");
      expect(typeof report.pending_backlog_count).toBe("number");
      expect(typeof report.open_defects_count).toBe("number");
      expect(report.findings.length).toBeGreaterThan(0);
    });

    it("evaluates eligible items within allowable idle window as healthy", () => {
      const nowMs = 1788264000000;
      const lastPreplan = new Date(nowMs - 30000).toISOString();
      const report = auditMindPreplanningStagnation({
        nowMs,
        lastPreplanTimestamp: lastPreplan,
        stagnationThresholdSeconds: 180,
        explicitBacklog: [makeBacklog("b1")],
        explicitDefects: [makeDefect("d1")],
      });
      expect(report.is_stagnant).toBe(false);
      expect(report.pending_backlog_count).toBe(1);
      expect(report.idle_duration_seconds).toBeCloseTo(30, 1);
      expect(report.findings[0]).toContain("within the allowable window");
    });

    it("flags MIND_PREPLANNING_STAGNATION when idle duration exceeds threshold with and without shock", () => {
      const nowMs = 1788264000000;
      const lastPreplan = new Date(nowMs - 200000).toISOString();
      const repShock = auditMindPreplanningStagnation({
        nowMs,
        lastPreplanTimestamp: lastPreplan,
        stagnationThresholdSeconds: 180,
        explicitBacklog: [makeBacklog("b1"), makeBacklog("b2")],
        explicitDefects: [makeDefect("d1")],
        triggerShockRecovery: true,
      });
      expect(repShock.is_stagnant).toBe(true);
      expect(repShock.error_code).toBe(MIND_PREPLANNING_STAGNATION);
      expect(repShock.shock_recovery?.recovered).toBe(true);

      const repNoShock = auditMindPreplanningStagnation({
        nowMs,
        lastPreplanTimestamp: lastPreplan,
        stagnationThresholdSeconds: 180,
        explicitBacklog: [makeBacklog("b1")],
        explicitDefects: [],
        triggerShockRecovery: false,
      });
      expect(repNoShock.is_stagnant).toBe(true);
      expect(repNoShock.shock_recovery).toBeUndefined();
    });

    it("handles untracked duration when lastPreplanTimestamp is null and unplanned items exist", () => {
      const report = auditMindPreplanningStagnation({
        lastPreplanTimestamp: null,
        explicitBacklog: [makeBacklog("b1")],
        explicitDefects: [],
      });
      expect(report.is_stagnant).toBe(true);
      expect(report.error_code).toBe(MIND_PREPLANNING_STAGNATION);
      expect(report.idle_duration_seconds).toBe(999999);
      expect(report.findings[0]).toContain("untracked duration");
    });
  });

  describe("Maintenance Loops & MIND_CREATIVE_STAGNATION", () => {
    it("flags MIND_CREATIVE_STAGNATION when isMaintenanceOnlyLoop is true with and without shock", () => {
      const repShock = auditMindPreplanningStagnation({
        isMaintenanceOnlyLoop: true,
        consecutiveMaintenanceCycles: 1,
        triggerShockRecovery: true,
        rootDir: tempDir,
      });
      expect(repShock.is_stagnant).toBe(true);
      expect(repShock.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(repShock.shock_recovery?.recovered).toBe(true);

      const repNoShock = auditMindPreplanningStagnation({
        isMaintenanceOnlyLoop: true,
        triggerShockRecovery: false,
        rootDir: tempDir,
      });
      expect(repNoShock.is_stagnant).toBe(true);
      expect(repNoShock.shock_recovery).toBeUndefined();
    });

    it("flags MIND_CREATIVE_STAGNATION when consecutiveMaintenanceCycles exceeds threshold without product progress", () => {
      const report = auditMindPreplanningStagnation({
        consecutiveMaintenanceCycles: 3,
        maintenanceLoopThresholdCycles: 2,
        productProgressMade: false,
      });
      expect(report.is_stagnant).toBe(true);
      expect(report.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(report.findings[0]).toContain("(3 cycles)");

      const healthy = auditMindPreplanningStagnation({
        consecutiveMaintenanceCycles: 3,
        maintenanceLoopThresholdCycles: 2,
        productProgressMade: true,
        explicitBacklog: [],
        explicitDefects: [],
      });
      expect(healthy.is_stagnant).toBe(false);
    });
  });

  describe("Zero-Delta Comparison & Chronic Stagnation", () => {
    it("detects chronic zero delta pulses and escalates to MIND_CREATIVE_STAGNATION with and without shock", () => {
      const baseline: StagnationAuditResult = {
        is_stagnant: false,
        pending_backlog_count: 1,
        open_defects_count: 0,
        last_preplan_timestamp: "2026-09-01T12:00:00.000Z",
        idle_duration_seconds: 10,
        findings: [
          "Unplanned items exist (1), but idle duration (10.0s) is within the allowable window (180s).",
        ],
      };

      const nowMs = Date.parse("2026-09-01T12:00:10.000Z");
      const repShock = auditMindPreplanningStagnation({
        nowMs,
        lastPreplanTimestamp: "2026-09-01T12:00:00.000Z",
        stagnationThresholdSeconds: 180,
        explicitBacklog: [makeBacklog("b1")],
        explicitDefects: [],
        previousReport: baseline,
        consecutiveZeroDeltaCount: 2,
        zeroDeltaThresholdCycles: 2,
        triggerShockRecovery: true,
        rootDir: tempDir,
      });
      expect(repShock.is_stagnant).toBe(true);
      expect(repShock.error_code).toBe(MIND_CREATIVE_STAGNATION);
      expect(repShock.shock_recovery?.recovered).toBe(true);

      const repNoShock = auditMindPreplanningStagnation({
        nowMs,
        lastPreplanTimestamp: "2026-09-01T12:00:00.000Z",
        stagnationThresholdSeconds: 180,
        explicitBacklog: [makeBacklog("b1")],
        explicitDefects: [],
        previousReport: baseline,
        consecutiveZeroDeltaCount: 2,
        zeroDeltaThresholdCycles: 2,
        triggerShockRecovery: false,
        rootDir: tempDir,
      });
      expect(repNoShock.is_stagnant).toBe(true);
      expect(repNoShock.shock_recovery).toBeUndefined();
    });

    it("supports zero delta suppression on healthy reports", () => {
      const baseline: StagnationAuditResult = {
        is_stagnant: false,
        pending_backlog_count: 0,
        open_defects_count: 0,
        last_preplan_timestamp: null,
        idle_duration_seconds: 0,
        findings: ["healthy"],
      };
      const sup = auditMindPreplanningStagnation({
        explicitBacklog: [],
        explicitDefects: [],
        previousReport: baseline,
        suppressZeroDelta: true,
      });
      expect(sup.zero_delta && sup.suppressed).toBe(true);

      const unsup = auditMindPreplanningStagnation({
        explicitBacklog: [],
        explicitDefects: [],
        previousReport: baseline,
        suppressZeroDelta: false,
      });
      expect(unsup.suppressed).toBe(false);
    });
  });

  describe("auditMindCreativeStagnation & Ledger Loading", () => {
    it("handles creative stagnation and loads backlog/defects from disk", () => {
      expect(auditMindCreativeStagnation().is_stagnant).toBe(true);
      expect(
        auditMindCreativeStagnation({
          isMaintenanceOnlyLoop: false,
          explicitBacklog: [],
          explicitDefects: [],
        }).is_stagnant,
      ).toBe(false);

      const backlogFile = join(tempDir, "b.jsonl");
      const defectsFile = join(tempDir, "d.jsonl");
      writeFileSync(
        backlogFile,
        JSON.stringify({
          id: "b1",
          title: "Item",
          status: "PENDING",
          priority: "MED",
          domain: "core",
        }) + "\n",
      );
      writeFileSync(
        defectsFile,
        JSON.stringify({
          id: "d1",
          title: "Defect",
          status: "OPEN",
          severity: "HIGH",
          error_code: "E1",
        }) + "\n",
      );

      const rep = auditMindPreplanningStagnation({
        rootDir: tempDir,
        backlogFile,
        defectsFile,
        stagnationThresholdSeconds: 10,
        lastPreplanTimestamp: new Date(Date.now() - 50000).toISOString(),
      });
      expect(
        rep.is_stagnant && rep.pending_backlog_count === 1 && rep.open_defects_count === 1,
      ).toBe(true);
    });
  });
});
