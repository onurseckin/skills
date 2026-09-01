import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  AuditorCursorStore,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("AuditorCursorStore in-memory virtual suite", () => {
  const testDir = `${process.cwd()}/.olt/virtual-test-cursor`;
  const mockFiles = new Map<string, string>();

  beforeEach(() => {
    mockFiles.clear();

    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return mockFiles.has(pathStr) || pathStr.endsWith(".olt");
    });

    spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = String(p);
      const val = mockFiles.get(pathStr);
      if (val === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
      }
      return val;
    });

    spyOn(fs, "writeFileSync").mockImplementation(
      (p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
        const pathStr = String(p);
        mockFiles.set(
          pathStr,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      },
    );

    spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
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
    mockFiles.set(p, "{ this is not valid json }");

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

    const cursorPath = AuditorCursorStore.resolveCursorPath(testDir);
    const raw = mockFiles.get(cursorPath) ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("mind");
    expect(parsed).toHaveProperty("skill");
  });
});
