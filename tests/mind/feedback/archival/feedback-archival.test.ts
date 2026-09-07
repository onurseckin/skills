import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  readArchivedObjectives,
  validateArchivedObjectiveRecord,
} from "../../../../olt/scripts/src/mind/archival/generational.ts";
import {
  appendArchivedObjectives,
  appendArchivedObjectivesCopies,
} from "../../../../olt/scripts/src/mind/archival/reader.ts";
import type { ArchivedObjectiveRecord } from "../../../../olt/scripts/src/mind/archival/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Archival Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/archival";
  const archivePath = `${testDir}/objectives.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  function makeRecord(
    id: string,
    overrides: Partial<ArchivedObjectiveRecord> = {},
  ): ArchivedObjectiveRecord {
    return {
      id,
      type: "objective",
      statement: `Statement for ${id}`,
      generation: 1,
      completed_at: "2026-09-01T10:00:00.000Z",
      result: "completed",
      ...overrides,
    };
  }

  describe("Schema Validation (validateArchivedObjectiveRecord)", () => {
    it("validates version 2 objective record successfully", () => {
      const raw = {
        id: "arch-v2-01",
        schema_version: 2,
        type: "candidate",
        statement: "Improve memory compaction",
        generation: 3,
        completed_at: "2026-09-01T12:00:00.000Z",
        result: "converged",
        candidate_id: "cand-99",
      };

      const record = validateArchivedObjectiveRecord(raw);
      expect(record.id).toBe("arch-v2-01");
      expect(record.type).toBe("candidate");
      expect(record.generation).toBe(3);
      expect(record.candidate_id).toBe("cand-99");
    });

    it("normalizes legacy version 1 schema attributes cleanly", () => {
      const legacyRaw = {
        id: "arch-v1-legacy",
        schema_version: 1,
        title: "Legacy Title",
        generation_id: 2,
        closed_at: "2026-08-30T10:00:00.000Z",
        status: "resolved",
      };

      const record = validateArchivedObjectiveRecord(legacyRaw);
      expect(record.id).toBe("arch-v1-legacy");
      expect(record.statement).toBe("Legacy Title");
      expect(record.generation).toBe(2);
      expect(record.completed_at).toBe("2026-08-30T10:00:00.000Z");
      expect(record.result).toBe("resolved");
    });

    it("rejects non-object records and missing id with INVALID_ARGUMENT", () => {
      expect(() => validateArchivedObjectiveRecord(null)).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord("string")).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord({ id: "" })).toThrow(HarnessError);
    });

    it("rejects invalid type, missing statement, and negative generation", () => {
      expect(() =>
        validateArchivedObjectiveRecord({
          id: "rec-bad-type",
          type: "unsupported_type",
          statement: "Some statement",
          generation: 1,
          completed_at: "2026-09-01T10:00:00.000Z",
          result: "completed",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        validateArchivedObjectiveRecord({
          id: "rec-bad-gen",
          type: "objective",
          statement: "Some statement",
          generation: Number.NaN,
          completed_at: "2026-09-01T10:00:00.000Z",
          result: "completed",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        validateArchivedObjectiveRecord({
          id: "rec-empty-stmt",
          type: "objective",
          statement: "",
          generation: 1,
          completed_at: "2026-09-01T10:00:00.000Z",
          result: "completed",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Storage, Deduplication & Atomic Appends", () => {
    it("appends records and reads them back cleanly from virtual filesystem", () => {
      const records = [makeRecord("arch-1"), makeRecord("arch-2")];

      const appended = appendArchivedObjectives(records, archivePath);
      expect(appended.length).toBe(2);

      const readBack = readArchivedObjectives(archivePath);
      expect(readBack.length).toBe(2);
      expect(readBack.map((r) => r.id)).toEqual(["arch-1", "arch-2"]);
    });

    it("deduplicates records by ID, updating existing entries in place", () => {
      appendArchivedObjectives([makeRecord("arch-dup", { statement: "Initial" })], archivePath);

      appendArchivedObjectives(
        [makeRecord("arch-dup", { statement: "Updated statement" }), makeRecord("arch-new")],
        archivePath,
      );

      const all = readArchivedObjectives(archivePath);
      expect(all.length).toBe(2);
      const updated = all.find((r) => r.id === "arch-dup");
      expect(updated?.statement).toBe("Updated statement");
    });

    it("handles empty record array cleanly without modifying existing storage", () => {
      appendArchivedObjectives([makeRecord("arch-keep")], archivePath);

      const result = appendArchivedObjectives([], archivePath);
      expect(result.length).toBe(1);

      const current = readArchivedObjectives(archivePath);
      expect(current.length).toBe(1);
      expect(current[0]?.id).toBe("arch-keep");
    });

    it("mirrors records across multiple archive paths via appendArchivedObjectivesCopies", () => {
      const copyPathA = `${testDir}/copy-A.jsonl`;
      const copyPathB = `${testDir}/copy-B.jsonl`;

      appendArchivedObjectivesCopies([makeRecord("arch-mirrored")], [copyPathA, copyPathB]);

      expect(readArchivedObjectives(copyPathA).length).toBe(1);
      expect(readArchivedObjectives(copyPathB).length).toBe(1);
    });
  });
});
