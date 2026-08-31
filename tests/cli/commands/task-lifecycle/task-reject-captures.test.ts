import { describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  linkBlobIntoView,
  putBlobFile,
} from "../../../../olt/scripts/src/engine/store/layout/blobs.ts";
import { recordCaptures } from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { setupCompiledRun } from "../fixtures/file-persistence-fixture.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../shared/agent-supervisor-chain.ts";

const roots: string[] = [];

describe("task:reject - Captures, Screenshots & Target Scope", () => {
  test("carries screenshots already captured for the task into the rejection report", async () => {
    const { repo, run } = await setupCompiledRun("reject-with-screenshots", roots);
    const chain = await establishSupervisorChain(run);
    await registerUnderChain(
      run,
      chain,
      "worker-1",
      "implementer",
      "antigravity",
      undefined,
      "task-core",
    );
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    await Bun.write(`${repo}/tests/core/impl.ts`, "export const x = 3;\n");
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "worker-1",
      "--cwd",
      repo,
      "--",
      "echo",
      "implementer-work",
    ]);
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      "task-core",
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
      "--files-changed",
      "tests/core/impl.ts",
      "--summary",
      "did the work",
    ]);
    await registerUnderChain(
      run,
      chain,
      "val-1",
      "validator",
      "antigravity",
      undefined,
      "task-core",
    );
    const val = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
    ]);

    const gateCmd = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--gate",
      "gate-core",
      "--actor",
      "worker-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    const tmpScreenshot = `${repo}/before-reject.png`;
    await Bun.write(tmpScreenshot, "fake-png-bytes");
    const blob = putBlobFile(run, tmpScreenshot);
    const view = linkBlobIntoView(run, blob, "evidence", "before-reject.png");
    recordCaptures(run, [
      {
        kind: "screenshot",
        name: "before-reject.png",
        sha256: blob.sha256,
        bytes: blob.bytes,
        blob_path: blob.path,
        path: view.view_path,
        storage: view.storage,
        original_path: tmpScreenshot,
        task_id: "task-core",
        actor: "val-1",
      },
    ]);

    const rejected = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "val-1",
      "--token",
      val.token as string,
      "--reason",
      "layout regression",
      "--severity",
      "critical",
      "--remediation",
      "fix the layout",
      "--evidence",
      gateCmd.command_id as string,
    ]);

    expect(rejected.screenshots).toEqual(["evidence/before-reject.png"]);
    const records = rejected.screenshot_records as Array<{ name: string }>;
    expect(records).toHaveLength(1);
    const firstRecord = records[0];
    if (!firstRecord) {
      throw new Error("expected at least one screenshot record");
    }
    expect(firstRecord.name).toBe("before-reject.png");
  });

  test("refuses an unknown task id", async () => {
    const { run } = await setupCompiledRun("reject-unknown-task", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "val-1",
      "--role",
      "validator",
      "--host",
      "antigravity",
      "--parent-task",
      "task-core",
    ]);
    await expect(
      execute([
        "task:reject",
        "--run",
        run,
        "--task",
        "task-ghost",
        "--validator",
        "val-1",
        "--token",
        "whatever",
        "--reason",
        "x",
        "--severity",
        "minor",
        "--remediation",
        "y",
      ]),
    ).rejects.toThrow(/unknown task task-ghost/);
  });
});
