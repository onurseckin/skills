import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import {
  linkBlobIntoView,
  putBlobFile,
} from "../../../../../../olt/scripts/src/engine/store/layout/blobs.ts";
import { recordCaptures } from "../../../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../../fixtures/file-persistence-fixture.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../../../shared/chains/agent-supervisor-chain.ts";

import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});
afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("task:reject - Aliases, Captures and Screenshots", () => {
  test("--finding is accepted as an alias for --remediation", async () => {
    const { repo, run } = await setupCompiledRun("reject-remediation-alias", roots);
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
    await writeFile(`${repo}/tests/core/impl.ts`, "export const x = 2;\n");
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
      "broken",
      "--severity",
      "critical",
      "--finding",
      "use the alias instead",
      "--finding-id",
      "finding-custom-1",
      "--evidence",
      gateCmd.command_id as string,
    ]);
    expect(rejected.finding_id).toBe("finding-custom-1");
  });

  test("carries screenshots into rejection report and rejects unknown task id", async () => {
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
    await writeFile(`${repo}/tests/core/impl.ts`, "export const x = 3;\n");
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
    await writeFile(tmpScreenshot, "fake-png-bytes");
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
