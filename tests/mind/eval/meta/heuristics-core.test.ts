import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  analyzeRunForensics,
  type ForensicsAnalysisResult,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("Meta Auditor - Deep Behavioral Forensics Core Heuristics (in-memory virtual)", () => {
  let scratchDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    scratchDir = scratchRoot("meta-core", "test");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("throws HarnessError when runRoot is missing or empty", () => {
    expect(() => {
      analyzeRunForensics({ runRoot: "" });
    }).toThrow(HarnessError);

    expect(() => {
      analyzeRunForensics({});
    }).toThrow("runRoot option is required");
  });

  it("evaluates a completely clean run with 100.0 score and zero incidents", () => {
    const manifest: Manifest = {
      version: "2.0.0",
      run_id: "run-clean-test",
      created_at: "2026-08-23T00:00:00.000Z",
      entry_task_id: "task-1",
    };
    fs.writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const state: RunState = {
      version: "2.0.0",
      run_id: "run-clean-test",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:01:00.000Z",
      status: "succeeded",
      tasks: {
        "task-1": {
          id: "task-1",
          title: "Task 1",
          description: "Do task 1",
          status: "succeeded",
          kind: "implementation",
          write_scope: ["src/file1.ts"],
          attempts: [
            {
              attempt: 1,
              status: "succeeded",
              agent_id: "implementer_1",
              started_at: "2026-08-23T00:00:10.000Z",
              completed_at: "2026-08-23T00:00:30.000Z",
            },
          ],
        },
      },
      agents: [
        {
          id: "implementer_1",
          role: "implementer",
          status: "released",
          tokens_in: 2500,
          tokens_out: 800,
        },
      ],
    };
    fs.writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

    const res: ForensicsAnalysisResult = analyzeRunForensics({ runRoot: scratchDir });
    expect(res).toBeDefined();
    expect(res.efficiencyScore).toBe(100);
    expect(res.incidents).toHaveLength(0);
  });
});
