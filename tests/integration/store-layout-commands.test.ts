import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import {
  reconcileCommandResult,
  recordCommandIntent,
} from "../../orchestrating-long-tasks/scripts/src/integration/record-command.ts";
import { initRun, loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyCapsuleLayout } from "../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function harness(): Promise<{ repo: string; run: string }> {
  const root = mkdtempSync(join(tmpdir(), "layout-commands-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const run = initRun(repo, "layout-commands", new TextEncoder().encode("prompt"), "file", true);
  return { repo, run };
}

function codes(run: string): string[] {
  return verifyCapsuleLayout(run).map((issue) => issue.code);
}

/** Runs one real command to a terminal status through the same path production uses. */
async function terminalCommand(repo: string, run: string): Promise<string> {
  const prepared = await prepareCommand({
    argv: ["bun", "--eval", "console.log('layout-commands')"],
    cwd: repo,
    runRoot: run,
    commandDir: join(run, "commands"),
    actor: "worker",
  });
  recordCommandIntent(run, "worker", prepared.record);
  const result = await executePreparedCommand(prepared);
  reconcileCommandResult(run, "worker", result.record);
  return result.record.id;
}

describe("commands/<id>/record.json is checked against the terminal command state", () => {
  test("a command that ran to completion through the harness raises nothing", async () => {
    const { repo, run } = await harness();
    await terminalCommand(repo, run);

    expect(codes(run)).toEqual([]);
  });

  test("editing the record after it settled is caught", async () => {
    const { repo, run } = await harness();
    const id = await terminalCommand(repo, run);
    const recordPath = join(run, "commands", id, "record.json");
    const record = JSON.parse(readFileSync(recordPath, "utf-8"));
    record.exit_code = 99;
    chmodSync(recordPath, 0o644);
    writeFileSync(recordPath, JSON.stringify(record), "utf-8");

    expect(codes(run)).toContain("COMMAND_RECORD_CONTENT");
  });

  test("a command still running is not compared against its evolving record", async () => {
    const { repo, run } = await harness();
    const prepared = await prepareCommand({
      argv: ["bun", "--eval", "console.log('still-running')"],
      cwd: repo,
      runRoot: run,
      commandDir: join(run, "commands"),
      actor: "worker",
    });
    recordCommandIntent(run, "worker", prepared.record);
    // The intent snapshot in state is frozen at "running"; the record on disk is free to move
    // (and does, as attempts land) without that being tampering.
    const recordPath = join(run, "commands", prepared.record.id, "record.json");
    const record = JSON.parse(readFileSync(recordPath, "utf-8"));
    record.attempts = [{ id: prepared.record.id, attempt: 1 }];
    chmodSync(recordPath, 0o644);
    writeFileSync(recordPath, JSON.stringify(record), "utf-8");

    expect(codes(run)).not.toContain("COMMAND_RECORD_CONTENT");
  });

  test("a minimal state entry with no record_path makes no disk claim this check can verify", () => {
    // A common shortcut elsewhere in this suite: state.commands is populated directly by a test that
    // is not about command execution at all. Without record_path, disk-before-state does not apply,
    // so the check is silent rather than treating an intentionally partial fixture as tampering.
    const root = mkdtempSync(join(tmpdir(), "layout-commands-"));
    roots.push(root);
    const repo = join(root, "repo");
    mkdirSync(repo);
    const run = initRun(
      repo,
      "layout-commands-minimal",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    transact(run, "coordinator", "plan-compiled", {}, (draft) => {
      draft.commands = { "C-1": { id: "C-1", status: "succeeded", exit_code: 0, task_id: "T-1" } };
    });

    expect(codes(run)).toEqual([]);
    expect(() => loadRun(run)).not.toThrow();
  });

  test("a command directory the state does not yet name is not flagged undeclared", async () => {
    // Unlike packets, a command's directory and record are written before the state commit that
    // would name them (`prepareCommand`, then `recordCommandIntent`), so an unreconciled directory is
    // an ordinary window, not evidence of tampering — there is deliberately no undeclared check here.
    const { repo, run } = await harness();
    await prepareCommand({
      argv: ["bun", "--eval", "console.log('reserved-only')"],
      cwd: repo,
      runRoot: run,
      commandDir: join(run, "commands"),
      actor: "worker",
    });

    expect(codes(run)).toEqual([]);
  });
});
