import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  acquireArchivedObjectivesFlock,
  assertUniqueArchivedObjectives,
  parseArchivedObjectives,
  readArchivedObjectives,
  readArchivedObjectivesFile,
  validateArchivedObjectiveRecord,
} from "../../../../olt/scripts/src/mind/archival/generational.ts";
import type { ArchivedObjectiveRecord } from "../../../../olt/scripts/src/mind/archival/types.ts";

describe("Generational Archival Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gen-cov-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates current schema_version 2 and legacy schema_version 1 records", () => {
    const validCurrent = {
      id: "obj-1",
      type: "objective",
      statement: "Goal statement",
      generation: 2,
      completed_at: "2026-09-01T00:00:00Z",
      result: "passed",
      candidate_id: "c-1",
      objective_id: "o-1",
      task_id: "t-1",
      write_scope: ["src/"],
      charter_goals: ["G1"],
      details: { note: "verified" },
      metadata: { env: "test" },
    };
    const validated = validateArchivedObjectiveRecord(validCurrent);
    expect(validated.id).toBe("obj-1");
    expect(validated.candidate_id).toBe("c-1");

    const validLegacy = {
      schema_version: 1,
      id: "leg-1",
      type: "unknown-type",
      title: "Legacy title",
      generation_id: 1,
      closed_at: "2026-08-30T00:00:00Z",
      status: "completed",
      charter_goal_ids: ["G0"],
      candidate_id: null,
      objective_id: null,
      task_id: null,
    };
    const legacyValidated = validateArchivedObjectiveRecord(validLegacy);
    expect(legacyValidated.type).toBe("objective");
    expect(legacyValidated.statement).toBe("Legacy title");
    expect(legacyValidated.generation).toBe(1);
    expect(legacyValidated.completed_at).toBe("2026-08-30T00:00:00Z");
    expect(legacyValidated.result).toBe("completed");
    expect(legacyValidated.charter_goals).toEqual(["G0"]);
    expect(legacyValidated.candidate_id).toBeNull();
  });

  it("throws HarnessError on invalid record structures and unsupported versions", () => {
    expect(() => validateArchivedObjectiveRecord(null)).toThrow(HarnessError);
    expect(() => validateArchivedObjectiveRecord([])).toThrow(HarnessError);
    expect(() => validateArchivedObjectiveRecord({ id: "" })).toThrow(HarnessError);
    expect(() => validateArchivedObjectiveRecord({ id: "1", schema_version: 3 })).toThrow(
      HarnessError,
    );
    expect(() =>
      validateArchivedObjectiveRecord({ id: "1", type: "invalid-type", statement: "x" }),
    ).toThrow(HarnessError);
    expect(() =>
      validateArchivedObjectiveRecord({
        id: "1",
        type: "objective",
        statement: "x",
        generation: Number.NaN,
      }),
    ).toThrow(HarnessError);
    expect(() =>
      validateArchivedObjectiveRecord({
        schema_version: 1,
        id: "leg-bad",
        title: "",
      }),
    ).toThrow(HarnessError);
  });

  it("parses valid JSONL and rejects duplicate ids or malformed lines", () => {
    const validJsonl = `
      {"id":"o-1","type":"objective","statement":"st1","generation":1,"completed_at":"2026-09-01","result":"done"}
      {"id":"o-2","type":"candidate","statement":"st2","generation":1,"completed_at":"2026-09-01","result":"done"}
    `;
    const parsed = parseArchivedObjectives(validJsonl);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.id).toBe("o-1");
    expect(parsed[1]?.id).toBe("o-2");

    const duplicateJsonl = `
      {"id":"dup-1","type":"objective","statement":"st1","generation":1,"completed_at":"2026-09-01","result":"done"}
      {"id":"dup-1","type":"objective","statement":"st2","generation":1,"completed_at":"2026-09-01","result":"done"}
    `;
    expect(() => parseArchivedObjectives(duplicateJsonl)).toThrow(HarnessError);

    const malformedJsonl = `not a valid json`;
    expect(() => parseArchivedObjectives(malformedJsonl)).toThrow(HarnessError);
  });

  it("asserts uniqueness across archived objective collections", () => {
    const rec1: ArchivedObjectiveRecord = {
      id: "rec-1",
      type: "objective",
      statement: "s1",
      generation: 1,
      completed_at: "2026-09-01",
      result: "done",
    };
    const rec2: ArchivedObjectiveRecord = { ...rec1, id: "rec-2" };

    const canonical = assertUniqueArchivedObjectives([rec1, rec2]);
    expect(canonical.length).toBe(2);

    expect(() => assertUniqueArchivedObjectives([rec1, rec1])).toThrow(HarnessError);
  });

  it("safely reads files, handles ENOENT, and throws on directories", () => {
    const missing = readArchivedObjectivesFile(join(tempDir, "missing.jsonl"));
    expect(missing.raw).toBe("");

    const targetFile = join(tempDir, "ledger.jsonl");
    const sampleRecord = JSON.stringify({
      id: "read-1",
      type: "task",
      statement: "task statement",
      generation: 1,
      completed_at: "2026-09-01",
      result: "ok",
    });
    writeFileSync(targetFile, `${sampleRecord}\n`);

    const snapshot = readArchivedObjectivesFile(targetFile);
    expect(snapshot.raw).toContain("read-1");
    expect(snapshot.identity?.dev).toBeDefined();

    const objectives = readArchivedObjectives(targetFile);
    expect(objectives.length).toBe(1);
    expect(objectives[0]?.id).toBe("read-1");

    const subDir = join(tempDir, "dir-not-file");
    mkdirSync(subDir);
    expect(() => readArchivedObjectivesFile(subDir)).toThrow(HarnessError);
  });

  it("acquires exclusive file flock successfully", () => {
    const lockFile = join(tempDir, "test.lock");
    writeFileSync(lockFile, "lock");
    const fd = openSync(lockFile, "r+");
    try {
      expect(() => acquireArchivedObjectivesFlock(fd, "test-lock")).not.toThrow();
    } finally {
      closeSync(fd);
    }
  });
});
