import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("SkillAuditorEngine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-skill-auditor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(join(testDir, ".olt"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("auditSkillCompliance passes on clean repository without incidents", () => {
    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
      lastInspectedEventIndex: -1,
      lastAuditTimestamp: "1970-01-01T00:00:00.000Z",
    };

    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      cursor,
    });

    expect(result.incidents.length).toBe(0);
    expect(result.defectsLogged).toBe(0);
    expect(result.compliant).toBe(true);
  });

  test("auditSkillCompliance scans capsule events and updates cursor", () => {
    const eventsDir = join(testDir, ".olt", "capsules", "run-1");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(eventsDir, "events.jsonl"), "", "utf-8");

    const cursor: AuditorCursor = {
      lastInspectedTimestamp: "1970-01-01T00:00:00.000Z",
      lastInspectedEventIndex: -1,
      lastAuditTimestamp: "1970-01-01T00:00:00.000Z",
    };

    const now = "2026-08-24T12:00:00.000Z";
    const result = SkillAuditorEngine.auditSkillCompliance(testDir, {
      cursor,
      capsuleRunRoot: eventsDir,
      now,
    });

    expect(result.cursor.lastInspectedTimestamp).toBe(now);
  });
});
