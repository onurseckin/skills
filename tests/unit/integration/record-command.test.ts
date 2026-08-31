import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/models/execution/index.ts";
import { writeAgentMetadata } from "../../../olt/scripts/src/runtime/session.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  recordCommandIntent,
  reconcileCommandResult,
  reconcileStrandedCommands,
  runAndRecordCommand,
} from "../../../olt/scripts/src/integration/record-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function freshRun(label: string): { runRoot: string; repo: string } {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const runRoot = initRun(repo, `rec-cmd-run-${label}`, new TextEncoder().encode("prompt"), "file", true);
  writeAgentMetadata(
    {
      agent_id: "implementer",
      role: "implementer",
      tier: 3,
      write_scope: ["src/**"],
      allowed_read_scope: ["."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
    },
    runRoot,
  );
  writeAgentMetadata(
    {
      agent_id: "coordinator",
      role: "coordinator",
      tier: 2,
      write_scope: ["."],
      allowed_read_scope: ["."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
    },
    runRoot,
  );
  return { runRoot, repo };
}

describe("record-command", () => {
  test("recordCommandIntent validates actor, status, verification, and writes intent", async () => {
    const { runRoot, repo } = freshRun("intent-test");
    const prepared = await prepareCommand({
      argv: ["echo", "test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });

    // Non-running status error
    expect(() =>
      recordCommandIntent(runRoot, "implementer", { ...prepared.record, status: "succeeded" }),
    ).toThrow(/command intent must be running/);

    // Verification error on corrupt record
    const corrupt = { ...prepared.record, fingerprint: "bad-fingerprint" };
    expect(() => recordCommandIntent(runRoot, "implementer", corrupt)).toThrow(
      /command evidence is invalid/,
    );

    // Mismatched actor
    expect(() => recordCommandIntent(runRoot, "coordinator", prepared.record)).toThrow(
      /command event actor does not match command actor/,
    );

    // Successful record
    recordCommandIntent(runRoot, "implementer", prepared.record);

    // Duplicate record throws error
    expect(() => recordCommandIntent(runRoot, "implementer", prepared.record)).toThrow(
      /already registered/,
    );
  });

  test("recordCommandIntent rejects gate bindings that overlap mutable task write scopes", async () => {
    const { runRoot, repo } = freshRun("scope-overlap");
    transact(runRoot, "setup", "set-tasks", {}, (draft) => {
      draft.tasks = {
        "task-1": { write_scope: ["src/file.ts"] },
      };
    });

    const prepared = await prepareCommand({
      argv: ["echo", "test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "coordinator",
      gateId: "gate-1",
      runRoot,
      repositoryRoot: repo,
    });

    const overlappingRecord: CommandRecord = {
      ...prepared.record,
      path_bindings: [
        {
          host_path: join(repo, "src", "file.ts"),
          sandbox_path: "/box/file.ts",
          relative_path: "src/file.ts",
          access: "ro",
          role: "control",
          scope: "repository",
        },
      ],
    };
    atomicWriteJson(join(runRoot, prepared.record.record_path), overlappingRecord, 0o600);

    expect(() => recordCommandIntent(runRoot, "coordinator", overlappingRecord)).toThrow(
      /repo-local gate control input overlaps a task mutable write scope/,
    );
  });

  test("reconcileCommandResult validates status and updates terminal record", async () => {
    const { runRoot, repo } = freshRun("reconcile-result");
    const prepared = await prepareCommand({
      argv: ["echo", "test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });

    recordCommandIntent(runRoot, "implementer", prepared.record);

    // Error on reconciling a running status
    expect(() => reconcileCommandResult(runRoot, "implementer", prepared.record)).toThrow(
      /cannot reconcile a running command/,
    );

    const execResult = await executePreparedCommand(prepared);

    // Mismatched intent (different task_id on record while intent had null)
    const mismatched = { ...execResult.record, task_id: "diff-task" };
    atomicWriteJson(join(runRoot, execResult.record.record_path), mismatched, 0o600);
    expect(() => reconcileCommandResult(runRoot, "implementer", mismatched)).toThrow(
      /terminal command does not match its intent/,
    );

    // Successful reconcile
    atomicWriteJson(join(runRoot, execResult.record.record_path), execResult.record, 0o600);
    reconcileCommandResult(runRoot, "implementer", execResult.record);
  });

  describe("reconcileStrandedCommands", () => {
    test("handles non-running stored commands and recovered stranded commands", async () => {
      const { runRoot, repo } = freshRun("reconcile-stranded");
      const prepared = await prepareCommand({
        argv: ["echo", "test"],
        cwd: repo,
        commandDir: join(runRoot, "commands"),
        actor: "implementer",
        runRoot,
        repositoryRoot: repo,
      });

      recordCommandIntent(runRoot, "implementer", prepared.record);

      // Execute on disk so it becomes terminal
      await executePreparedCommand(prepared);

      const res1 = reconcileStrandedCommands(runRoot, "implementer");
      expect(res1.reconciled).toEqual([prepared.record.id]);
      expect(res1.stranded).toEqual([]);

      // Running stored command that recovers from attempt evidence
      const { runRoot: run2, repo: repo2 } = freshRun("recover-running-stored");
      const prepared2 = await prepareCommand({
        argv: ["echo", "recover-running"],
        cwd: repo2,
        commandDir: join(run2, "commands"),
        actor: "implementer",
        runRoot: run2,
        repositoryRoot: repo2,
      });
      recordCommandIntent(run2, "implementer", prepared2.record);
      await executePreparedCommand(prepared2);
      // Reset aggregate record status back to running on disk to trigger recovery branch
      const recPath = join(run2, prepared2.record.record_path);
      atomicWriteJson(recPath, { ...prepared2.record, status: "running" }, 0o600);

      const res2 = reconcileStrandedCommands(run2, "implementer");
      expect(res2.reconciled).toEqual([prepared2.record.id]);
      expect(res2.stranded).toEqual([]);

      // Unrecoverable running command
      const { runRoot: run3, repo: repo3 } = freshRun("unrecoverable");
      const prepared3 = await prepareCommand({
        argv: ["echo", "unrec"],
        cwd: repo3,
        commandDir: join(run3, "commands"),
        actor: "implementer",
        runRoot: run3,
        repositoryRoot: repo3,
      });

      recordCommandIntent(run3, "implementer", prepared3.record);

      const res3 = reconcileStrandedCommands(run3, "implementer", {
        probeProcess: () => "running",
      });
      expect(res3.stranded).toEqual([prepared3.record.id]);
    });
  });

  describe("runAndRecordCommand", () => {
    test("executes prepared command, records intent, and reconciles terminal result", async () => {
      const { runRoot, repo } = freshRun("run-success");

      const result = await runAndRecordCommand(runRoot, {
        argv: ["echo", "ok"],
        cwd: repo,
        commandDir: join(runRoot, "commands"),
        actor: "implementer",
        repositoryRoot: repo,
      });

      expect(result.record.status).toBe("succeeded");
    });

    test("reconciles stranded commands on execute error and rethrows", async () => {
      const { runRoot, repo } = freshRun("run-error");

      let reconcileCount = 0;
      const fakeReconcile = (root: string, actor: string) => {
        reconcileCount += 1;
        return { reconciled: [], stranded: [] };
      };

      const fakeExecute = async () => {
        throw new Error("Execution crash");
      };

      await expect(
        runAndRecordCommand(
          runRoot,
          {
            argv: ["echo", "fail"],
            cwd: repo,
            commandDir: join(runRoot, "commands"),
            actor: "implementer",
            repositoryRoot: repo,
          },
          {
            execute: fakeExecute as never,
            reconcile: fakeReconcile as never,
          },
        ),
      ).rejects.toThrow("Execution crash");

      expect(reconcileCount).toBe(2); // once at start, once in catch block
    });
  });
});
