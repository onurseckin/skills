import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import {
  reconcileStrandedCommands,
  runAndRecordCommand,
} from "../../../olt/scripts/src/integration/record-command.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/engine/runner/models/command/command-shape.ts";
import {
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_ARGV_BYTES,
} from "../../../olt/scripts/src/engine/runner/core/policy.ts";
import { tempRoot, cleanupTempRoots } from "./fixture.ts";

afterEach(cleanupTempRoots);

describe("command identity policy", () => {
  test("rejects blank actors, task IDs, and gate IDs before artifact mutation", async () => {
    const repositoryRoot = tempRoot("command-identity-policy");
    let observed = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observed = true;
        throw new Error("identity validation must precede observation");
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    const hostile = [
      { actor: "" },
      { actor: " \t " },
      { actor: "validator", taskId: "" },
      { actor: "validator", taskId: " \n " },
      { actor: "validator", gateId: "" },
      { actor: "validator", gateId: " \t " },
    ];

    for (const [index, identity] of hostile.entries()) {
      const runRoot = join(repositoryRoot, ".olt", "capsules", `run-${index}`);
      await mkdir(runRoot, { recursive: true });
      const commandDir = join(runRoot, "commands");
      await expect(
        runner.prepareCommand({
          argv: ["tool"],
          cwd: repositoryRoot,
          runRoot,
          commandDir,
          ...identity,
        } as never),
      ).rejects.toThrow(/actor|taskId|gateId|identity/i);
      expect(existsSync(commandDir)).toBeFalse();
    }
    expect(observed).toBeFalse();
  });

  test("rejects hostile identities before reconciliation or preparation", async () => {
    const repositoryRoot = tempRoot("command-entry-identity");
    let reconcileCalls = 0;
    let prepareCalls = 0;
    const hostile = [
      { actor: "" },
      { actor: " \t " },
      { actor: "validator", taskId: "" },
      { actor: "validator", taskId: " \n " },
      { actor: "validator", gateId: "" },
      { actor: "validator", gateId: " \t " },
    ];

    for (const [index, identity] of hostile.entries()) {
      const runRoot = join(repositoryRoot, `.capsules-invalid-${index}`);
      await expect(
        runAndRecordCommand(
          runRoot,
          {
            argv: ["tool"],
            cwd: repositoryRoot,
            commandDir: join(runRoot, "commands"),
            ...identity,
          } as never,
          {
            reconcile: (() => {
              reconcileCalls += 1;
              return { reconciled: [], stranded: [] };
            }) as never,
            prepare: (async () => {
              prepareCalls += 1;
              throw new Error("must not prepare");
            }) as never,
          },
        ),
      ).rejects.toThrow(/actor|taskId|gateId/i);
      expect(existsSync(runRoot)).toBeFalse();
    }
    expect(reconcileCalls).toBe(0);
    expect(prepareCalls).toBe(0);
  });

  test("validates recovery actor before reading the run store", () => {
    const absentRun = "/virtual/absent-command-recovery-" + Date.now();
    expect(() => reconcileStrandedCommands(absentRun, " \n ")).toThrow(/actor/i);
    expect(existsSync(absentRun)).toBeFalse();
  });

  test("rejects blank durable task and gate identities", async () => {
    const repositoryRoot = tempRoot("command-record-identity");
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    await mkdir(runRoot, { recursive: true });
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("non-gate preparation must not observe the repository");
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["tool"],
      cwd: repositoryRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });

    for (const [field, value, expected] of [
      ["task_id", " \t ", "command task id is invalid"],
      ["gate_id", " \n ", "command gate id is invalid"],
    ] as const) {
      const mutated = structuredClone(prepared.record);
      mutated[field] = value;
      expect(embeddedCommandIssues(mutated)).toContain(expected);
    }
  });

  test("bounds argv count and aggregate UTF-8 bytes before creating command artifacts", async () => {
    const repositoryRoot = tempRoot("command-argv-policy");
    const runRoot = join(repositoryRoot, ".olt", "capsules");
    await mkdir(runRoot, { recursive: true });
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("must not observe");
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    for (const [index, argv] of [
      Array.from({ length: MAX_COMMAND_ARGUMENTS + 1 }, () => "x"),
      ["tool", "é".repeat(Math.floor(MAX_COMMAND_ARGV_BYTES / 2) + 1)],
    ].entries()) {
      const commandDir = join(runRoot, `commands-${index}`);
      await expect(
        runner.prepareCommand({
          argv,
          cwd: repositoryRoot,
          runRoot,
          commandDir,
          actor: "validator",
        }),
      ).rejects.toThrow(/argv|argument|byte|limit/i);
      expect(existsSync(commandDir)).toBeFalse();
    }
  });
});
