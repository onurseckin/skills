import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { coordinatorPushbackCommand } from "../../../../olt/scripts/src/cli/commands/coordinator-pushback.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

const TASK_ID = "task-1";

/**
 * Builds a real, on-disk capsule via the actual CLI (plan:init/plan:add/plan:compile), then
 * plants `task-1` directly at `validated` with one recorded pass — the same shortcut
 * `critic-ready-fixture.ts` takes for readiness state, in place of a full claim/submit/validate/
 * gate:prove round trip this command's own precondition (`status === "validated"`) does not need.
 */
async function setupValidatedRun(name: string): Promise<{ run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-coordpushback-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Fix the retry backoff in the queue worker");

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
    TASK_ID,
    "--label",
    "Queue retry backoff",
    "--scope",
    "src/backend",
    "--gate",
    "bun gate-check.ts",
    "--actor",
    "planner",
  ]);
  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);

  const port = workflowPort(run);
  port.transact("test-setup", "task-validated-for-test", { task_id: TASK_ID }, (draft) => {
    const task = draft.tasks[TASK_ID]!;
    task.status = "validated";
    task.original_implementer = "implementer-1";
    task.validations = [
      {
        validator_id: "validator-1",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: "2026-08-13T12:00:00.000Z",
        deadline_at: "2026-08-13T13:00:00.000Z",
        verdict: "pass",
      },
    ];
    task.history.push({
      at: "2026-08-13T12:00:00.000Z",
      actor: "validator-1",
      from: "validating",
      to: "validated",
      reason: "test setup",
      attempt: 0,
    });
  });

  return { run };
}

describe("coordinator:pushback CLI command", () => {
  test("is dispatchable and not an unknown command", async () => {
    const failure = await execute(["coordinator:pushback"]).then(
      () => new Error("resolved"),
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("unknown command");
  });

  test("procedural pushback reopens validation and persists to disk", async () => {
    const { run } = await setupValidatedRun("procedural");
    const result = coordinatorPushbackCommand({
      run,
      task: TASK_ID,
      actor: "coordinator-1",
      validator: "validator-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "the recorded pass carries no check evidence at all",
      remediation: "re-open validation and record real check evidence before passing again",
    });

    expect(String(result.markdown)).toContain("Coordinator Pushback Recorded");
    const task = result.task as { status: string; coordinator_pushbacks: unknown[] };
    expect(task.status).toBe("validating");
    expect(task.coordinator_pushbacks).toHaveLength(1);

    // Reload from disk independently of the returned in-memory result, to prove this actually
    // persisted rather than only mutating a local object the command happened to return.
    const reloaded = loadRun(run).state as unknown as {
      tasks: Record<string, { status: string; coordinator_pushbacks?: unknown[] }>;
    };
    expect(reloaded.tasks[TASK_ID]!.status).toBe("validating");
    expect(reloaded.tasks[TASK_ID]!.coordinator_pushbacks).toHaveLength(1);
  });

  test("substantive pushback returns the task for repair and persists to disk", async () => {
    const { run } = await setupValidatedRun("substantive");
    const result = coordinatorPushbackCommand({
      run,
      task: TASK_ID,
      actor: "coordinator-1",
      validator: "validator-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "the recorded check output shows the gate never actually ran",
      remediation: "fix the gate invocation and resubmit",
    });

    const task = result.task as { status: string; repair_assignee: string };
    expect(task.status).toBe("changes_requested");
    expect(task.repair_assignee).toBe("implementer-1");

    const reloaded = loadRun(run).state as unknown as {
      tasks: Record<string, { status: string }>;
    };
    expect(reloaded.tasks[TASK_ID]!.status).toBe("changes_requested");
  });

  test("refuses an unrecognized cause before touching state", async () => {
    const { run } = await setupValidatedRun("bad-cause");
    expect(() =>
      coordinatorPushbackCommand({
        run,
        task: TASK_ID,
        actor: "coordinator-1",
        validator: "validator-1",
        domain: "code-quality",
        cause: "vibes",
        observation: "x",
        remediation: "y",
      }),
    ).toThrow(/procedural.*substantive/);
    const reloaded = loadRun(run).state as unknown as {
      tasks: Record<string, { status: string }>;
    };
    expect(reloaded.tasks[TASK_ID]!.status).toBe("validated");
  });
});
