import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  CognitiveChallengePromptGenerator,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

const MIN_MANIFEST_YAML = `role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\nmust_not:\n  - Implement code directly\n`;

const origExists = fs.existsSync;
const origReaddir = fs.readdirSync;
const origRead = fs.readFileSync;

describe("MindAuditorEngine in-memory virtual suite", () => {
  const testDir = `${process.cwd()}/.olt/virtual-test-mind-auditor`;
  const mothershipDir = `${process.cwd()}/.olt/virtual-test-mothership`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testDir);
    mockDirs.add(join(testDir, ".olt"));
    mockDirs.add(join(testDir, ".olt", "capsules"));
    mockDirs.add(join(testDir, "olt", "agents"));
    mockFiles.set(join(testDir, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML);
    process.env["OLT_SKILL_HOME_REPO"] = testDir;

    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return mockFiles.has(s) || mockDirs.has(s) || origExists(p);
    });

    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, options?: unknown) => {
      const pathStr = String(p);
      if (!pathStr.startsWith(testDir) && !pathStr.startsWith(mothershipDir)) {
        try {
          return origReaddir(
            p as string,
            options as { withFileTypes?: boolean },
          ) as unknown as fs.Dirent[];
        } catch {
          return [] as unknown as fs.Dirent[];
        }
      }
      const dirNames: string[] = [];
      for (const dir of mockDirs) {
        if (dir.startsWith(pathStr) && dir !== pathStr) {
          const top = dir.slice(pathStr.length).replace(/^\/+/, "").split("/")[0];
          if (top && !dirNames.includes(top)) dirNames.push(top);
        }
      }
      const fileNames: string[] = [];
      for (const file of mockFiles.keys()) {
        if (file.startsWith(pathStr)) {
          const top = file.slice(pathStr.length).replace(/^\/+/, "").split("/")[0];
          if (top && !dirNames.includes(top) && !fileNames.includes(top)) fileNames.push(top);
        }
      }
      const withFileTypes =
        typeof options === "object" &&
        options !== null &&
        Boolean((options as { withFileTypes?: boolean }).withFileTypes);
      if (withFileTypes) {
        return [
          ...dirNames.map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
          ...fileNames.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
        ] as unknown as fs.Dirent[];
      }
      return [...dirNames, ...fileNames] as unknown as fs.Dirent[];
    });

    spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const s = String(p);
      const val = mockFiles.get(s);
      if (val !== undefined) return val;
      return origRead(p as string, "utf-8");
    });

    spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      mockFiles.set(
        String(p),
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
      );
    });

    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    });

    spyOn(durableWriteModule, "durableAppendBytes").mockImplementation((filePath, bytes) => {
      const prev = mockFiles.get(filePath) ?? "";
      mockFiles.set(filePath, prev + new TextDecoder().decode(bytes));
    });
  });

  afterEach(() => {
    delete process.env["OLT_SKILL_HOME_REPO"];
  });

  test("auditMindPulse returns non-stagnant when idle duration is within threshold", () => {
    const now = "2026-08-24T12:02:00.000Z";
    const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-within-threshold");
    mockDirs.add(capsuleDir);
    mockFiles.set(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    mockFiles.set(
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
    mockDirs.add(capsuleDir);
    mockFiles.set(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    mockFiles.set(
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
    mockDirs.add(capsuleDir);
    mockFiles.set(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    mockFiles.set(
      join(capsuleDir, "last_pulse.json"),
      JSON.stringify({
        at: "2026-08-24T12:00:00.000Z",
        pulse_id: "pulse-1",
        outcome: "active",
        next_wake_at: null,
      }),
    );

    const backlogPath = join(testDir, ".olt", "backlog.jsonl");
    mockFiles.set(
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
    mockFiles.set(
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

    mockDirs.add(mothershipDir);
    mockDirs.add(join(mothershipDir, ".olt"));
    process.env["OLT_SKILL_HOME_REPO"] = mothershipDir;

    mockFiles.set(join(testDir, ".olt", "defects.jsonl"), `${JSON.stringify({ id: "local-1" })}\n`);
    mockFiles.set(
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
    mockDirs.add(capsuleDir);
    mockFiles.set(
      join(capsuleDir, "state.json"),
      JSON.stringify({ agents: [{ id: "mind-1", role: "mind", status: "active" }] }),
    );
    mockFiles.set(
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
