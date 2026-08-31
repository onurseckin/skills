import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
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
    enableInMemoryAgentMetadata();
  });

  afterEach(() => {
    disableInMemoryAgentMetadata();
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
    expect(harnessErr.message).toContain("Un-targeted whole-repo test run detected");
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
    expect(harnessErr.message).toContain("[COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN]");
    expect(harnessErr.message).toContain(
      "Cognitive Validators are locked to 0 command execution",
    );
  });

  test("instantly blocks unshielded subshells and chaining attempts", async () => {
    registerStandaloneActor("imp-test", "implementer");
    let thrownSh: unknown;
    try {
      await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
        "sh",
        "-c",
        "bun test",
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
    const { setupCompiledRun } = await import("../../commands/fixtures/task-ops-fixture.ts");
    const { run: runRoot } = await setupCompiledRun("shell-unknown-gate", []);
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
          task: "missing-task",
          gate: "G-1",
        },
        {},
        ["echo", "must-not-run"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(readdirSync(join(runRoot, "commands"))).toEqual([]);
  });

  test("formats stderr in standalone direct execution when command writes to stderr", async () => {
    registerStandaloneActor("imp-test", "implementer");
    const result = await shellCommand({ actor: "imp-test", role: "implementer" }, {}, [
      "git",
      "diff",
      "--no-index",
      "package.json",
      ".missing-shell-interlock-input",
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
