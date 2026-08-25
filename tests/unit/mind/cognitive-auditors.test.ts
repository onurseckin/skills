import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../../olt/scripts/src/mind/cognitive-auditors.ts";

const MIN_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
must_not:
  - Implement code directly
`;

describe("AuditorCursorStore", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-auditor-cursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(join(testDir, ".olt"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("resolveCursorPath points to .olt/auditor-cursors.json", () => {
    const p = AuditorCursorStore.resolveCursorPath(testDir);
    expect(p).toBe(join(testDir, ".olt", "auditor-cursors.json"));
  });

  test("loadCursor returns default cursor when file does not exist", () => {
    const mindCursor = AuditorCursorStore.loadCursor(testDir, "mind");
    expect(mindCursor.lastInspectedTimestamp).toBe("1970-01-01T00:00:00.000Z");
    expect(mindCursor.lastInspectedEventIndex).toBe(-1);

    const skillCursor = AuditorCursorStore.loadCursor(testDir, "skill");
    expect(skillCursor.lastInspectedTimestamp).toBe("1970-01-01T00:00:00.000Z");
    expect(skillCursor.lastInspectedEventIndex).toBe(-1);
  });

  test("loadCursor handles corrupt JSON gracefully and returns default cursor", () => {
    const p = AuditorCursorStore.resolveCursorPath(testDir);
    writeFileSync(p, "{ this is not valid json }", "utf-8");

    const cursor = AuditorCursorStore.loadCursor(testDir, "mind");
    expect(cursor.lastInspectedTimestamp).toBe("1970-01-01T00:00:00.000Z");
    expect(cursor.lastInspectedEventIndex).toBe(-1);
  });

  test("saveCursor saves mind cursor and loadCursor retrieves it", () => {
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
      lastInspectedEventIndex: 42,
      lastAuditTimestamp: "2026-08-24T12:00:00.000Z",
    };

    AuditorCursorStore.saveCursor(testDir, "mind", cursor);

    const loaded = AuditorCursorStore.loadCursor(testDir, "mind");
    expect(loaded.lastInspectedTimestamp).toBe("2026-08-24T12:00:00.000Z");
    expect(loaded.lastInspectedEventIndex).toBe(42);
    expect(loaded.lastAuditTimestamp).toBe("2026-08-24T12:00:00.000Z");
  });

  test("saveCursor saves both mind and skill cursors independently without JSON corruption", () => {
    const mindCursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T10:00:00.000Z",
      lastInspectedEventIndex: 10,
      lastAuditTimestamp: "2026-08-24T10:00:00.000Z",
    };
    const skillCursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T11:00:00.000Z",
      lastInspectedEventIndex: 99,
      lastAuditTimestamp: "2026-08-24T11:00:00.000Z",
    };

    AuditorCursorStore.saveCursor(testDir, "mind", mindCursor);
    AuditorCursorStore.saveCursor(testDir, "skill", skillCursor);

    const loadedMind = AuditorCursorStore.loadCursor(testDir, "mind");
    const loadedSkill = AuditorCursorStore.loadCursor(testDir, "skill");

    expect(loadedMind.lastInspectedTimestamp).toBe("2026-08-24T10:00:00.000Z");
    expect(loadedMind.lastInspectedEventIndex).toBe(10);
    expect(loadedSkill.lastInspectedTimestamp).toBe("2026-08-24T11:00:00.000Z");
    expect(loadedSkill.lastInspectedEventIndex).toBe(99);

    const raw = readFileSync(AuditorCursorStore.resolveCursorPath(testDir), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("mind");
    expect(parsed).toHaveProperty("skill");
  });
});

describe("MindAuditorEngine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-mind-auditor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(join(testDir, ".olt"), { recursive: true });
    mkdirSync(join(testDir, "olt", "agents"), { recursive: true });
    writeFileSync(join(testDir, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML, "utf-8");
    process.env["OLT_SKILL_HOME_REPO"] = testDir;
  });

  afterEach(() => {
    delete process.env["OLT_SKILL_HOME_REPO"];
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("auditMindPulse returns non-stagnant when idle duration is within threshold", () => {
    const now = "2026-08-24T12:02:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-within-threshold");
    mkdirSync(capsuleDir, { recursive: true });
    writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
      "utf-8",
    );
    writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:01:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
      "utf-8",
    );
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:01:00.000Z",
      lastInspectedEventIndex: 0,
    };

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      cursor,
      stagnationThresholdSeconds: 120,
      now,
      conversationId: "conv-123",
    });

    expect(result.stagnant).toBe(false);
    expect(result.idleDurationSeconds).toBe(60);
    expect(result.injectionPrompt).toBeUndefined();
    expect(result.defectCreated).toBeFalsy();
    expect(result.cursor.lastInspectedTimestamp).toBe(now);
    expect(result.cursor.lastAuditTimestamp).toBe(now);
  });

  test("auditMindPulse detects stagnation (Mode A: empty backlog) and synthesizes injection prompt", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-mode-a");
    mkdirSync(capsuleDir, { recursive: true });
    writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
      "utf-8",
    );
    writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
      "utf-8",
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
      conversationId: "conv-456",
    });

    expect(result.stagnant).toBe(true);
    expect(result.idleDurationSeconds).toBe(300);
    expect(result.defectCreated).toBe(true);
    expect(result.injectionPrompt).toBeDefined();
    expect(result.injectionPrompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
    expect(result.injectionPrompt).toContain(
      "CRITICAL SUPERVISORY ALERT: Live Stagnation Detected",
    );
    expect(result.telemetry.pendingBacklogCount).toBe(0);
    expect(result.telemetry.role).toBe("mind");

    // Verify cursor updated and saved
    const saved = AuditorCursorStore.loadCursor(testDir, "mind");
    expect(saved.lastInspectedTimestamp).toBe(now);
  });

  test("auditMindPulse detects stagnation (Mode B: pending backlog items)", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-mode-b");
    mkdirSync(capsuleDir, { recursive: true });
    writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
      "utf-8",
    );
    writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
      "utf-8",
    );

    const backlogPath = join(testDir, ".olt", "backlog.jsonl");
    const item1 = JSON.stringify({ id: "item-1", status: "PENDING", title: "Task 1" });
    const item2 = JSON.stringify({ id: "item-2", status: "COMPLETED", title: "Task 2" });
    const item3 = JSON.stringify({ id: "item-3", status: "READY", title: "Task 3" });
    writeFileSync(backlogPath, `${item1}\n${item2}\n${item3}\n`, "utf-8");

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
    });

    expect(result.stagnant).toBe(true);
    expect(result.telemetry.pendingBacklogCount).toBe(2); // item1 & item3
    expect(result.injectionPrompt).toBeDefined();
    expect(result.injectionPrompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
  });

  test("auditMindPulse counts unresolved defects from defects.jsonl", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
      lastInspectedEventIndex: 0,
    };

    const defectsPath = join(testDir, ".olt", "defects.jsonl");
    const d1 = JSON.stringify({ id: "d-1", error_code: "TEST_ERR_1" });
    const d2 = JSON.stringify({ id: "d-2", error_code: "TEST_ERR_2" });
    writeFileSync(defectsPath, `${d1}\n${d2}\n`, "utf-8");

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      cursor,
      stagnationThresholdSeconds: 120,
      now,
    });

    expect(result.telemetry.unresolvedDefectCount).toBe(2);
    expect(result.localDefectCount).toBe(0);
  });

  test("auditMindPulse reports localDefectCount distinctly when the mothership repo differs from repoRoot", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
      lastInspectedEventIndex: 0,
    };

    const mothershipDir = join(
      tmpdir(),
      `test-mind-auditor-mothership-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(join(mothershipDir, ".olt"), { recursive: true });
    process.env["OLT_SKILL_HOME_REPO"] = mothershipDir;

    const localDefectsPath = join(testDir, ".olt", "defects.jsonl");
    writeFileSync(localDefectsPath, `${JSON.stringify({ id: "local-1" })}\n`, "utf-8");

    const mothershipDefectsPath = join(mothershipDir, ".olt", "defects.jsonl");
    const m1 = JSON.stringify({ id: "mothership-1" });
    const m2 = JSON.stringify({ id: "mothership-2" });
    writeFileSync(mothershipDefectsPath, `${m1}\n${m2}\n`, "utf-8");

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      cursor,
      stagnationThresholdSeconds: 120,
      now,
    });

    expect(result.telemetry.unresolvedDefectCount).toBe(2);
    expect(result.localDefectCount).toBe(1);

    rmSync(mothershipDir, { recursive: true, force: true });
  });

  test("auditMindPulse inspects last_pulse.json in active capsule when cursor is absent and prevents false stagnation", () => {
    const now = "2026-08-24T12:01:00.000Z";
    // Create an active mind capsule with a pulse recorded 30s ago
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-1");
    mkdirSync(capsuleDir, { recursive: true });
    const pulseRecord = {
      at: "2026-08-24T12:00:30.000Z", // 30s ago (well within 120s threshold)
      pulse_id: "pulse-1",
      outcome: "active",
      next_wake_at: "2026-08-24T12:15:30.000Z",
    };
    writeFileSync(join(capsuleDir, "last_pulse.json"), JSON.stringify(pulseRecord), "utf-8");

    // Do NOT pass a cursor or pass default uninitialized cursor
    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
      conversationId: "conv-live-mind",
    });

    expect(result.stagnant).toBe(false);
    expect(result.idleDurationSeconds).toBe(30);
    expect(result.defectCreated).toBeFalsy();
    expect(result.injectionPrompt).toBeUndefined();
    expect(result.cursor.lastInspectedTimestamp).toBe(now);
  });

  test("auditMindPulse does not report stagnation or create a defect when no native Mind evidence exists", () => {
    const now = "2026-08-24T12:01:00.000Z";
    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
    });

    expect(result.stagnant).toBe(false);
    expect(result.idleDurationSeconds).toBe(121);
    expect(result.defectCreated).toBe(false);
    expect(result.injectionPrompt).toBeUndefined();
    expect(result.remediation).toBe("deploy_mind");
  });

  test("auditMindPulse inspects last_pulse.json via explicit capsuleRunRoot option", () => {
    const now = "2026-08-24T12:01:00.000Z";
    const customCapsuleDir = join(testDir, "custom-capsules", "run-special");
    mkdirSync(customCapsuleDir, { recursive: true });
    const pulseRecord = {
      at: "2026-08-24T12:00:45.000Z", // 15s ago
      pulse_id: "pulse-special",
      outcome: "active",
      next_wake_at: null,
    };
    writeFileSync(join(customCapsuleDir, "last_pulse.json"), JSON.stringify(pulseRecord), "utf-8");

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      capsuleRunRoot: customCapsuleDir,
      stagnationThresholdSeconds: 120,
      now,
    });

    expect(result.stagnant).toBe(false);
    expect(result.idleDurationSeconds).toBe(15);
  });

  test("resolveLatestPulseTimestamp finds the latest pulse across multiple capsules", () => {
    const cap1 = join(testDir, ".olt", "capsules", "mind-gen-1");
    const cap2 = join(testDir, ".olt", "capsules", "mind-gen-2");
    mkdirSync(cap1, { recursive: true });
    mkdirSync(cap2, { recursive: true });

    writeFileSync(
      join(cap1, "last_pulse.json"),
      JSON.stringify({ at: "2026-08-24T10:00:00.000Z" }),
      "utf-8",
    );
    writeFileSync(
      join(cap2, "last_pulse.json"),
      JSON.stringify({ at: "2026-08-24T11:00:00.000Z" }),
      "utf-8",
    );

    const latest = MindAuditorEngine.resolveLatestPulseTimestamp(testDir);
    expect(latest).toBe(new Date("2026-08-24T11:00:00.000Z").getTime());
  });
});

describe("SkillAuditorEngine", () => {
  let testDir: string;
  let runDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-skill-auditor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    runDir = join(testDir, "capsules", "run-1");
    mkdirSync(join(testDir, ".olt"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("auditSkillCompliance returns compliant when events stream has zero violations", () => {
    const eventsPath = join(runDir, "events.jsonl");
    const e1 = JSON.stringify({ kind: "tool-called", tool: "view_file", actor: "implementer-1" });
    const e2 = JSON.stringify({ kind: "tool-called", tool: "bun test", actor: "implementer-1" });
    writeFileSync(eventsPath, `${e1}\n${e2}\n`, "utf-8");

    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      capsuleRunRoot: runDir,
      now: "2026-08-24T12:00:00.000Z",
    });

    expect(result.compliant).toBe(true);
    expect(result.incidents.length).toBe(0);
    expect(result.defectsLogged).toBe(0);
    expect(result.eventsAnalyzed).toBe(2);
    expect(result.cursor.lastInspectedEventIndex).toBe(1);
  });

  test("auditSkillCompliance detects boundary violations, logs incidents and routes defects", () => {
    const eventsPath = join(runDir, "events.jsonl");
    const e0 = JSON.stringify({
      kind: "command-executed",
      sequence: 0,
      actor: "coordinator",
      payload: { tool: "view_file", arguments: { TargetFile: "src/foo.ts" } },
      timestamp: "2026-08-24T12:00:00.000Z",
    });
    const e1 = JSON.stringify({
      kind: "command-executed",
      sequence: 1,
      actor: "validator-1",
      payload: { tool: "write_to_file", arguments: { TargetFile: "forbidden/edit.ts" } },
      timestamp: "2026-08-24T12:00:01.000Z",
    });
    writeFileSync(eventsPath, `${e0}\n${e1}\n`, "utf-8");

    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      capsuleRunRoot: runDir,
      logDefects: true,
      now: "2026-08-24T12:00:00.000Z",
    });

    expect(result.compliant).toBe(false);
    expect(result.incidents.length).toBe(1);
    const firstIncident = result.incidents[0];
    expect(firstIncident?.category).toBe("ROLE_BOUNDARY_DEVIATION");
    expect(firstIncident?.severity).toBe("HIGH");
    expect(firstIncident?.description).toContain("Validator agent `validator-1`");
    expect(result.defectsLogged).toBe(1);
    expect(result.eventsAnalyzed).toBe(2);
    expect(result.cursor.lastInspectedEventIndex).toBe(1);

    const saved = AuditorCursorStore.loadCursor(testDir, "skill", runDir);
    expect(saved.lastInspectedEventIndex).toBe(1);
  });

  test("auditSkillCompliance inspects only delta events on subsequent runs using cursor", () => {
    const eventsPath = join(runDir, "events.jsonl");
    const e0 = JSON.stringify({
      kind: "command-executed",
      sequence: 0,
      actor: "implementer-1",
      payload: { tool: "view_file", arguments: { TargetFile: "src/a.ts" } },
      timestamp: "2026-08-24T12:00:00.000Z",
    });
    const e1 = JSON.stringify({
      kind: "command-executed",
      sequence: 1,
      actor: "implementer-1",
      payload: { tool: "list_dir", arguments: {} },
      timestamp: "2026-08-24T12:00:01.000Z",
    });
    writeFileSync(eventsPath, `${e0}\n${e1}\n`, "utf-8");

    const res1 = SkillAuditorEngine.auditSkillCompliance(testDir, {
      capsuleRunRoot: runDir,
    });
    expect(res1.eventsAnalyzed).toBe(2);
    expect(res1.cursor.lastInspectedEventIndex).toBe(1);

    const e2 = JSON.stringify({
      kind: "command-executed",
      sequence: 2,
      actor: "implementer-1",
      payload: { tool: "read_resource", arguments: {} },
      timestamp: "2026-08-24T12:00:02.000Z",
    });
    const e3 = JSON.stringify({
      kind: "command-executed",
      sequence: 3,
      actor: "validator-1",
      payload: { tool: "write_to_file", arguments: { TargetFile: "forbidden/edit.ts" } },
      timestamp: "2026-08-24T12:00:03.000Z",
    });
    writeFileSync(eventsPath, `${e0}\n${e1}\n${e2}\n${e3}\n`, "utf-8");

    const res2 = SkillAuditorEngine.auditSkillCompliance(testDir, {
      capsuleRunRoot: runDir,
    });
    expect(res2.eventsAnalyzed).toBe(2);
    expect(res2.incidents.length).toBe(1);
    expect(res2.cursor.lastInspectedEventIndex).toBe(3);
  });

  test("auditSkillCompliance respects logDefects: false flag", () => {
    const eventsPath = join(runDir, "events.jsonl");
    const e0 = JSON.stringify({
      kind: "command-executed",
      sequence: 0,
      actor: "validator-1",
      payload: { tool: "write_to_file", arguments: { TargetFile: "forbidden/edit.ts" } },
      timestamp: "2026-08-24T12:00:00.000Z",
    });
    writeFileSync(eventsPath, `${e0}\n`, "utf-8");

    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      capsuleRunRoot: runDir,
      logDefects: false,
    });

    expect(result.compliant).toBe(false);
    expect(result.incidents.length).toBe(1);
    expect(result.defectsLogged).toBe(0);
  });
});
