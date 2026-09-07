import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

const MIN_MANIFEST_YAML = `role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\nmust_not:\n  - Implement code directly\n`;

describe("MindAuditorEngine in-memory virtual suite", () => {
  let testDir: string;
  let mothershipDir: string;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("mind-auditor", "test");
    mothershipDir = scratchRoot("mind-auditor", "mothership");

    vfs.mkdirSync(join(testDir, ".olt", "capsules"), { recursive: true });
    vfs.mkdirSync(join(testDir, "olt", "agents"), { recursive: true });
    vfs.writeFileSync(join(testDir, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML);
    process.env["OLT_SKILL_HOME_REPO"] = testDir;
  });

  afterEach(() => {
    delete process.env["OLT_SKILL_HOME_REPO"];
    cleanupVirtualMindFS();
  });

  test("auditMindPulse returns non-stagnant when idle duration is within threshold", () => {
    const now = "2026-08-24T12:02:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-within-threshold");
    vfs.mkdirSync(capsuleDir, { recursive: true });
    vfs.writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    vfs.writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:01:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
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
    expect(result.cursor.lastInspectedTimestamp).toBe(now);
  });

  test("auditMindPulse detects stagnation (Mode A: empty backlog) and synthesizes injection prompt", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-mode-a");
    vfs.mkdirSync(capsuleDir, { recursive: true });
    vfs.writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    vfs.writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
      conversationId: "conv-456",
    });

    expect(result.stagnant).toBe(true);
    expect(result.idleDurationSeconds).toBe(300);
    expect(result.defectCreated).toBe(true);
    expect(result.injectionPrompt).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");
    expect(result.telemetry.pendingBacklogCount).toBe(0);

    const saved = AuditorCursorStore.loadCursor(testDir, "mind");
    expect(saved.lastInspectedTimestamp).toBe(now);
  });

  test("auditMindPulse detects stagnation (Mode B: pending backlog items)", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-mode-b");
    vfs.mkdirSync(capsuleDir, { recursive: true });
    vfs.writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    vfs.writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
    );

    const backlogPath = join(testDir, ".olt", "backlog.jsonl");
    vfs.writeFileSync(
      backlogPath,
      `${JSON.stringify({ id: "i1", status: "PENDING" })}\n${JSON.stringify({ id: "i2", status: "COMPLETED" })}\n${JSON.stringify({ id: "i3", status: "READY" })}\n`,
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
    });
    expect(result.stagnant).toBe(true);
    expect(result.telemetry.pendingBacklogCount).toBe(2);
    expect(result.injectionPrompt).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");
  });

  test("auditMindPulse counts unresolved defects from defects.jsonl", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
      lastInspectedEventIndex: 0,
    };
    const defectsPath = join(testDir, ".olt", "defects.jsonl");
    vfs.writeFileSync(
      defectsPath,
      `${JSON.stringify({ id: "d1", error_code: "E1" })}\n${JSON.stringify({ id: "d2", error_code: "E2" })}\n`,
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      cursor,
      stagnationThresholdSeconds: 120,
      now,
    });
    expect(result.telemetry.unresolvedDefectCount).toBe(2);
    expect(result.localDefectCount).toBe(0);
  });

  test("auditMindPulse reports localDefectCount distinctly when mothership differs", () => {
    const now = "2026-08-24T12:05:00.000Z";
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
      lastInspectedEventIndex: 0,
    };

    vfs.mkdirSync(join(mothershipDir, ".olt"), { recursive: true });
    process.env["OLT_SKILL_HOME_REPO"] = mothershipDir;

    vfs.writeFileSync(
      join(testDir, ".olt", "defects.jsonl"),
      `${JSON.stringify({ id: "local-1" })}\n`,
    );
    vfs.writeFileSync(
      join(mothershipDir, ".olt", "defects.jsonl"),
      `${JSON.stringify({ id: "m1" })}\n${JSON.stringify({ id: "m2" })}\n`,
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      cursor,
      stagnationThresholdSeconds: 120,
      now,
    });
    expect(result.telemetry.unresolvedDefectCount).toBe(2);
    expect(result.localDefectCount).toBe(1);
  });

  test("auditMindPulse inspects last_pulse.json in active capsule when cursor is absent and prevents false stagnation", () => {
    const now = "2026-08-24T12:01:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-1");
    vfs.mkdirSync(capsuleDir, { recursive: true });
    vfs.writeFileSync(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    vfs.writeFileSync(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:30.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: "2026-08-24T12:15:30.000Z",
      }),
    );

    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
      conversationId: "conv-live-mind",
    });
    expect(result.stagnant).toBe(false);
    expect(result.idleDurationSeconds).toBe(30);
    expect(result.cursor.lastInspectedTimestamp).toBe(now);
  });

  test("auditMindPulse does not report stagnation or create a defect when no native Mind evidence exists", () => {
    const now = "2026-08-24T12:01:00.000Z";
    const result = MindAuditorEngine.auditMindPulse(testDir, {
      stagnationThresholdSeconds: 120,
      now,
    });
    expect(result.stagnant).toBe(false);
    expect(result.defectCreated).toBe(false);
    expect(result.remediation).toBe("deploy_mind");
  });
});
