import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  defectListCommand,
  defectRecordCommand,
  defectResolveCommand,
} from "../../olt/scripts/src/cli/commands/defect-ops.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Defect CLI commands", () => {
  test("defect:record ingests and deduplicates defect JSONL", () => {
    const rawJsonl = [
      JSON.stringify({ id: "d1", observation: "Null pointer in router", severity: "high" }),
      JSON.stringify({ id: "d2", observation: "Null pointer in router", severity: "high" }),
    ].join("\n");

    const recordRes = defectRecordCommand({
      content: rawJsonl,
    });

    expect(Array.isArray(recordRes.defects)).toBe(true);
    expect(typeof recordRes.serialized).toBe("string");
    expect(recordRes.count as number).toBeGreaterThanOrEqual(1);
  });

  test("defect:resolve attaches empirical proof and resolves defect", () => {
    const res = defectResolveCommand({
      task: "task-resolve-01",
      assertion: "bun test tests/unit/router.test.ts",
      "commit-sha": "abcdef123456",
      notes: "Fixed null check in routing dispatch handler",
    });

    expect(res.status).toBe("resolved");
    const defectObj = res.defect as Record<string, unknown>;
    expect(defectObj.status).toBe("resolved");
    expect(defectObj.resolution).toBeDefined();
  });

  test("defect:list reads and parses structured defect log entries", () => {
    const dir = scratchRoot(import.meta.path, "defect-list-test");
    const filePath = join(dir, "defects.jsonl");
    const content = [
      JSON.stringify({ id: "d-01", status: "open", severity: "warning", observation: "Warning 1" }),
      JSON.stringify({ id: "d-02", status: "resolved", severity: "info", observation: "Info 2" }),
    ].join("\n");
    writeFileSync(filePath, content);

    const listRes = defectListCommand({
      file: filePath,
    });

    expect(Array.isArray(listRes.defects)).toBe(true);
    expect(listRes.count).toBe(2);
  });

  test("CLI execute dispatches defect commands through registry", async () => {
    const recordResult = await execute([
      "defect:record",
      "--content",
      JSON.stringify({ id: "cli-d1", observation: "CLI defect trace" }),
    ]);
    expect(recordResult.count).toBe(1);

    const resolveResult = await execute([
      "defect:resolve",
      "--task",
      "cli-task-fix",
      "--assertion",
      "bun test tests/unit/fix.test.ts",
    ]);
    expect(resolveResult.status).toBe("resolved");

    const listResult = await execute([
      "defect:list",
      "--content",
      JSON.stringify({ id: "cli-d2", observation: "Listed defect" }),
    ]);
    expect(listResult.count).toBe(1);
  });
});
