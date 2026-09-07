import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  appendDefectLedgerRecord,
  __setDefectPromotionPersistenceTestHook,
  promoteDefectLedgerRecords,
  recoverDefectPromotion,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupLoggingSandboxes,
  cleanupVirtualLoggingFS,
  createLoggingSandbox,
  setupVirtualLoggingFS,
} from "../fixtures/index.ts";

let vfs: ReturnType<typeof setupVirtualLoggingFS>;

beforeEach(() => {
  vfs = setupVirtualLoggingFS();
});

afterEach(() => {
  __setDefectPromotionPersistenceTestHook(undefined);
  cleanupLoggingSandboxes();
  cleanupVirtualLoggingFS();
});

describe("Logging subsystem: Durable Defect Promotion & Recovery", () => {
  test("recovers every durable promotion stage exactly once", () => {
    const stages = ["PREPARED", "TARGET_DURABLE", "SOURCE_DURABLE", "COMMITTED"] as const;
    for (const stage of stages) {
      const dir = createLoggingSandbox();
      const sourcePath = join(dir, `active-${stage}.jsonl`);
      const targetPath = join(dir, `completed-${stage}.jsonl`);
      vfs.writeFileSync(sourcePath, '{"id":"recover-me","unknown":{"kept":true}}\n', "utf8");
      __setDefectPromotionPersistenceTestHook((observed) => {
        if (observed === stage) throw new Error(`crash-${stage}`);
      });
      expect(() => promoteDefectLedgerRecords(sourcePath, targetPath, ["recover-me"])).toThrow(
        `crash-${stage}`,
      );
      __setDefectPromotionPersistenceTestHook(undefined);
      recoverDefectPromotion(sourcePath, targetPath);
      recoverDefectPromotion(sourcePath, targetPath);
      const source = vfs.existsSync(sourcePath) ? vfs.readFileSync(sourcePath, "utf8") : "";
      const target = vfs.existsSync(targetPath) ? vfs.readFileSync(targetPath, "utf8") : "";
      if (stage === "PREPARED") {
        expect(source).toBe('{"id":"recover-me","unknown":{"kept":true}}\n');
        expect(target).toBe("");
      } else {
        expect(source).toBe("");
        expect(target).toBe('{"id":"recover-me","unknown":{"kept":true}}\n');
      }
    }
  });

  test("refuses a promotion journal with invalid hashes or IDs without erasing evidence", () => {
    const dir = createLoggingSandbox();
    const sourcePath = join(dir, "active.jsonl");
    const targetPath = join(dir, "completed.jsonl");
    const journalPath = join(dir, ".completed.jsonl.defect-promotion.journal.json");
    const sourceBytes = '{"id":"journal-evidence"}\n';
    vfs.writeFileSync(sourcePath, sourceBytes, "utf8");
    __setDefectPromotionPersistenceTestHook((stage) => {
      if (stage === "PREPARED") throw new Error("crash-prepared");
    });
    expect(() => promoteDefectLedgerRecords(sourcePath, targetPath, ["journal-evidence"])).toThrow(
      "crash-prepared",
    );
    __setDefectPromotionPersistenceTestHook(undefined);
    const journal = JSON.parse(vfs.readFileSync(journalPath, "utf8")) as Record<string, unknown>;
    vfs.writeFileSync(
      journalPath,
      `${JSON.stringify({ ...journal, sourceHash: "invalid" })}\n`,
      "utf8",
    );
    expect(() => recoverDefectPromotion(sourcePath, targetPath)).toThrow(HarnessError);
    expect(vfs.readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    expect(vfs.existsSync(targetPath)).toBeFalse();
  });

  test("synchronized child completed appends retain both distinct records", async () => {
    const dir = createLoggingSandbox();
    const targetPath = join(dir, "completed.jsonl");

    await Promise.all([
      (async () => {
        appendDefectLedgerRecord(targetPath, {
          id: "completed-a",
          unknown: { keep: "completed-a" },
        });
      })(),
      (async () => {
        appendDefectLedgerRecord(targetPath, {
          id: "completed-b",
          unknown: { keep: "completed-b" },
        });
      })(),
    ]);

    expect(vfs.readFileSync(targetPath, "utf8")).toContain('"id":"completed-a"');
    expect(vfs.readFileSync(targetPath, "utf8")).toContain('"id":"completed-b"');
  });

  test("active append concurrent with promotion preserves both pieces of evidence", async () => {
    const dir = createLoggingSandbox();
    const sourcePath = join(dir, "active.jsonl");
    const targetPath = join(dir, "completed.jsonl");
    vfs.writeFileSync(sourcePath, '{"id":"move-me"}\n', "utf8");

    await Promise.all([
      (async () => {
        promoteDefectLedgerRecords(sourcePath, targetPath, ["move-me"]);
      })(),
      (async () => {
        appendDefectLedgerRecord(sourcePath, { id: "new-evidence" });
      })(),
    ]);

    expect(vfs.readFileSync(targetPath, "utf8")).toBe('{"id":"move-me"}\n');
    expect(vfs.readFileSync(sourcePath, "utf8")).toBe('{"id":"new-evidence"}\n');
  });
});
