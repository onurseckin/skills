import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import type { AgentGrantRecord, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/mind-fixture.ts";
import {
  extractActiveGrants,
  verifyPulseCompanionAuditors,
} from "../../../../olt/scripts/src/mind/lifecycle/pulse.ts";
import {
  readLastPulse,
  reconcileLastPulse,
  resolveLastPulsePath,
  writeLastPulse,
  pulseProducedActivity,
  type LastPulseRecord,
} from "../../../../olt/scripts/src/mind/lifecycle/pulse/last-pulse.ts";
import {
  createPulseHeartbeat,
  evaluateMindLiveness,
} from "../../../../olt/scripts/src/mind/lifecycle/liveness/probe.ts";
import { formatLivenessBrief } from "../../../../olt/scripts/src/mind/lifecycle/liveness/brief.ts";
import {
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
  evaluateLivenessFromRecord,
  getExitCodeForStatus,
} from "../../../../olt/scripts/src/mind/lifecycle/liveness/types.ts";

describe("Pulse & Heartbeat Lifecycle Verification Suite", () => {
  let capsuleRoot: string;

  beforeEach(() => {
    setupVirtualMindFS();
    capsuleRoot = scratchRoot("pulse-heartbeat");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("Companion Auditor Verification", () => {
    const makeGrant = (
      role: string,
      id: string,
      status: "active" | "released" = "active",
    ): AgentGrantRecord => ({
      id,
      role: role as AgentGrantRecord["role"],
      status: status as AgentGrantRecord["status"],
      parent_agent_id: null,
      parent_task_id: null,
      host: "localhost",
      granted_at: "2026-09-01T12:00:00.000Z",
    });

    it("verifies successfully when both companion auditors are active", () => {
      const grants = [
        makeGrant("mind-auditor", "mind-gen-1-mind-auditor", "active"),
        makeGrant("skill-auditor", "mind-gen-1-skill-auditor", "active"),
      ];

      const res = verifyPulseCompanionAuditors(grants);
      expect(res.verified).toBe(true);
      expect(res.allHealthy).toBe(true);
      expect(res.mindAuditorPresent).toBe(true);
      expect(res.skillAuditorPresent).toBe(true);
      expect(res.issues.length).toBe(0);
    });

    it("fails verification when mind-auditor is missing", () => {
      const grants = [makeGrant("skill-auditor", "mind-gen-1-skill-auditor", "active")];

      const res = verifyPulseCompanionAuditors(grants);
      expect(res.verified).toBe(false);
      expect(res.mindAuditorPresent).toBe(false);
      expect(res.skillAuditorPresent).toBe(true);
      expect(res.issues.some((i) => i.includes("mind-auditor"))).toBe(true);
    });

    it("fails verification when skill-auditor is missing", () => {
      const grants = [makeGrant("mind-auditor", "mind-gen-1-mind-auditor", "active")];

      const res = verifyPulseCompanionAuditors(grants);
      expect(res.verified).toBe(false);
      expect(res.mindAuditorPresent).toBe(true);
      expect(res.skillAuditorPresent).toBe(false);
      expect(res.issues.some((i) => i.includes("skill-auditor"))).toBe(true);
    });

    it("reports two issues when both companion auditors are missing", () => {
      const res = verifyPulseCompanionAuditors([]);
      expect(res.verified).toBe(false);
      expect(res.allHealthy).toBe(false);
      expect(res.issues.length).toBe(2);
    });

    it("filters out released auditor grants as inactive", () => {
      const grants = [
        makeGrant("mind-auditor", "mind-gen-1-mind-auditor", "released"),
        makeGrant("skill-auditor", "mind-gen-1-skill-auditor", "released"),
      ];

      const res = verifyPulseCompanionAuditors(grants);
      expect(res.verified).toBe(false);
      expect(res.mindAuditorPresent).toBe(false);
      expect(res.skillAuditorPresent).toBe(false);
    });

    it("extracts active grants seamlessly from agent state object", () => {
      const stateObj = {
        agents: [
          makeGrant("mind-auditor", "mind-gen-1-mind-auditor", "active"),
          makeGrant("skill-auditor", "mind-gen-1-skill-auditor", "active"),
        ],
      };

      const extracted = extractActiveGrants(stateObj);
      expect(extracted.length).toBe(2);
      const res = verifyPulseCompanionAuditors(stateObj);
      expect(res.verified).toBe(true);
    });
  });

  describe("Last Pulse Durable Persistence in VirtualMemoryFS", () => {
    it("writes and reads last_pulse.json in memory", () => {
      const record: LastPulseRecord = {
        at: "2026-09-01T15:00:00.000Z",
        pulse_id: "pulse-001",
        outcome: "progressed",
        next_wake_at: "2026-09-01T15:05:00.000Z",
      };

      writeLastPulse(capsuleRoot, record);
      const pulseFile = resolveLastPulsePath(capsuleRoot);
      expect(fs.existsSync(pulseFile)).toBe(true);

      const loaded = readLastPulse(capsuleRoot);
      expect(loaded).not.toBeNull();
      expect(loaded?.pulse_id).toBe("pulse-001");
      expect(loaded?.outcome).toBe("progressed");
      expect(pulseProducedActivity(loaded)).toBe(true);
    });

    it("returns null when last_pulse.json does not exist or is corrupted", () => {
      expect(readLastPulse(capsuleRoot)).toBeNull();

      const pulseFile = resolveLastPulsePath(capsuleRoot);
      fs.writeFileSync(pulseFile, "not-valid-json", "utf-8");
      expect(readLastPulse(capsuleRoot)).toBeNull();
    });

    it("verifies pulseProducedActivity quiescence and falsy semantics", () => {
      expect(pulseProducedActivity(null)).toBe(false);
      expect(pulseProducedActivity(undefined)).toBe(false);

      const quiescentRecord: LastPulseRecord = {
        at: "2026-09-01T15:00:00.000Z",
        pulse_id: "pulse-quiescent",
        outcome: "idle_quiescent",
        next_wake_at: null,
      };
      expect(pulseProducedActivity(quiescentRecord)).toBe(false);
    });

    it("reconciles last_pulse.json against authoritative RunState including armed_at fallback", () => {
      const state = {
        pulse: {
          last: {
            closed_at: "2026-09-01T16:00:00.000Z",
            pulse_id: "pulse-002",
            outcome: "reconciled_ok",
            next_wake_at: "2026-09-01T16:10:00.000Z",
          },
        },
      } as unknown as RunState;

      const result = reconcileLastPulse(capsuleRoot, state);
      expect(result.reconciled).toBe(true);
      expect(result.record.pulse_id).toBe("pulse-002");

      const secondResult = reconcileLastPulse(capsuleRoot, state);
      expect(secondResult.reconciled).toBe(false);
      expect(secondResult.record.pulse_id).toBe("pulse-002");

      const armedState = {
        pulse: {
          last: {
            armed_at: "2026-09-01T17:00:00.000Z",
            pulse_id: "pulse-armed",
            outcome: "in_progress",
            next_wake_at: null,
          },
        },
      } as unknown as RunState;
      const armedResult = reconcileLastPulse(capsuleRoot, armedState);
      expect(armedResult.reconciled).toBe(true);
      expect(armedResult.record.at).toBe("2026-09-01T17:00:00.000Z");
    });
  });

  describe("Liveness Heartbeat Probe, Status Evaluation & CLI Mapping", () => {
    it("creates pulse heartbeat record and evaluates it as fresh and healthy", () => {
      const record = createPulseHeartbeat("pulse-100", {
        outcome: "completed",
        timestamp: "2026-09-01T12:00:00.000Z",
      });
      expect(record.pulse_id).toBe("pulse-100");
      expect(record.outcome).toBe("completed");

      const nowMs = Date.parse(record.at as string) + 1000;
      const status = evaluateLivenessFromRecord(record, { nowMs });
      expect(status.status).toBe("healthy");
      expect(status.healthy).toBe(true);
      expect(getExitCodeForStatus(status.status)).toBe(EXIT_CODE_HEALTHY);
    });

    it("evaluates timestamp candidate precedence: closed_at > at > started_at > opened_at", () => {
      const nowMs = Date.parse("2026-09-01T12:00:10.000Z");

      const precedence1 = evaluateLivenessFromRecord(
        {
          closed_at: "2026-09-01T12:00:05.000Z",
          at: "2026-09-01T11:00:00.000Z",
        },
        { nowMs, maxAllowedAgeMs: 10_000 },
      );
      expect(precedence1.status).toBe("healthy");

      const precedence2 = evaluateLivenessFromRecord(
        {
          started_at: "2026-09-01T12:00:08.000Z",
          opened_at: "2026-09-01T11:00:00.000Z",
        },
        { nowMs, maxAllowedAgeMs: 10_000 },
      );
      expect(precedence2.status).toBe("healthy");
    });

    it("asserts strict threshold boundary conditions (age <= maxAllowedAgeMs)", () => {
      const baseMs = 1_000_000;
      const threshold = 10_000;

      const exactBoundary = evaluateLivenessFromRecord(
        { at: new Date(baseMs).toISOString() },
        { nowMs: baseMs + threshold, maxAllowedAgeMs: threshold },
      );
      expect(exactBoundary.status).toBe("healthy");

      const exceededBoundary = evaluateLivenessFromRecord(
        { at: new Date(baseMs).toISOString() },
        { nowMs: baseMs + threshold + 1, maxAllowedAgeMs: threshold },
      );
      expect(exceededBoundary.status).toBe("stale");
    });

    it("evaluates stale when age exceeds threshold, and handles corrupted/missing records", () => {
      const nowMs = Date.parse("2026-09-01T12:00:00.000Z");

      const stale = evaluateLivenessFromRecord(
        { at: "2026-09-01T10:00:00.000Z" },
        { nowMs, maxAllowedAgeMs: 60_000 },
      );
      expect(stale.status).toBe("stale");
      expect(getExitCodeForStatus(stale.status)).toBe(EXIT_CODE_STALE);

      const corrupted = evaluateLivenessFromRecord({ at: "invalid-iso-date" }, { nowMs });
      expect(corrupted.status).toBe("corrupted_record");
      expect(getExitCodeForStatus(corrupted.status)).toBe(EXIT_CODE_CHECK_FAILURE);

      const emptyCapsule = scratchRoot("empty-capsule");
      const missing = evaluateMindLiveness(emptyCapsule);
      expect(missing.status).toBe("missing_record");
      expect(getExitCodeForStatus(missing.status)).toBe(EXIT_CODE_CHECK_FAILURE);
    });

    it("formats rich liveness brief with icons and metrics", () => {
      const healthyStatus = evaluateLivenessFromRecord({
        at: new Date().toISOString(),
        pulse_id: "pulse-brief",
        outcome: "ok",
      });
      const brief = formatLivenessBrief(healthyStatus);
      expect(brief).toContain("Mind Liveness Status");
      expect(brief).toContain("HEALTHY");
      expect(brief).toContain("pulse-brief");
    });
  });
});
