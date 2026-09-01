import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  SkillAuditorEngine,
  type AuditorCursor,
} from "../../../../olt/scripts/src/mind/auditing/cognitive/index.ts";

describe("SkillAuditorEngine in-memory virtual suite", () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("skill-auditor", "test");
    fs.mkdirSync(join(testDir, ".olt", "capsules"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
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
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(join(eventsDir, "events.jsonl"), "");

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
