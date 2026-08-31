import { afterEach, describe, expect, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  compactDefectLogFile,
  appendDefectLedgerRecord,
  readDefectLogFile,
  recordKeyedDefect,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createLoggingSandbox,
  cleanupLoggingSandboxes,
} from "../fixtures/index.ts";

afterEach(() => {
  cleanupLoggingSandboxes();
});

describe("Logging subsystem: Defect Log Compaction & Containment", () => {
  test("compacts existing noisy defect files into aggregated format", () => {
    const dir = createLoggingSandbox();
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

  test("refuses an existing defect-log directory without fabricating an empty log or record", () => {
    const dir = createLoggingSandbox();
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
    const dir = createLoggingSandbox();
    const external = join(createLoggingSandbox(), "external-defects.jsonl");
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
    const dir = createLoggingSandbox();
    const external = join(createLoggingSandbox(), "external-defects.jsonl");
    const hardLinked = join(dir, "hard-linked.jsonl");
    writeFileSync(external, '{"id":"sentinel"}\n', "utf8");
    linkSync(external, hardLinked);
    expect(() => appendDefectLedgerRecord(hardLinked, { id: "new" })).toThrow(HarnessError);
    expect(readFileSync(external, "utf8")).toBe('{"id":"sentinel"}\n');

    const parentLink = join(dir, "linked-parent");
    const externalParent = createLoggingSandbox();
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
});
