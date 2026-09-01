import { describe, expect, it, spyOn, afterEach, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  __setArchivedObjectivesPersistenceTestHook,
  type ArchivedObjectiveRecord,
} from "../../../olt/scripts/src/mind/archival/types.ts";
import {
  withArchivedObjectivesTransaction,
  writeArchivedObjectives,
} from "../../../olt/scripts/src/mind/archival/compactor.ts";
import { MemoryFSState, installMemoryFSSpies } from "./in-memory-fs.ts";

const rec1: ArchivedObjectiveRecord = {
  id: "arch-1",
  type: "objective",
  statement: "Completed goal A",
  generation: 1,
  completed_at: "2026-09-01T10:00:00.000Z",
  result: "achieved",
};

const rec2: ArchivedObjectiveRecord = {
  id: "arch-2",
  type: "task",
  statement: "Completed task B",
  generation: 1,
  completed_at: "2026-09-01T11:00:00.000Z",
  result: "passed",
};

describe("Mind Archival Compactor Suite", () => {
  const mem = new MemoryFSState();
  let spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    mem.reset();
    mem.addDir("/");
    mem.addDir("/virtual");
    mem.addDir("/virtual/test-root");
    mem.addDir("/virtual/test-root/capsules");
    const installed = installMemoryFSSpies(mem);
    spies = installed.spies;
    __setArchivedObjectivesPersistenceTestHook(undefined);
  });

  afterEach(() => {
    __setArchivedObjectivesPersistenceTestHook(undefined);
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    mem.reset();
  });

  describe("writeArchivedObjectives and withArchivedObjectivesTransaction", () => {
    it("atomically writes records and reads back snapshot in transaction", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1, rec2], targetPath);

      const file = mem.files.get(targetPath);
      expect(file).toBeDefined();
      expect(file?.content.toString("utf8")).toContain("arch-1");
      expect(file?.content.toString("utf8")).toContain("arch-2");

      const result = withArchivedObjectivesTransaction(targetPath, (items) => {
        expect(items).toHaveLength(2);
        expect(items[0]?.id).toBe("arch-1");
        return { items: [items[0]!], result: "pruned-success" };
      });

      expect(result).toBe("pruned-success");
      const updated = mem.files.get(targetPath);
      expect(updated?.content.toString("utf8")).toContain("arch-1");
      expect(updated?.content.toString("utf8")).not.toContain("arch-2");
    });

    it("handles auto-creating parent directory if it does not exist initially", () => {
      const targetPath = "/virtual/test-root/newdir/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);
      expect(mem.files.has("/virtual/test-root/newdir")).toBe(true);
      expect(mem.files.has(targetPath)).toBe(true);
    });

    it("rejects write when duplicate record IDs are provided", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      expect(() => writeArchivedObjectives([rec1, { ...rec1 }], targetPath)).toThrow(HarnessError);
    });

    it("cleans up locks and rethrows primary error when mutation fails", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);

      expect(() =>
        withArchivedObjectivesTransaction(targetPath, () => {
          throw new Error("Mutation computation failed");
        }),
      ).toThrow("Mutation computation failed");
    });
  });

  describe("Persistence hooks and transactional safety", () => {
    it("invokes all persistence hooks in order during successful atomic write", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      const stages: string[] = [];
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        stages.push(stage);
      });

      writeArchivedObjectives([rec1], targetPath);
      expect(stages).toEqual([
        "before_write",
        "before_file_fsync",
        "before_rename",
        "after_rename",
        "before_directory_fsync",
      ]);
    });

    it("rolls back and cleans up temp file when failure occurs before rename", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_rename") throw new Error("Fsync barrier simulated failure");
      });

      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(HarnessError);
      expect([...mem.files.keys()].filter((k) => k.includes(".tmp"))).toHaveLength(0);
      expect(mem.files.has(targetPath)).toBe(false);
    });

    it("detects uncertain outcome when error occurs after rename", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "after_rename")
          throw new Error("Post-rename directory fsync simulated failure");
      });

      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /archived objectives ledger mutation outcome is uncertain/,
      );
    });

    it("wraps non-HarnessError into INTEGRITY HarnessError on failure before rename", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.onOpen = (p) => {
        if (p.includes(".tmp")) throw new TypeError("Low-level OS buffer fault");
      };
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /archived objectives ledger mutation failed: Low-level OS buffer fault/,
      );
    });
  });

  describe("Directory stability and integrity verifications", () => {
    it("throws HarnessError INTEGRITY when directory identity changes during traversal", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.onFstat = (_fd, _desc, file) => (file.isDir ? { ino: file.ino + 9999 } : undefined);
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /directory changed while being opened/,
      );
    });

    it("throws HarnessError INTEGRITY when directory device ID changes during traversal", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.onFstat = (_fd, _desc, file) => (file.isDir ? { dev: file.dev + 999 } : undefined);
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /directory changed while being opened/,
      );
    });

    it("throws HarnessError INTEGRITY when opened descriptor is not a directory", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.onFstat = (_fd, _desc, file) => (file.isDir ? { isDirectory: () => false } : undefined);
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /directory changed while being opened/,
      );
    });

    it("throws HarnessError PATH_SAFETY when a path component is not a directory", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.addFile("/virtual/test-root/capsules", "not-a-dir");
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(/is not a directory/);
    });

    it("throws HarnessError PATH_SAFETY when generic error occurs during directory chain open", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.onOpen = (p) => {
        if (p === "/virtual/test-root/capsules")
          throw new Error("EACCES: permission denied on directory");
      };
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /cannot be securely traversed/,
      );
    });

    it("handles close descriptor cleanup failure when closing directory chain", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      mem.throwOnClose = true;
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /Simulated closeSync failure/,
      );
    });
  });

  describe("Ledger replacement and write verification", () => {
    it("throws HarnessError INTEGRITY if ledger changed before replacement", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_file_fsync") {
          const file = mem.files.get(targetPath);
          if (file) file.ino = file.ino + 555;
        }
      });
      expect(() => writeArchivedObjectives([rec1, rec2], targetPath)).toThrow(
        /archived objectives ledger changed before replacement/,
      );
    });

    it("throws HarnessError INTEGRITY if ledger device changed before replacement", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_file_fsync") {
          const file = mem.files.get(targetPath);
          if (file) file.dev = file.dev + 777;
        }
      });
      expect(() => writeArchivedObjectives([rec1, rec2], targetPath)).toThrow(
        /archived objectives ledger changed before replacement/,
      );
    });

    it("throws HarnessError INTEGRITY if ledger has multiple hardlinks before replacement", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_file_fsync") {
          const file = mem.files.get(targetPath);
          if (file) file.nlink = 2;
        }
      });
      expect(() => writeArchivedObjectives([rec1, rec2], targetPath)).toThrow(
        /archived objectives ledger changed before replacement/,
      );
    });

    it("throws HarnessError INTEGRITY if ledger becomes directory before replacement", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      writeArchivedObjectives([rec1], targetPath);
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_file_fsync") {
          const file = mem.files.get(targetPath);
          if (file) file.isDir = true;
        }
      });
      expect(() => writeArchivedObjectives([rec1, rec2], targetPath)).toThrow(
        /archived objectives ledger changed before replacement/,
      );
    });

    it("throws error if pre-replacement stat fails with non-ENOENT error on new ledger", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      __setArchivedObjectivesPersistenceTestHook((stage) => {
        if (stage === "before_file_fsync") {
          mem.onLstat = (p) => {
            if (p === targetPath)
              throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
            return undefined;
          };
        }
      });
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(/EPERM/);
    });

    it("throws HarnessError INTEGRITY if writeSync returns zero bytes", () => {
      const targetPath = "/virtual/test-root/capsules/ARCHIVED_OBJECTIVES.jsonl";
      spies.push(spyOn(fs, "writeSync").mockReturnValue(0));
      expect(() => writeArchivedObjectives([rec1], targetPath)).toThrow(
        /could not write archived objectives ledger/,
      );
    });

    it("handles safeRealpath fallback when both directory and its parent do not exist", () => {
      spies.push(spyOn(fs, "mkdirSync").mockImplementation(() => ""));
      const nonExistentDeep = "/missing-a/missing-b/missing-c/ARCHIVED_OBJECTIVES.jsonl";
      expect(() => writeArchivedObjectives([rec1], nonExistentDeep)).toThrow(
        /cannot be securely traversed/,
      );
    });
  });
});
