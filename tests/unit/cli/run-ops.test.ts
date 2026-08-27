import { describe, expect, test } from "bun:test";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
  runExecCommand,
} from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../olt/scripts/src/runtime/agent-metadata.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";

async function initializeRun(label: string): Promise<{ repo: string; runRoot: string }> {
  const repo = scratchRoot(import.meta.path, label);
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

function runFlags(runRoot: string, actor: string): Flags {
  return { run: runRoot, actor };
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
  });
});

describe("runExecCommand durable metadata authority", () => {
  test("refuses worker and impl actor names without an exact durable grant", async () => {
    const { runRoot } = await initializeRun("run-exec-missing-grant");
    for (const actor of ["worker-auto", "impl-auto"]) {
      const metadataPath = join(runRoot, "runtime", `agent-${actor}.json`);
      expect(existsSync(metadataPath)).toBe(false);
      await expect(
        runExecCommand(runFlags(runRoot, actor), {}, ["echo", "must-not-run"]),
      ).rejects.toMatchObject({
        code: "ROLE_CONFINEMENT_VIOLATION",
      });
      expect(existsSync(metadataPath)).toBe(false);
    }
  });

  test("allows an exact run-scoped metadata grant and refuses again after it is removed", async () => {
    const { runRoot } = await initializeRun("run-exec-grant-revocation");
    const actor = "impl-durable-grant";
    const metadataPath = writeAgentMetadata(
      createAgentMetadata({
        agent_id: actor,
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    const result = await runExecCommand(runFlags(runRoot, actor), {}, ["echo", "granted"]);
    expect(result.exit_code).toBe(0);
    expect(result.command_id).toBeDefined();

    rmSync(metadataPath);
    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "revoked"]),
    ).rejects.toMatchObject({
      code: "ROLE_CONFINEMENT_VIOLATION",
    });
  });

  test("propagates corrupt exact metadata as integrity failure without creating a fallback grant", async () => {
    const { runRoot } = await initializeRun("run-exec-corrupt-grant");
    const actor = "worker-corrupt-grant";
    const metadataPath = join(runRoot, "runtime", `agent-${actor}.json`);
    mkdirSync(join(runRoot, "runtime"), { recursive: true });
    writeFileSync(metadataPath, "not-json", "utf-8");

    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "corrupt"]),
    ).rejects.toMatchObject({
      code: "INTEGRITY",
    });
    expect(existsSync(metadataPath)).toBe(true);
  });

  test("authorizes a durable run grant against the target repository policy", async () => {
    const { repo, runRoot } = await initializeRun("run-exec-target-policy");
    const actor = "impl-target-policy";
    writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({ forbidden_commands: ["echo"] }),
    );
    writeAgentMetadata(
      createAgentMetadata({
        agent_id: actor,
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "forbidden"]),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
