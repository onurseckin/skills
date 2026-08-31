import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
  runArchiveCommand,
  runCompleteCommand,
  runConsolidateCommand,
} from "../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as completeRunModule from "../../../../olt/scripts/src/workflow/completion/complete-run.ts";
import * as autoSyncModule from "../../../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import * as summaryModule from "../../../../olt/scripts/src/summary/formatters/index.ts";
import * as archivalModule from "../../../../olt/scripts/src/mind/archival/index.ts";
import type { WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";

beforeEach(() => {
  enableInMemoryAgentMetadata();
});

afterEach(() => {
  disableInMemoryAgentMetadata();
});

async function initializeRun(label: string): Promise<{ repo: string; runRoot: string }> {
  const repo = mkdtempSync(join(tmpdir(), `run-ops-basic-${label}-`));
  const promptPath = join(repo, "prompt.txt");
  writeFileSync(promptPath, "runner metadata authority test", "utf-8");
  const initialized = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    `${label}-run`,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, runRoot: initialized.run_root as string };
}

function grantShellExecution(runRoot: string, actor: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role: "implementer",
      write_scope: ["src/"],
      can_execute_shell: true,
    }),
    runRoot,
  );
}

describe("runCompleteCommand", () => {
  test("captures rejected phase completion as a structured release failure", async () => {
    const result = await resolvePhaseCompletionResult(async () => {
      throw new Error("sync service unavailable");
    });

    expect(result).toEqual({
      synced: false,
      committed: false,
      pushed: false,
      error: "sync service unavailable",
    });
  });

  test("renders release failures as a concise completion warning", () => {
    expect(appendReleaseFailureWarning("### Run Complete", "sync service unavailable")).toBe(
      "### Run Complete\n- **Warning**: Release completion failed: sync service unavailable",
    );
    expect(appendReleaseFailureWarning("### Run Complete", undefined)).toBe("### Run Complete");
  });

  test("completes run lifecycle and captures auto sync release logs and warnings", async () => {
    const { repo, runRoot } = await initializeRun("run-complete-lifecycle");
    const actor = "coordinator";
    grantShellExecution(runRoot, actor);

    const completeSpy = spyOn(completeRunModule, "completeRun").mockReturnValue({
      tasks: {
        "T-1": {
          id: "T-1",
          status: "done",
          requirement_ids: [],
          write_scope: ["."],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      },
      requirements: [],
      gates: [],
      commands: {},
      completion_result: {
        status: "complete",
        completed_at: new Date().toISOString(),
      },
    } as unknown as WorkflowState);

    const autoSyncSpy = spyOn(autoSyncModule, "executeAutoSyncAndCommit").mockResolvedValue({
      synced: false,
      committed: false,
      pushed: false,
      logs: ["[sync] failed to sync skills", "[commit] git clean failed"],
    });

    const summarySpy = spyOn(summaryModule, "generateSummarySuite").mockImplementation(() => {
      throw new Error("summary generation warning");
    });

    const pruneSpy = spyOn(archivalModule, "pruneCapsuleBoilerplate").mockReturnValue({
      runId: "run-complete-lifecycle-run",
      prunedDirectories: ["events-archive"],
      prunedFilesCount: 1,
      freedBytes: 1024,
    });

    const res = await runCompleteCommand({
      run: runRoot,
      actor,
      "auth-token": "test-token",
    });

    expect(res.run_root).toBe(runRoot);
    expect(res.summary_warning).toBe("summary generation warning");
    expect(res.pruned_subdirectories).toEqual(["events-archive"]);
    expect(String(res.markdown)).toContain("Warning");

    completeSpy.mockRestore();
    autoSyncSpy.mockRestore();
    summarySpy.mockRestore();
    pruneSpy.mockRestore();
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("runConsolidateCommand and runArchiveCommand", () => {
  test("runs consolidation command with dryRun and custom directory", () => {
    const consolidateSpy = spyOn(archivalModule, "consolidateCapsules").mockReturnValue({
      activeCapsules: [".olt/capsules/run-1"],
      archivedCapsules: [".olt/capsules/archive/run-0"],
      prunedSubdirectoriesCount: 3,
      archiveDir: ".olt/capsules/archive",
    });

    const res = runConsolidateCommand({
      repo: "/mock/repo",
      "capsules-dir": "/mock/repo/.olt/capsules",
      "dry-run": true,
    });

    expect(res.activeCapsules).toHaveLength(1);
    expect(res.archivedCapsules).toHaveLength(1);
    expect(String(res.markdown)).toContain("Capsule Consolidation Complete");

    consolidateSpy.mockRestore();
  });

  test("runs archive command with dryRun", () => {
    const archiveSpy = spyOn(archivalModule, "archiveCapsule").mockReturnValue({
      runId: "run-archive-1",
      sourcePath: ".olt/capsules/run-archive-1",
      archivedPath: ".olt/capsules/archive/run-archive-1",
      prunedDirectories: ["scratch", "tmp"],
    });

    const res = runArchiveCommand({
      run: ".olt/capsules/run-archive-1",
      "dry-run": true,
    });

    expect(res.runId).toBe("run-archive-1");
    expect(String(res.markdown)).toContain("Capsule Archived: `run-archive-1`");

    archiveSpy.mockRestore();
  });
});
