import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindHaltCommand } from "../../../../../olt/scripts/src/cli/commands/mind-halt.ts";
import { runInitCommand } from "../../../../../olt/scripts/src/cli/commands/run-init.ts";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
  runArchiveCommand,
  runConsolidateCommand,
  runStatusCommand,
} from "../../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import * as archivalModule from "../../../../../olt/scripts/src/mind/archival/index.ts";
import * as freshnessModule from "../../../../../olt/scripts/src/installer/runtime-freshness.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function createTestRepo(name: string): { repo: string; promptFile: string } {
  const repo = `/virtual/cli/run-ops-${name}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(join(repo, ".git"), { recursive: true });
  const promptFile = join(repo, "prompt.txt");
  writeFileSync(promptFile, "Test capsule prompt content\n");
  return { repo, promptFile };
}

describe("runInitCommand", () => {
  test("throws error when neither --run nor --run-id is provided", async () => {
    await expect(runInitCommand({})).rejects.toThrow(/must provide --run or --run-id/);
  });

  test("initializes capsule with explicit prompt and flags", async () => {
    const { repo } = createTestRepo("init-prompt");
    mkdirSync("/virtual/runtime", { recursive: true });
    const freshSpy = spyOn(freshnessModule, "assertInstalledRuntimeFresh").mockResolvedValue();

    const result = await runInitCommand(
      {
        run: "run-init-basic",
        repo,
        prompt: "Inline prompt",
        mode: "feature",
        "source-verified": true,
        "allow-existing": true,
      },
      { executingRuntime: "/virtual/runtime" },
    );

    expect(result.run_id).toBe("run-init-basic");
    expect(result.existed).toBe(false);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("run-init-basic");
    freshSpy.mockRestore();
  });

  test("initializes capsule reading prompt from prompt-file and stdin variations", async () => {
    const { repo, promptFile } = createTestRepo("init-file");
    mkdirSync("/virtual/custom-source", { recursive: true });
    const fileRes = await runInitCommand({
      "run-id": "run-from-file",
      repo,
      "prompt-file": promptFile,
      "runtime-source": "/virtual/custom-source",
    });
    expect(fileRes.run_id).toBe("run-from-file");

    const stdinBytes = new TextEncoder().encode("Stdin prompt content");
    const stdinRes1 = await runInitCommand(
      { run: "run-stdin-flag", repo, "prompt-stdin": true, "no-runtime-pin": true },
      { stdin: stdinBytes },
    );
    expect(stdinRes1.run_id).toBe("run-stdin-flag");

    const stdinRes2 = await runInitCommand(
      { run: "run-stdin-auto", repo, "no-runtime-pin": true },
      { stdin: stdinBytes },
    );
    expect(stdinRes2.run_id).toBe("run-stdin-auto");

    const noPromptRes = await runInitCommand({
      run: "run-no-prompt",
      repo,
      "no-runtime-pin": true,
    });
    expect(noPromptRes.run_id).toBe("run-no-prompt");
  });
});

describe("runStatusCommand", () => {
  test("reports comprehensive status across multiple task states and phases", async () => {
    const { repo } = createTestRepo("status-comprehensive");
    const initRes = await runInitCommand({
      run: "run-status-suite",
      repo,
      prompt: "Status inspection prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;

    transact(runRoot, "coordinator", "configure-status-tasks", {}, (draft) => {
      draft.graph = { revision: 1 };
      draft.tasks = {
        "task-done": {
          id: "task-done",
          label: "Done Task",
          status: "done",
          write_scope: ["src/done.ts"],
        },
        "task-sub": {
          id: "task-sub",
          status: "submitted",
          original_implementer: "worker-sub",
          write_scope: ["src/sub.ts"],
        },
        "task-leased": {
          id: "task-leased",
          status: "leased",
          write_scope: ["src/leased.ts"],
          lease: { agent_id: "worker-1", role: "implementer" },
        },
        "task-val-active": {
          id: "task-val-active",
          status: "validating",
          write_scope: ["src/val.ts"],
          validations: [{ validator_id: "val-1", domain: "quality" }],
        },
        "task-val-done": {
          id: "task-val-done",
          status: "validating",
          write_scope: ["src/val2.ts"],
          validations: [{ validator_id: "val-2", domain: "sec", verdict: "pass" }],
        },
        "task-val-probe": {
          id: "task-val-probe",
          status: "validating",
          write_scope: ["src/val3.ts"],
          validations: [],
        },
        "task-ready": { id: "task-ready", status: "ready", write_scope: ["src/ready.ts"] },
        "task-prop": { id: "task-prop", status: "proposed", write_scope: ["src/prop.ts"] },
        "task-repair": {
          id: "task-repair",
          status: "changes_requested",
          write_scope: ["src/repair.ts"],
        },
        "task-unknown": {
          id: "task-unknown",
          status: "custom_status",
          write_scope: ["src/unk.ts"],
        },
      };
    });

    const statusRes = runStatusCommand({ repo, run: runRoot, detailed: true });

    expect(statusRes.run_root).toBe(runRoot);
    expect(statusRes.detailed).toBe(true);
    expect(statusRes.occupancy).toBeDefined();
    const md = String(statusRes.markdown);
    expect(md).toContain("Done Task");
    expect(md).toContain("Leased (worker-1 [implementer])");
    expect(md).toContain("Validating (val-1 [quality])");
    expect(md).toContain("Validated (val-2)");
    expect(md).toContain("Validating (Pending Probe)");
    expect(md).toContain("Standby (Ready)");
    expect(md).toContain("Repair Required");
  });

  test("handles status with completed phase and empty catalogue", async () => {
    const { repo } = createTestRepo("status-completed");
    const initRes = await runInitCommand({
      run: "run-status-done",
      repo,
      prompt: "Status done prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;

    transact(runRoot, "coordinator", "complete-run-state", {}, (draft) => {
      draft.completion_result = { status: "complete", completed_at: "2026-09-01T00:00:00.000Z" };
    });

    const statusRes = runStatusCommand({ repo, "run-id": runRoot });
    expect(statusRes.detailed).toBe(false);
    expect(String(statusRes.markdown)).toContain("Completed");
  });
});

describe("runConsolidateCommand and runArchiveCommand", () => {
  test("runs capsule consolidation and archival with structured output", () => {
    const consolidateSpy = spyOn(archivalModule, "consolidateCapsules").mockReturnValue({
      activeCapsules: [".olt/capsules/run-1"],
      archivedCapsules: [".olt/capsules/archive/run-0"],
      prunedSubdirectoriesCount: 2,
      archiveDir: ".olt/capsules/archive",
    });

    const resConsolidate = runConsolidateCommand({ repo: "/virtual/repo", "dry-run": true });
    expect(resConsolidate.activeCapsules).toHaveLength(1);
    expect(String(resConsolidate.markdown)).toContain("Capsule Consolidation Complete");
    consolidateSpy.mockRestore();

    const archiveSpy = spyOn(archivalModule, "archiveCapsule").mockReturnValue({
      runId: "run-arch-1",
      sourcePath: ".olt/capsules/run-arch-1",
      archivedPath: ".olt/capsules/archive/run-arch-1",
      prunedDirectories: ["scratch"],
    });

    const resArchive = runArchiveCommand({ run: ".olt/capsules/run-arch-1", "dry-run": true });
    expect(resArchive.runId).toBe("run-arch-1");
    expect(String(resArchive.markdown)).toContain("Capsule Archived: `run-arch-1`");
    archiveSpy.mockRestore();
  });
});

describe("resolvePhaseCompletionResult & appendReleaseFailureWarning", () => {
  test("resolves successful and failing phase completion callbacks", async () => {
    const successResult = await resolvePhaseCompletionResult(async () => ({
      synced: true,
      committed: true,
      pushed: true,
      commitSha: "abc1234",
    }));
    expect(successResult.synced).toBe(true);
    expect(successResult.commitSha).toBe("abc1234");

    const failureResult = await resolvePhaseCompletionResult(async () => {
      throw "non-error failure string";
    });
    expect(failureResult.synced).toBe(false);
    expect(failureResult.error).toBe("non-error failure string");

    expect(appendReleaseFailureWarning("Base", undefined)).toBe("Base");
    expect(appendReleaseFailureWarning("Base", "git error")).toBe(
      "Base\n- **Warning**: Release completion failed: git error",
    );
  });
});

describe("mindHaltCommand", () => {
  test("records halt reason, creates escalation entry, and suppresses next wake", async () => {
    const { repo } = createTestRepo("mind-halt-run");
    const initRes = await runInitCommand({
      run: "run-mind-halt",
      repo,
      prompt: "Halt test prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;

    const haltRes = mindHaltCommand({
      run: runRoot,
      actor: "coordinator",
      reason: "Critical quota ceiling reached",
    });

    expect(haltRes.halted).toBe(true);
    expect(haltRes.reason).toBe("Critical quota ceiling reached");
    expect(String(haltRes.markdown)).toContain("Mind Halted");
    expect(String(haltRes.markdown)).toContain("Critical quota ceiling reached");
  });
});
