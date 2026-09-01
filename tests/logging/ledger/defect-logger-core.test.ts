import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendDefectLedgerRecord,
  readDefectLogFile,
  recordKeyedDefect,
  setDefectLogDependenciesForTesting,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { createLoggingSandbox, cleanupLoggingSandboxes } from "../fixtures/index.ts";

afterEach(() => {
  cleanupLoggingSandboxes();
});

describe("Logging subsystem: Keyed Defect Logger Core", () => {
  test("records and aggregates defects live on disk under logging subsystem", () => {
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
    const filePath = join(dir, "defects.jsonl");

    await Promise.all([
      (async () => {
        recordKeyedDefect({ id: "duplicate-a", type: "race", observation: "same" }, { filePath });
      })(),
      (async () => {
        recordKeyedDefect({ id: "duplicate-b", type: "race", observation: "same" }, { filePath });
      })(),
      (async () => {
        recordKeyedDefect(
          { id: "distinct", type: "other", observation: "different" },
          { filePath },
        );
      })(),
    ]);

    const entries = readDefectLogFile(filePath);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.type === "race")?.count).toBe(2);
    expect(entries.find((entry) => entry.type === "other")?.count).toBe(1);
  });

  test("rejects malformed, non-object, and duplicate raw ledger records without rewriting bytes", () => {
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
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
});
