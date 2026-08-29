import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeFindingFileCommand,
  findingFileCommand,
} from "../../../olt/scripts/src/cli/commands/finding-ops.ts";
import { parseDefectsJsonl } from "../../../olt/scripts/src/mind/defects/sync/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Wave 3 - Task 3.3: Universal finding:file CLI Subcommand", () => {
  test("executeFindingFileCommand writes finding to defects.jsonl", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "finding-cli-test-"));
    roots.push(tempDir);
    const defectsPath = join(tempDir, ".olt", "defects.jsonl");

    const result = await executeFindingFileCommand({
      code: "AST_PURITY_VIOLATION",
      severity: "high",
      file: "src/theme.ts",
      line: 45,
      message: "Found banned as any usage",
      taskId: "task-101",
      commitSha: "abc1234",
      defectsPath,
    });

    expect(result.success).toBe(true);
    expect(result.newlyCreated).toBe(1);
    expect(result.totalDefects).toBe(1);

    const content = readFileSync(defectsPath, "utf-8");
    const entries = parseDefectsJsonl(content);
    expect(entries.length).toBe(1);
    expect(entries[0]?.type).toBe("AST_PURITY_VIOLATION");
    expect(entries[0]?.severity).toBe("high");
    expect(entries[0]?.observation).toBe("Found banned as any usage");
  });

  test("findingFileCommand CLI handler processes parsed flags", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "finding-handler-test-"));
    roots.push(tempDir);
    const defectsPath = join(tempDir, ".olt", "defects.jsonl");

    const flags = {
      code: "RUNTIME_EXCEPTION",
      severity: "critical",
      file: "src/engine.ts",
      message: "Unhandled promise rejection in runner",
      "task-id": "task-202",
      "commit-sha": "def5678",
      "defects-path": defectsPath,
    };

    const output = await findingFileCommand(flags);
    expect(output.success).toBe(true);
    expect(output.code).toBe("RUNTIME_EXCEPTION");
    expect(output.severity).toBe("critical");
    expect(output.newly_created).toBe(1);
  });
});
