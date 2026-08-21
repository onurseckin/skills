import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

// C4: task:submit refuses a "done" claim whose write scope is byte-identical to its content at
// claim. This is the mechanism FORENSICS.md's central failure — eleven tasks claimed and submitted
// inside one second with no file mutation — would have refused outright.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setupRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-effort-evidence-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Implement the feature");
  await mkdir(join(repo, "src", "feature"), { recursive: true });
  await writeFile(join(repo, "gate.ts"), "console.log('gate ok');\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-1",
    "--label",
    "Feature task",
    "--scope",
    "src/feature",
    "--gate",
    "bun gate.ts",
    "--actor",
    "planner",
  ]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return { repo, run };
}

async function claimAndRecordEvidence(run: string, repo: string): Promise<string> {
  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    "task-1",
    "--agent",
    "worker-1",
    "--role",
    "implementer",
  ]);
  await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    "task-1",
    "--actor",
    "worker-1",
    "--cwd",
    repo,
    "--",
    "echo",
    "checked",
  ]);
  return claim.token as string;
}

describe("C4: task:submit refuses a submission that changed nothing", () => {
  test("a real submit with no file change is refused, naming the write scope", async () => {
    const { repo, run } = await setupRun("no-change");
    const token = await claimAndRecordEvidence(run, repo);

    // The exact forensic shape: --files-changed names a file, but nothing on disk actually moved.
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        token,
        "--files-changed",
        "src/feature/impl.ts",
        "--summary",
        "Implemented the feature",
      ]),
    ).rejects.toThrow(/src\/feature.*byte-identical/is);

    // Refused before any state change: the task is still leased, not submitted.
    expect(loadRun(run).state.tasks).toMatchObject({ "task-1": { status: "leased" } });
  });

  test("a real submit with an actual change is accepted", async () => {
    const { repo, run } = await setupRun("real-change");
    const token = await claimAndRecordEvidence(run, repo);

    await writeFile(join(repo, "src", "feature", "impl.ts"), "export const feature = true;\n");

    const result = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      token,
      "--files-changed",
      "src/feature/impl.ts",
      "--summary",
      "Implemented the feature",
    ]);

    expect((result.task as { status: string }).status).toBe("submitted");
  });

  test("--no-op with a reason is accepted against no change and recorded as an attributed state", async () => {
    const { repo, run } = await setupRun("declared-no-op");
    const token = await claimAndRecordEvidence(run, repo);

    const result = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--token",
      token,
      "--no-op",
      "--reason",
      "the feature was already implemented by a prior task's change",
      "--summary",
      "Investigated; no further change was needed",
    ]);

    const task = result.task as {
      status: string;
      no_op?: { reason: string; declared_by: string; at: string };
    };
    expect(task.status).toBe("submitted");
    expect(task.no_op).toEqual({
      reason: "the feature was already implemented by a prior task's change",
      declared_by: "worker-1",
      at: expect.any(String),
    });

    // Recorded in the event log too, not only in state — a reader of just events.jsonl must be able
    // to see the attribution without cross-referencing the projected state.
    const events = readFileSync(join(run, "events.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; payload: Record<string, unknown> });
    const submitted = events.find((event) => event.kind === "task-submitted");
    expect(submitted?.payload.no_op_reason).toBe(
      "the feature was already implemented by a prior task's change",
    );
  });

  test("an unexplained no-change submission is an error, never a silently inferred no-op", async () => {
    const { repo, run } = await setupRun("no-op-not-inferred");
    const token = await claimAndRecordEvidence(run, repo);

    // Same as the first test, but this is the point being made explicit: nothing about a bare
    // no-change submission is ever read as intentional. Only --no-op --reason is.
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        token,
        "--files-changed",
        "src/feature/impl.ts",
        "--summary",
        "Nothing needed to change",
      ]),
    ).rejects.toThrow(/byte-identical/);
  });

  test("--no-op is refused when --reason is missing, and --reason is refused without --no-op", async () => {
    const { repo, run } = await setupRun("no-op-flag-pairing");
    const token = await claimAndRecordEvidence(run, repo);

    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        token,
        "--no-op",
        "--summary",
        "Nothing needed to change",
      ]),
    ).rejects.toThrow(/--reason/);

    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        token,
        "--reason",
        "should not be accepted alone",
        "--files-changed",
        "src/feature/impl.ts",
        "--summary",
        "Nothing needed to change",
      ]),
    ).rejects.toThrow(/--no-op/);
  });

  test("the claim-time digest survives a reload of the capsule", async () => {
    const { repo, run } = await setupRun("survives-reload");
    const token = await claimAndRecordEvidence(run, repo);

    // The digest is on disk, not merely in the process's memory: reading state.json directly proves
    // it, independently of whatever object task:claim happened to return in this same process.
    const persisted = JSON.parse(readFileSync(join(run, "state.json"), "utf-8")) as {
      tasks: Record<string, { lease?: { write_scope_content_hash?: { value: string } } }>;
    };
    const digestOnDisk = persisted.tasks["task-1"]?.lease?.write_scope_content_hash?.value;
    expect(digestOnDisk).toBeString();
    expect(digestOnDisk).toMatch(/^[0-9a-f]{64}$/);

    // A fresh port, constructed after the on-disk read above — nothing here reuses a live reference
    // from the claim call — still resolves the same lease and still refuses an unchanged submission.
    const reloaded = workflowPort(run).read();
    expect(reloaded.tasks["task-1"]!.lease!.write_scope_content_hash!.value).toBe(digestOnDisk);

    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--token",
        token,
        "--files-changed",
        "src/feature/impl.ts",
        "--summary",
        "Implemented the feature",
      ]),
    ).rejects.toThrow(/byte-identical/);
  });
});
