import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { shellCommand } from "../../../../olt/scripts/src/cli/commands/shell.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  getAgentMetadataPath,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

let spawnSyncSpy: { mockRestore: () => void } | undefined;

function registerStandaloneActor(actor: string, role: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role,
      can_execute_shell: role === "implementer",
    }),
  );
}

describe("CLI Shell Interlock - Basic & Role Confinement", () => {
  beforeEach(() => {
    setupVirtualCliFS();
    enableInMemoryAgentMetadata();
  });

  afterEach(() => {
    if (spawnSyncSpy) {
      spawnSyncSpy.mockRestore();
      spawnSyncSpy = undefined;
    }
    disableInMemoryAgentMetadata();
    cleanupVirtualCliFS();
  });

  test("instantly blocks un-targeted whole-repo test run for implementer", async () => {
    registerStandaloneActor("imp-test", "implementer");
    let thrown: unknown;
    try {
      await shellCommand({ actor: "imp-test", role: "implementer" }, {}, ["bun", "test"]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HarnessError);
    const harnessErr = thrown as HarnessError;
    expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(harnessErr.message).toContain("[UNBOUNDED_TEST_RUNNER_FORBIDDEN]");
  });

  test("instantly blocks cognitive validator from running any shell commands", async () => {
    registerStandaloneActor("val-test", "validator");
    let thrown: unknown;
    try {
      await shellCommand({ actor: "val-test", role: "validator" }, {}, ["git", "status"]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(HarnessError);
    const harnessErr = thrown as HarnessError;
    expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(harnessErr.message).toContain(
      "[SHELL_COMMAND_FORBIDDEN] Role 'validator' is locked to 0 command execution by its diagnostic profile.",
    );
  });

  test("instantly blocks unshielded subshells and chaining attempts", async () => {
    registerStandaloneActor("imp-test", "implementer");
    let thrownSh: unknown;
    try {
      await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "sh",
        "-c",
        "echo pwned",
      ]);
    } catch (err) {
      thrownSh = err;
    }
    expect(thrownSh).toBeInstanceOf(HarnessError);
    expect((thrownSh as HarnessError).message).toContain("[UNSHIELDED_COMMAND_DEFECT]");

    let thrownChain: unknown;
    try {
      await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "git",
        "status",
        "&&",
        "echo",
        "chained",
      ]);
    } catch (err) {
      thrownChain = err;
    }
    expect(thrownChain).toBeInstanceOf(HarnessError);
    expect((thrownChain as HarnessError).message).toContain("[UNSHIELDED_COMMAND_DEFECT]");
  });

  test("refuses unknown capsule gate before recording command evidence", async () => {
    const repo = "/virtual/cli/unknown-gate-repo";
    mkdirSync(repo, { recursive: true });
    const runRoot = initRun(
      repo,
      "shell-unknown-gate",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    const port = workflowPort(runRoot);
    port.transact("test", "init-task", {}, (state) => {
      state.tasks["T-1"] = {
        id: "T-1",
        status: "claimed",
        requirement_ids: ["R-1"],
        write_scope: ["src/"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        bypass_cognitive_pushback: true,
        report: { summary: "test task" },
        validations: [],
      };
    });
    writeAgentMetadata(
      createAgentMetadata({
        agent_id: "impl-shell-unknown-gate",
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    await expect(
      shellCommand(
        {
          actor: "impl-shell-unknown-gate",
          role: "implementer",
          run: runRoot,
          task: "T-1",
          gate: "unknown-gate-id",
        },
        {},
        ["echo", "must-not-run"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(readdirSync(join(runRoot, "commands"))).toEqual([]);
  });

  test("formats stderr in standalone direct execution when command writes to stderr", async () => {
    registerStandaloneActor("imp-test", "implementer");
    spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation(((
      cmd: string,
      args?: string[],
    ) => {
      if (
        cmd === "git" &&
        args?.[0] === "show" &&
        args?.[1] === "nonexistent-commit-object-12345"
      ) {
        return {
          pid: 10003,
          output: [
            "",
            "",
            "fatal: ambiguous argument 'nonexistent-commit-object-12345': unknown revision or path not in the working tree.\n",
          ],
          stdout: "",
          stderr:
            "fatal: ambiguous argument 'nonexistent-commit-object-12345': unknown revision or path not in the working tree.\n",
          status: 128,
          signal: null,
          error: undefined,
        } as SpawnSyncReturns<string>;
      }
      return {
        pid: 10004,
        output: ["", "", ""],
        stdout: "",
        stderr: "",
        status: 0,
        signal: null,
        error: undefined,
      } as SpawnSyncReturns<string>;
    }) as never);

    const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
      "git",
      "show",
      "nonexistent-commit-object-12345",
    ]);

    expect(result.exit_code).not.toBe(0);
    expect(result.markdown).toContain("#### Stderr (last lines):");
  });

  test("refuses unknown standalone authority even when --role claims implementer", async () => {
    const actor = "impl-no-durable-grant";
    const metadataPath = getAgentMetadataPath(actor);
    expect(existsSync(metadataPath)).toBe(false);
    await expect(
      shellCommand({ actor, role: "implementer" }, {}, ["echo", "must-not-run"]),
    ).rejects.toMatchObject({ code: "ROLE_CONFINEMENT_VIOLATION" });
    expect(existsSync(metadataPath)).toBe(false);
  });

  test("treats --role only as a consistency assertion against durable metadata", async () => {
    registerStandaloneActor("impl-role-assertion", "implementer");
    await expect(
      shellCommand({ actor: "impl-role-assertion", role: "validator" }, {}, ["echo", "nope"]),
    ).rejects.toMatchObject({ code: "ROLE_CONFINEMENT_VIOLATION" });
  });
});
