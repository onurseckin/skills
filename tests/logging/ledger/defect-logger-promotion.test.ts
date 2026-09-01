import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  createLoggingSandbox,
  setupVirtualLoggingFS,
} from "../fixtures/index.ts";

beforeEach(() => {
  setupVirtualLoggingFS();
});

afterEach(() => {
  __setDefectPromotionPersistenceTestHook(undefined);
  cleanupLoggingSandboxes();
});

describe("Logging subsystem: Durable Defect Promotion & Recovery", () => {
  test("recovers every durable promotion stage exactly once", () => {
    const stages = ["PREPARED", "TARGET_DURABLE", "SOURCE_DURABLE", "COMMITTED"] as const;
    for (const stage of stages) {
      const dir = createLoggingSandbox();
      const sourcePath = join(dir, `active-${stage}.jsonl`);
      const targetPath = join(dir, `completed-${stage}.jsonl`);
      writeFileSync(sourcePath, '{"id":"recover-me","unknown":{"kept":true}}\n', "utf8");
      __setDefectPromotionPersistenceTestHook((observed) => {
        if (observed === stage) throw new Error(`crash-${stage}`);
      });
      expect(() => promoteDefectLedgerRecords(sourcePath, targetPath, ["recover-me"])).toThrow(
        `crash-${stage}`,
      );
      __setDefectPromotionPersistenceTestHook(undefined);
      recoverDefectPromotion(sourcePath, targetPath);
      recoverDefectPromotion(sourcePath, targetPath);
      const source = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "";
      const target = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
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
    writeFileSync(sourcePath, sourceBytes, "utf8");
    __setDefectPromotionPersistenceTestHook((stage) => {
      if (stage === "PREPARED") throw new Error("crash-prepared");
    });
    expect(() => promoteDefectLedgerRecords(sourcePath, targetPath, ["journal-evidence"])).toThrow(
      "crash-prepared",
    );
    __setDefectPromotionPersistenceTestHook(undefined);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
    writeFileSync(
      journalPath,
      `${JSON.stringify({ ...journal, sourceHash: "invalid" })}\n`,
      "utf8",
    );
    expect(() => recoverDefectPromotion(sourcePath, targetPath)).toThrow(HarnessError);
    expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
    expect(existsSync(targetPath)).toBeFalse();
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

    expect(readFileSync(targetPath, "utf8")).toContain('"id":"completed-a"');
    expect(readFileSync(targetPath, "utf8")).toContain('"id":"completed-b"');
  });

  test("active append concurrent with promotion preserves both pieces of evidence", async () => {
    const dir = createLoggingSandbox();
    const sourcePath = join(dir, "active.jsonl");
    const targetPath = join(dir, "completed.jsonl");
    writeFileSync(sourcePath, '{"id":"move-me"}\n', "utf8");

    await Promise.all([
      (async () => {
        promoteDefectLedgerRecords(sourcePath, targetPath, ["move-me"]);
      })(),
      (async () => {
        appendDefectLedgerRecord(sourcePath, { id: "new-evidence" });
      })(),
    ]);

    expect(readFileSync(targetPath, "utf8")).toBe('{"id":"move-me"}\n');
    expect(readFileSync(sourcePath, "utf8")).toBe('{"id":"new-evidence"}\n');
  });
});
