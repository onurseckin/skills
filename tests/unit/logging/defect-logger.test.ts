import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactDefectLogFile,
  appendDefectLedgerRecord,
  __setDefectPromotionPersistenceTestHook,
  readDefectLogFile,
  promoteDefectLedgerRecords,
  recoverDefectPromotion,
  recordKeyedDefect,
  setDefectLogDependenciesForTesting,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

const tempRoots: string[] = [];

afterEach(() => {
  __setDefectPromotionPersistenceTestHook(undefined);
  for (const r of tempRoots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
  tempRoots.length = 0;
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "defect-logger-logging-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("Logging subsystem: Keyed Defect Logger & Compaction", () => {
  test("records and aggregates defects live on disk under logging subsystem", () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");

    const r1 = recordKeyedDefect(
      {
        id: "b-log-1",
        type: "main_thread_direct_execution",
        observation: "Direct execution without subagent",
        agent_id: "orch-01",
      },
      { filePath },
    );

    expect(r1.isNew).toBeTrue();
    expect(r1.recorded.count).toBe(1);
    expect(existsSync(filePath)).toBeTrue();

    const r2 = recordKeyedDefect(
      {
        id: "b-log-2",
        type: "main_thread_direct_execution",
        observation: "Direct execution without subagent",
        agent_id: "orch-01",
      },
      { filePath },
    );

    expect(r2.isNew).toBeFalse();
    expect(r2.recorded.count).toBe(2);

    const entries = readDefectLogFile(filePath);
    expect(entries.length).toBe(1);
    expect(entries[0]?.count).toBe(2);
    expect(entries[0]?.type).toBe("main_thread_direct_execution");
  });

  test("serializes cross-process keyed records without losing distinct defects or duplicate occurrences", async () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");
    const start = join(dir, "start");
    const moduleUrl = new URL("../../../olt/scripts/src/logging/defect-logger.ts", import.meta.url)
      .href;
    const childScript = (label: string, type: string, observation: string): string => `
      import { existsSync, writeFileSync } from "node:fs";
      import { recordKeyedDefect } from ${JSON.stringify(moduleUrl)};
      writeFileSync(${JSON.stringify(join(dir, `ready-${label}`))}, "ready");
      while (!existsSync(${JSON.stringify(start)}))
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      recordKeyedDefect({ id: ${JSON.stringify(label)}, type: ${JSON.stringify(type)}, observation: ${JSON.stringify(observation)} }, { filePath: ${JSON.stringify(filePath)} });
    `;
    const children = [
      Bun.spawn([process.execPath, "--eval", childScript("duplicate-a", "race", "same")], {
        stdout: "pipe",
        stderr: "pipe",
      }),
      Bun.spawn([process.execPath, "--eval", childScript("duplicate-b", "race", "same")], {
        stdout: "pipe",
        stderr: "pipe",
      }),
      Bun.spawn([process.execPath, "--eval", childScript("distinct", "other", "different")], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    ];
    for (
      let attempt = 0;
      attempt < 100 &&
      (!existsSync(join(dir, "ready-duplicate-a")) ||
        !existsSync(join(dir, "ready-duplicate-b")) ||
        !existsSync(join(dir, "ready-distinct")));
      attempt += 1
    ) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    writeFileSync(start, "go");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0, 0]);

    const entries = readDefectLogFile(filePath);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.type === "race")?.count).toBe(2);
    expect(entries.find((entry) => entry.type === "other")?.count).toBe(1);
  });

  test("compacts existing noisy defect files into aggregated format", () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");

    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      lines.push(
        JSON.stringify({
          id: `b-spam-${i}`,
          type: "repeated_failure",
          observation: "Same failure across loop",
          agent_id: "impl-01",
          timestamp: `2026-08-22T08:${i < 10 ? "0" + i : i}:00.000Z`,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        id: "b-distinct",
        type: "distinct_error",
        observation: "Different error",
        agent_id: "impl-01",
        timestamp: "2026-08-22T08:30:00.000Z",
      }),
    );

    writeFileSync(filePath, `${lines.join("\n")}\n`);

    const result = compactDefectLogFile(filePath);
    expect(result.totalBefore).toBe(21);
    expect(result.totalAfter).toBe(2);

    const compacted = readDefectLogFile(filePath);
    expect(compacted.length).toBe(2);

    const repeated = compacted.find((c) => c.type === "repeated_failure");
    expect(repeated !== undefined).toBeTrue();
    if (repeated) {
      expect(repeated.count).toBe(20);
    }
  });

  test("handles nonexistent file reading gracefully", () => {
    const entries = readDefectLogFile("/path/does/not/exist/defects.jsonl");
    expect(entries).toEqual([]);
  });

  test("rejects malformed, non-object, and duplicate raw ledger records without rewriting bytes", () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");
    const cases = ["not-json\n", "42\n", '{"id":"same"}\n{"id":"same"}\n'];
    for (const raw of cases) {
      writeFileSync(filePath, raw, "utf8");
      expect(() => appendDefectLedgerRecord(filePath, { id: "fresh", type: "test" })).toThrow(
        HarnessError,
      );
      expect(readFileSync(filePath, "utf8")).toBe(raw);
    }
  });

  test("classifies an own-code ENOENT read as an absent log only after attempting the read", () => {
    const dir = createTempDir();
    const filePath = join(dir, "missing-defects.jsonl");
    const missing = Object.assign(new Error("missing log"), { code: "ENOENT" });
    let reads = 0;
    const restore = setDefectLogDependenciesForTesting({
      readFile: () => {
        reads += 1;
        throw missing;
      },
    });

    try {
      expect(readDefectLogFile(filePath)).toEqual([]);
      expect(reads).toBe(1);
    } finally {
      restore();
    }
  });

  test("does not treat an inherited ENOENT code as an absent defect log", () => {
    const dir = createTempDir();
    const filePath = join(dir, "inherited-code.jsonl");
    const inheritedCode = Object.assign(new Error("inherited missing"), {
      code: "ENOENT",
    });
    const readFailure: object = Object.create(inheritedCode);
    const restore = setDefectLogDependenciesForTesting({
      readFile: () => {
        throw readFailure;
      },
    });

    let caught: unknown;
    try {
      readDefectLogFile(filePath);
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }

    expect(caught).toBeInstanceOf(HarnessError);
    if (caught instanceof HarnessError) {
      expect(caught.code).toBe("INTEGRITY");
      expect(caught.message).toContain("read defect log");
      expect(caught.message).toContain(filePath);
      expect(caught.message).toContain("unknown error");
    }
  });

  test("does not invoke accessor-shaped read-error fields", () => {
    const dir = createTempDir();
    const filePath = join(dir, "accessor-code.jsonl");
    let codeReads = 0;
    let messageReads = 0;
    const readFailure: object = Object.create(Error.prototype, {
      code: {
        configurable: true,
        get: () => {
          codeReads += 1;
          return "ENOENT";
        },
      },
      message: {
        configurable: true,
        get: () => {
          messageReads += 1;
          return "untrusted message";
        },
      },
    });
    const restore = setDefectLogDependenciesForTesting({
      readFile: () => {
        throw readFailure;
      },
    });

    let caught: unknown;
    try {
      readDefectLogFile(filePath);
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }

    expect(codeReads).toBe(0);
    expect(messageReads).toBe(0);
    expect(caught).toBeInstanceOf(HarnessError);
    if (caught instanceof HarnessError) {
      expect(caught.code).toBe("INTEGRITY");
      expect(caught.message).toContain("read defect log");
      expect(caught.message).toContain(filePath);
      expect(caught.message).toContain("unknown error");
    }
  });

  test("refuses an atomic-write failure without changing prior bytes or reporting success", () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");
    const originalBytes = "malformed prior bytes stay unchanged\n";
    const writeFailure = new HarnessError("INVALID_STATE", "atomic write denied");
    writeFileSync(filePath, originalBytes);
    const restore = setDefectLogDependenciesForTesting({
      atomicWrite: () => {
        throw writeFailure;
      },
    });

    let caught: unknown;
    try {
      recordKeyedDefect(
        {
          id: "b-write-failure",
          type: "filesystem_failure",
          observation: "atomic write failed",
        },
        { filePath },
      );
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }

    expect(caught).toBeInstanceOf(HarnessError);
    if (caught instanceof HarnessError) {
      expect(caught).not.toBe(writeFailure);
      expect(caught.code).toBe("INTEGRITY");
      expect(caught.message).toContain("write defect log");
      expect(caught.message).toContain(filePath);
      expect(caught.message).toContain("atomic write denied");
    }
    expect(readFileSync(filePath, "utf-8")).toBe(originalBytes);
  });

  test("refuses an existing defect-log directory without fabricating an empty log or record", () => {
    const dir = createTempDir();
    const filePath = join(dir, "defects.jsonl");
    const sentinelPath = join(filePath, "sentinel.txt");
    const sentinelBytes = "preserve-existing-directory";
    mkdirSync(filePath);
    writeFileSync(sentinelPath, sentinelBytes);

    let readError: unknown;
    try {
      readDefectLogFile(filePath);
    } catch (error) {
      readError = error;
    }
    expect(readError).toBeInstanceOf(HarnessError);
    if (readError instanceof HarnessError) {
      expect(readError.code).toBe("INTEGRITY");
      expect(readError.message).toContain("read defect log");
      expect(readError.message).toContain(filePath);
      expect(readError.message).toContain("EISDIR");
    }

    let recordError: unknown;
    try {
      recordKeyedDefect(
        {
          id: "b-directory-log",
          type: "filesystem_failure",
          observation: "defects log path is a directory",
        },
        { filePath },
      );
    } catch (error) {
      recordError = error;
    }
    expect(recordError).toBeInstanceOf(HarnessError);
    if (recordError instanceof HarnessError) {
      expect(recordError.code).toBe("INTEGRITY");
      expect(recordError.message).toContain("read defect log");
      expect(recordError.message).toContain(filePath);
      expect(recordError.message).toContain("EISDIR");
    }
    expect(readFileSync(sentinelPath, "utf-8")).toBe(sentinelBytes);
  });

  test("refuses a symlinked defect ledger without changing its external target", () => {
    const dir = createTempDir();
    const external = join(createTempDir(), "external-defects.jsonl");
    const filePath = join(dir, "defects.jsonl");
    const bytes = "";
    writeFileSync(external, bytes, "utf8");
    symlinkSync(external, filePath);

    expect(() =>
      recordKeyedDefect(
        {
          id: "symlink-refused",
          type: "filesystem_failure",
          observation: "must not follow",
        },
        { filePath },
      ),
    ).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe(bytes);
  });

  test("refuses hard-linked ledgers and symlinked parents without touching sentinels", () => {
    const dir = createTempDir();
    const external = join(createTempDir(), "external-defects.jsonl");
    const hardLinked = join(dir, "hard-linked.jsonl");
    writeFileSync(external, '{"id":"sentinel"}\n', "utf8");
    linkSync(external, hardLinked);
    expect(() => appendDefectLedgerRecord(hardLinked, { id: "new" })).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe('{"id":"sentinel"}\n');

    const parentLink = join(dir, "linked-parent");
    const externalParent = createTempDir();
    const parentSentinel = join(externalParent, "defects.jsonl");
    writeFileSync(parentSentinel, '{"id":"parent-sentinel"}\n', "utf8");
    symlinkSync(externalParent, parentLink);
    expect(() =>
      appendDefectLedgerRecord(join(parentLink, "defects.jsonl"), {
        id: "new-parent",
      }),
    ).toThrow(HarnessError);
    expect(readFileSync(parentSentinel, "utf8")).toBe('{"id":"parent-sentinel"}\n');
  });

  test("recovers every durable promotion stage exactly once", () => {
    const stages = ["PREPARED", "TARGET_DURABLE", "SOURCE_DURABLE", "COMMITTED"] as const;
    for (const stage of stages) {
      const dir = createTempDir();
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
    const dir = createTempDir();
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
    const dir = createTempDir();
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
    const dir = createTempDir();
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
