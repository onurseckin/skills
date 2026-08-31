import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  appendDefectLedgerRecord,
  __setDefectPromotionPersistenceTestHook,
  promoteDefectLedgerRecords,
  recoverDefectPromotion,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createLoggingSandbox,
  cleanupLoggingSandboxes,
} from "../fixtures/index.ts";

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
    const start = join(dir, "start");
    const moduleUrl = new URL("../../../olt/scripts/src/logging/defect-logger.ts", import.meta.url)
      .href;
    const script = (id: string) => `
      import { appendDefectLedgerRecord } from ${JSON.stringify(moduleUrl)};
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(join(dir, `ready-${id}`))}, "ready");
      while (!existsSync(${JSON.stringify(start)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      appendDefectLedgerRecord(${JSON.stringify(targetPath)}, { id: ${JSON.stringify(id)}, unknown: { keep: ${JSON.stringify(id)} } });
    `;
    const children = ["completed-a", "completed-b"].map((id) =>
      Bun.spawn([process.execPath, "--eval", script(id)], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    for (
      let attempt = 0;
      attempt < 100 && !existsSync(join(dir, "ready-completed-a"));
      attempt += 1
    )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    for (
      let attempt = 0;
      attempt < 100 && !existsSync(join(dir, "ready-completed-b"));
      attempt += 1
    )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    writeFileSync(start, "go");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0]);
    expect(readFileSync(targetPath, "utf8")).toContain('"id":"completed-a"');
    expect(readFileSync(targetPath, "utf8")).toContain('"id":"completed-b"');
  });

  test("active append concurrent with promotion preserves both pieces of evidence", async () => {
    const dir = createLoggingSandbox();
    const sourcePath = join(dir, "active.jsonl");
    const targetPath = join(dir, "completed.jsonl");
    const start = join(dir, "start");
    writeFileSync(sourcePath, '{"id":"move-me"}\n', "utf8");
    const moduleUrl = new URL("../../../olt/scripts/src/logging/defect-logger.ts", import.meta.url)
      .href;
    const child = (name: string, action: string) => `
      import { appendDefectLedgerRecord, promoteDefectLedgerRecords } from ${JSON.stringify(moduleUrl)};
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(join(dir, `ready-${name}`))}, "ready");
      while (!existsSync(${JSON.stringify(start)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      ${action}
    `;
    const promote = Bun.spawn([
      process.execPath,
      "--eval",
      child(
        "promote",
        `promoteDefectLedgerRecords(${JSON.stringify(sourcePath)}, ${JSON.stringify(targetPath)}, ["move-me"]);`,
      ),
    ]);
    const append = Bun.spawn([
      process.execPath,
      "--eval",
      child(
        "append",
        `appendDefectLedgerRecord(${JSON.stringify(sourcePath)}, { id: "new-evidence" });`,
      ),
    ]);
    for (const ready of ["ready-promote", "ready-append"]) {
      for (let attempt = 0; attempt < 100 && !existsSync(join(dir, ready)); attempt += 1)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    writeFileSync(start, "go");
    expect(await Promise.all([promote.exited, append.exited])).toEqual([0, 0]);
    expect(readFileSync(targetPath, "utf8")).toBe('{"id":"move-me"}\n');
    expect(readFileSync(sourcePath, "utf8")).toBe('{"id":"new-evidence"}\n');
  });
});
