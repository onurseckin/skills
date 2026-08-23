import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactBlunderLogFile,
  readBlunderLogFile,
  recordKeyedBlunder,
} from "../../../olt/scripts/src/logging/blunder-logger.ts";

const tempRoots: string[] = [];

afterEach(() => {
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
  const dir = mkdtempSync(join(tmpdir(), "blunder-logger-logging-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("Logging subsystem: Keyed Blunder Logger & Compaction", () => {
  test("records and aggregates blunders live on disk under logging subsystem", () => {
    const dir = createTempDir();
    const filePath = join(dir, "blunders.jsonl");

    const r1 = recordKeyedBlunder(
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

    const r2 = recordKeyedBlunder(
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

    const entries = readBlunderLogFile(filePath);
    expect(entries.length).toBe(1);
    expect(entries[0]?.count).toBe(2);
    expect(entries[0]?.type).toBe("main_thread_direct_execution");
  });

  test("compacts existing noisy blunder files into aggregated format", () => {
    const dir = createTempDir();
    const filePath = join(dir, "blunders.jsonl");

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

    const result = compactBlunderLogFile(filePath);
    expect(result.totalBefore).toBe(21);
    expect(result.totalAfter).toBe(2);

    const compacted = readBlunderLogFile(filePath);
    expect(compacted.length).toBe(2);

    const repeated = compacted.find((c) => c.type === "repeated_failure");
    expect(repeated !== undefined).toBeTrue();
    if (repeated) {
      expect(repeated.count).toBe(20);
    }
  });

  test("handles nonexistent file reading gracefully", () => {
    const entries = readBlunderLogFile("/path/does/not/exist/blunders.jsonl");
    expect(entries).toEqual([]);
  });
});
