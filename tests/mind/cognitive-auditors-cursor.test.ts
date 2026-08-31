import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuditorCursorStore,
  MindAuditorEngine,
  SkillAuditorEngine,
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
