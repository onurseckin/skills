import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  CognitiveChallengePromptGenerator,
  type AuditorCursor,
} from "../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

const MIN_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
must_not:
  - Implement code directly
`;

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
    expect(result.cognitiveChallengePrompt).toBeDefined();
    expect(CognitiveChallengePromptGenerator.generateZeroDeltaChallengePrompt).toBeDefined();
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
});
