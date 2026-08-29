import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_FLEET_CONFIG,
  FleetAuditorConstraintViolationError,
  assertSingletonSkillAuditorFleet,
  deregisterFleetAuditor,
  detectFleetAuditorConflicts,
  isValidAuditorRecord,
  reconcileFleetAuditors,
  registerFleetAuditor,
  validateSkillAuditorFleetConstraint,
  type FleetAuditorRecord,
  type FleetOrchestratorState,
} from "../../../olt/scripts/src/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.ts";

describe("fb-enforce-singleton-skill-auditor-fleet-constraint (Task 1.1)", () => {
  const createAuditor = (
    auditor_id: string,
    orchestrator_id: string,
    status: FleetAuditorRecord["status"] = "active",
    started_at = "2026-08-29T10:00:00.000Z",
    pid = 12345,
  ): FleetAuditorRecord => ({
    auditor_id,
    role: "skill_auditor",
    orchestrator_id,
    pid,
    status,
    started_at,
    heartbeat_at: new Date().toISOString(),
  });

  test("1. DEFAULT_FLEET_CONFIG declares canonical singleton auditor parameters", () => {
    expect(DEFAULT_FLEET_CONFIG.max_skill_auditors).toBe(1);
    expect(DEFAULT_FLEET_CONFIG.enforce_singleton).toBe(true);
    expect(DEFAULT_FLEET_CONFIG.allowed_roles).toContain("skill_auditor");
    expect(DEFAULT_FLEET_CONFIG.heartbeat_ttl_ms).toBe(60_000);
    expect(DEFAULT_FLEET_CONFIG.lease_duration_ms).toBe(300_000);
  });

  test("2. isValidAuditorRecord returns true for fully compliant auditor records", () => {
    const valid = createAuditor("auditor-01", "orch-01");
    expect(isValidAuditorRecord(valid)).toBe(true);
  });

  test("3. isValidAuditorRecord rejects null, non-objects, and invalid records", () => {
    expect(isValidAuditorRecord(null)).toBe(false);
    expect(isValidAuditorRecord({})).toBe(false);
    expect(isValidAuditorRecord({ auditor_id: "", role: "skill_auditor", pid: 1 })).toBe(false);
    expect(isValidAuditorRecord({ ...createAuditor("a", "o"), pid: -1 })).toBe(false);
    expect(isValidAuditorRecord({ ...createAuditor("a", "o"), started_at: "not-a-date" })).toBe(false);
  });

  test("4. detectFleetAuditorConflicts returns empty array for 0 or 1 active auditor", () => {
    expect(detectFleetAuditorConflicts([])).toEqual([]);
    const single = [createAuditor("auditor-01", "orch-01")];
    expect(detectFleetAuditorConflicts(single)).toEqual([]);
  });

  test("5. detectFleetAuditorConflicts flags all redundant active auditors beyond singleton limit", () => {
    const a1 = createAuditor("auditor-01", "orch-01", "active", "2026-08-29T09:00:00.000Z");
    const a2 = createAuditor("auditor-02", "orch-02", "active", "2026-08-29T09:05:00.000Z");
    const a3 = createAuditor("auditor-03", "orch-03", "active", "2026-08-29T09:10:00.000Z");
    const conflicts = detectFleetAuditorConflicts([a1, a2, a3]);
    expect(conflicts.length).toBe(2);
    expect(conflicts.map((c) => c.auditor_id)).toEqual(["auditor-02", "auditor-03"]);
  });

  test("6. validateSkillAuditorFleetConstraint succeeds with single active skill auditor", () => {
    const records = [createAuditor("auditor-primary", "orch-01")];
    const result = validateSkillAuditorFleetConstraint(records);
    expect(result.valid).toBe(true);
    expect(result.activeCount).toBe(1);
    expect(result.violations.length).toBe(0);
    expect(result.conflictingAuditors.length).toBe(0);
  });

  test("7. validateSkillAuditorFleetConstraint reports violation when duplicate active auditors exist", () => {
    const records = [
      createAuditor("auditor-01", "orch-01", "active", "2026-08-29T08:00:00.000Z"),
      createAuditor("auditor-02", "orch-02", "active", "2026-08-29T08:01:00.000Z"),
    ];
    const result = validateSkillAuditorFleetConstraint(records);
    expect(result.valid).toBe(false);
    expect(result.activeCount).toBe(2);
    expect(result.violations[0]).toContain("SINGLETON_SKILL_AUDITOR_VIOLATION");
    expect(result.conflictingAuditors.length).toBe(1);
  });

  test("8. validateSkillAuditorFleetConstraint processes single FleetOrchestratorState input", () => {
    const orchState: FleetOrchestratorState = {
      orchestrator_id: "orch-standalone",
      auditors: [createAuditor("auditor-solo", "orch-standalone")],
    };
    const result = validateSkillAuditorFleetConstraint(orchState);
    expect(result.valid).toBe(true);
    expect(result.activeCount).toBe(1);
  });

  test("9. validateSkillAuditorFleetConstraint ignores idle, stale, or terminated auditors", () => {
    const records = [
      createAuditor("auditor-term", "orch-01", "terminated"),
      createAuditor("auditor-stale", "orch-02", "stale"),
      createAuditor("auditor-idle", "orch-03", "idle"),
      createAuditor("auditor-active", "orch-04", "active"),
    ];
    const result = validateSkillAuditorFleetConstraint(records);
    expect(result.valid).toBe(true);
    expect(result.activeCount).toBe(1);
  });

  test("10. assertSingletonSkillAuditorFleet passes without throwing on valid fleet state", () => {
    const state: readonly FleetOrchestratorState[] = [
      { orchestrator_id: "orch-01", auditors: [createAuditor("auditor-01", "orch-01")] },
      { orchestrator_id: "orch-02", auditors: [] },
    ];
    expect(() => assertSingletonSkillAuditorFleet(state)).not.toThrow();
  });

  test("11. assertSingletonSkillAuditorFleet throws FleetAuditorConstraintViolationError on conflict", () => {
    const state: readonly FleetOrchestratorState[] = [
      { orchestrator_id: "orch-01", auditors: [createAuditor("auditor-01", "orch-01")] },
      { orchestrator_id: "orch-02", auditors: [createAuditor("auditor-02", "orch-02")] },
    ];
    expect(() => assertSingletonSkillAuditorFleet(state)).toThrow(FleetAuditorConstraintViolationError);
  });

  test("12. FleetAuditorConstraintViolationError encapsulates error code and conflicting records", () => {
    const conflict = createAuditor("auditor-dup", "orch-02");
    const err = new FleetAuditorConstraintViolationError("Duplicate auditor", [conflict]);
    expect(err.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(err.conflictingAuditors.length).toBe(1);
    expect(err.name).toBe("FleetAuditorConstraintViolationError");
  });

  test("13. registerFleetAuditor registers new skill auditor in fleet successfully", () => {
    const initial: readonly FleetOrchestratorState[] = [{ orchestrator_id: "orch-01", auditors: [] }];
    const newAuditor = createAuditor("auditor-01", "orch-01");
    const { updatedState, registered } = registerFleetAuditor(initial, newAuditor);
    expect(registered.auditor_id).toBe("auditor-01");
    expect(updatedState[0]?.auditors.length).toBe(1);
  });

  test("14. registerFleetAuditor throws collision error when registering duplicate active auditor", () => {
    const initial: readonly FleetOrchestratorState[] = [
      { orchestrator_id: "orch-01", auditors: [createAuditor("auditor-01", "orch-01")] },
    ];
    const duplicate = createAuditor("auditor-02", "orch-02");
    expect(() => registerFleetAuditor(initial, duplicate)).toThrow(FleetAuditorConstraintViolationError);
  });

  test("15. registerFleetAuditor updates existing auditor record on same orchestrator", () => {
    const initial: FleetOrchestratorState = {
      orchestrator_id: "orch-01",
      auditors: [createAuditor("auditor-01", "orch-01", "active", "2026-08-29T10:00:00.000Z")],
    };
    const heartbeatUpdate = createAuditor("auditor-01", "orch-01", "active", "2026-08-29T10:00:00.000Z");
    const { updatedState } = registerFleetAuditor(initial, heartbeatUpdate);
    expect(updatedState.auditors.length).toBe(1);
  });

  test("16. deregisterFleetAuditor transitions auditor to terminated status across fleet", () => {
    const initial: readonly FleetOrchestratorState[] = [
      { orchestrator_id: "orch-01", auditors: [createAuditor("auditor-01", "orch-01")] },
    ];
    const { updatedState, deregistered, record } = deregisterFleetAuditor(initial, "auditor-01");
    expect(deregistered).toBe(true);
    expect(record?.status).toBe("terminated");
    expect(updatedState[0]?.auditors[0]?.status).toBe("terminated");
  });

  test("17. reconcileFleetAuditors detects dead PIDs and stale heartbeats", () => {
    const deadAuditor: FleetAuditorRecord = { ...createAuditor("auditor-dead", "orch-01"), pid: 999999 };
    const staleAuditor: FleetAuditorRecord = {
      ...createAuditor("auditor-stale", "orch-02"),
      heartbeat_at: new Date(Date.now() - 120_000).toISOString(),
    };
    const activeAuditor = createAuditor("auditor-live", "orch-03");

    const state: readonly FleetOrchestratorState[] = [
      { orchestrator_id: "orch-01", auditors: [deadAuditor] },
      { orchestrator_id: "orch-02", auditors: [staleAuditor] },
      { orchestrator_id: "orch-03", auditors: [activeAuditor] },
    ];

    const res = reconcileFleetAuditors(state, {
      isPidAlive: (pid) => pid !== 999999,
      heartbeatTtlMs: 60_000,
    });

    expect(res.activeAuditors.length).toBe(1);
    expect(res.activeAuditors[0]?.auditor_id).toBe("auditor-live");
    expect(res.staleAuditors.length).toBe(1);
    expect(res.terminatedAuditors.length).toBe(1);
  });

  test("18. static invariant verification enforces zero TypeScript any and zero suppressions", () => {
    const srcPath = join(process.cwd(), "olt/scripts/src/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.ts");
    const testPath = join(process.cwd(), "tests/unit/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.test.ts");
    const anyPattern = new RegExp([":\\s*an", "y\\b|as\\s+an", "y\\b|<an", "y>"].join(""));
    const suppressionPattern = new RegExp(["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"));

    for (const filePath of [srcPath, testPath]) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;
        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
