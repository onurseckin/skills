import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  runExecCommand,
  runStatusCommand,
} from "../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import {
  clearInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { generateDefaultRepoPolicy } from "../../../../olt/scripts/src/policy/repo-policy.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
beforeEach(() => {
  enableInMemoryAgentMetadata();
});

afterEach(() => {
  disableInMemoryAgentMetadata();
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

async function initializeRun(label: string): Promise<{ repo: string; runRoot: string }> {
  const repo = mkdtempSync(join(tmpdir(), `run-ops-status-${label}-`));
  roots.push(repo);
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

describe("runStatusCommand", () => {
  test("reports detailed status across all possible task states and occupancy metrics", async () => {
    const { runRoot, repo } = await initializeRun("run-status-full");

    transact(runRoot, "coordinator", "setup-various-tasks", {}, (draft) => {
      draft.graph = { revision: 1 };
      draft.tasks = {
        "T-DONE": {
          id: "T-DONE",
          status: "done",
          label: "Completed Task",
          write_scope: ["src/done.ts"],
        },
        "T-SUBMITTED": {
          id: "T-SUBMITTED",
          status: "submitted",
          label: "Submitted Task",
          original_implementer: "worker-impl",
          write_scope: ["src/sub.ts"],
        },
        "T-LEASED": {
          id: "T-LEASED",
          status: "leased",
          label: "Leased Task",
          write_scope: ["src/leased.ts"],
          lease: {
            agent_id: "worker-1",
            role: "implementer",
          },
        },
        "T-VAL-ACTIVE": {
          id: "T-VAL-ACTIVE",
          status: "validating",
          label: "Active Validation Task",
          write_scope: ["src/val.ts"],
          validations: [
            {
              validator_id: "val-1",
              domain: "quality",
            },
          ],
        },
        "T-VAL-DONE": {
          id: "T-VAL-DONE",
          status: "validating",
          label: "Finished Validation Task",
          write_scope: ["src/val2.ts"],
          validations: [
            {
              validator_id: "val-2",
              domain: "security",
              verdict: "pass",
            },
          ],
        },
        "T-VAL-PENDING": {
          id: "T-VAL-PENDING",
          status: "validating",
          label: "Pending Probe Task",
          write_scope: ["src/val3.ts"],
          validations: [],
        },
        "T-READY": {
          id: "T-READY",
          status: "ready",
          label: "Ready Task",
          write_scope: ["src/ready.ts"],
        },
        "T-PROPOSED": {
          id: "T-PROPOSED",
          status: "proposed",
          label: "Blocked Task",
          write_scope: ["src/prop.ts"],
        },
        "T-REPAIR": {
          id: "T-REPAIR",
          status: "changes_requested",
          label: "Repair Task",
          write_scope: ["src/repair.ts"],
        },
        "T-UNKNOWN": {
          id: "T-UNKNOWN",
          status: "custom_status",
          label: "Unknown Status Task",
          write_scope: ["src/unk.ts"],
        },
      };
    });

    const statusRes = runStatusCommand({
      repo,
      run: runRoot,
      detailed: true,
    });

    expect(statusRes.run_root).toBe(runRoot);
    expect(statusRes.detailed).toBe(true);
    expect(statusRes.occupancy).toBeDefined();
    expect(String(statusRes.markdown)).toContain("Completed");
    expect(String(statusRes.markdown)).toContain("Leased");
    expect(String(statusRes.markdown)).toContain("Validating");
    expect(String(statusRes.markdown)).toContain("Standby (Ready)");
    expect(String(statusRes.markdown)).toContain("Repair Required");
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

    if (existsSync(metadataPath)) rmSync(metadataPath);
    clearInMemoryAgentMetadata();
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
    enableInMemoryAgentMetadata({ [metadataPath]: "not-json" });

    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "corrupt"]),
    ).rejects.toMatchObject({
      code: "INTEGRITY",
    });
  });

  test("authorizes a durable run grant against the target repository policy", async () => {
    const { repo, runRoot } = await initializeRun("run-exec-target-policy");
    const actor = "impl-target-policy";
    writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({ ...generateDefaultRepoPolicy(repo), forbidden_commands: ["echo"] }),
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

  test("supports custom cwd, tool flags, and command result capture", async () => {
    const { repo, runRoot } = await initializeRun("run-exec-cwd-flags");
    const actor = "impl-cwd-flags";
    grantShellExecution(runRoot, actor);

    const res = await runExecCommand(
      {
        ...runFlags(runRoot, actor),
        cwd: repo,
        tool: "shell",
        "tool-category": "system",
      },
      {},
      ["echo", "cwd test"],
    );

    expect(res.exit_code).toBe(0);
    expect(res.evidence).toBeDefined();
    expect(String(res.markdown)).toContain("echo cwd test");
  });
});
