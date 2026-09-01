import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  defectListCommand,
  defectRecordCommand,
  defectResolveCommand,
} from "../../../../../olt/scripts/src/cli/commands/defect-ops.ts";

describe("CLI Defect Operations (defect-ops)", () => {
  test("defect:record processes raw JSONL content and deduplicates records", () => {
    const rawJsonl = [
      JSON.stringify({ id: "d1", observation: "Null pointer in worker", severity: "high" }),
      JSON.stringify({ id: "d2", observation: "Null pointer in worker", severity: "high" }),
      JSON.stringify({ id: "d3", observation: "Unrelated syntax error", severity: "warning" }),
    ].join("\n");

    const result = defectRecordCommand({
      content: rawJsonl,
    });

    expect(Array.isArray(result.defects)).toBeTrue();
    expect(result.count).toBe(2);
    expect(result.defects[0]?.count).toBe(2);
    expect(typeof result.serialized).toBe("string");
    expect(result.serialized).toContain("Null pointer in worker");
  });

  test("defect:record supports file paths, window-ms, and strategies", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "defect-rec-"));
    const tmpFile = join(tmpDir, "input-defects.jsonl");

    try {
      const lines = [
        JSON.stringify({
          id: "d1",
          observation: "Mem leak",
          timestamp: "2026-08-29T10:00:00.000Z",
        }),
        JSON.stringify({
          id: "d2",
          observation: "Mem leak",
          timestamp: "2026-08-29T10:00:10.000Z",
        }),
      ];
      writeFileSync(tmpFile, lines.join("\n"));

      const fileRes = defectRecordCommand({
        file: tmpFile,
        strategy: "windowed",
        "window-ms": 30_000,
      });

      expect(fileRes.count).toBe(1);
      expect(fileRes.defects[0]?.count).toBe(2);

      const stdinRes = defectRecordCommand(
        {},
        {
          stdin: new TextEncoder().encode(
            JSON.stringify({ id: "stdin-1", observation: "Stdin defect" }),
          ),
        },
      );
      expect(stdinRes.count).toBe(1);

      const promptRes = defectRecordCommand(
        {},
        {
          inlinePrompt: JSON.stringify({ id: "prompt-1", observation: "Inline prompt defect" }),
        },
      );
      expect(promptRes.count).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("defect:resolve resolves targeted defect with validation and empirical proof", () => {
    const defectJson = JSON.stringify({
      id: "defect-to-resolve-1",
      type: "code_defect",
      status: "open",
      observation: "Uncaught rejection",
    });

    const res = defectResolveCommand({
      defect: defectJson,
      task: "task-remed-01",
      assertion: "bun test tests/core/worker.test.ts",
      "commit-sha": "12345678abcdef",
      notes: "Handled promise rejection in worker pool",
      "verified-by": "validator_06",
    });

    expect(res.status).toBe("resolved");
    expect(res.defect.status).toBe("resolved");
    expect(res.defect.id).toBe("defect-to-resolve-1");
    expect(res.defect.resolution?.task_id).toBe("task-remed-01");
    expect(res.defect.resolution?.commit_sha).toBe("12345678abcdef");
    expect(res.defect.resolution?.remediation_notes).toBe(
      "Handled promise rejection in worker pool",
    );
    expect(res.defect.resolution?.verified_by).toBe("validator_06");
  });

  test("defect:resolve creates default defect when base defect is not provided", () => {
    const res = defectResolveCommand({
      task: "task-fix-default",
      assertion: "bun test tests/core/default.test.ts",
    });

    expect(res.status).toBe("resolved");
    expect(res.defect.status).toBe("resolved");
    expect(res.defect.resolution?.task_id).toBe("task-fix-default");
  });

  test("defect:resolve enforces require-commit-sha when requested", () => {
    expect(() =>
      defectResolveCommand({
        task: "task-strict",
        assertion: "bun test tests/core/strict.test.ts",
        "require-commit-sha": true,
      }),
    ).toThrow(/commit_sha/);
  });

  test("defect:list parses, filters by status/category, and limits defect entries", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "defect-list-"));
    const tmpFile = join(tmpDir, "defects.jsonl");

    try {
      const records = [
        JSON.stringify({
          id: "d1",
          status: "open",
          category: "boundary_violation",
          observation: "Conf breach",
        }),
        JSON.stringify({
          id: "d2",
          status: "resolved",
          category: "code_defect",
          observation: "Syntax error",
        }),
        JSON.stringify({
          id: "d3",
          status: "open",
          category: "code_defect",
          observation: "Type error",
        }),
      ];
      writeFileSync(tmpFile, records.join("\n"));

      const allRes = defectListCommand({ file: tmpFile });
      expect(allRes.count).toBe(3);

      const openRes = defectListCommand({ file: tmpFile, "filter-status": "open" });
      expect(openRes.count).toBe(2);
      expect(openRes.defects.every((d) => d.status === "open")).toBeTrue();

      const catRes = defectListCommand({ file: tmpFile, "filter-category": "boundary_violation" });
      expect(catRes.count).toBe(1);
      expect(catRes.defects[0]?.id).toBe("d1");

      const limitRes = defectListCommand({ file: tmpFile, limit: 2 });
      expect(limitRes.count).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("CLI execute integration dispatches defect commands", async () => {
    const recordOut = await execute([
      "defect:record",
      "--content",
      JSON.stringify({ id: "cli-rec-1", observation: "Registry invocation defect" }),
    ]);
    expect(recordOut.count).toBe(1);

    const resolveOut = await execute([
      "defect:resolve",
      "--task",
      "cli-task-01",
      "--assertion",
      "bun test tests/cli/cli.test.ts",
    ]);
    expect(resolveOut.status).toBe("resolved");

    const listOut = await execute([
      "defect:list",
      "--content",
      JSON.stringify({ id: "cli-list-1", observation: "Direct list record" }),
    ]);
    expect(listOut.count).toBe(1);
  });
});
