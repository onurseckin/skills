import { beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  compactDefectLogFile,
  readDefectLogFile,
  recordKeyedDefect,
} from "../../../olt/scripts/src/logging/defect-logger.ts";
import { scratchRoot, setupVirtualDefectsFS } from "../defects-fixture.ts";

export const defectLoggerSuiteName = "Keyed Defect Logger & Compaction File Engine";

describe(defectLoggerSuiteName, () => {
  beforeEach(() => {
    setupVirtualDefectsFS();
  });
  test("records and aggregates defects live on disk", () => {
    const dir = scratchRoot(import.meta.path, "logger-live");
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
    expect(fs.existsSync(filePath)).toBeTrue();

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

  test("compacts existing noisy defect files into aggregated format", () => {
    const dir = scratchRoot(import.meta.path, "logger-compact");
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

    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");

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
    const entries = readDefectLogFile("/virtual/defects-scratch/nonexistent/defects.jsonl");
    expect(entries).toEqual([]);
  });
});
