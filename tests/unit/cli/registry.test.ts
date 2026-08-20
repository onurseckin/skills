import { describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import { shouldReadPromptStdin } from "../../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";

const EXPECTED_INVOCATIONS = [
  "plan:init",
  "init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:replan",
  "plan:status",
  "queue:next",
  "queue:list",
  "queue:wave",
  "queue:pop",
  "task:claim",
  "task:heartbeat",
  "task:submit",
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "run:exec",
  "run:status",
  "run:complete",
  "critic:start",
  "critic:review",
  "critic:reject",
  "summary:export",
  "summary:view",
  "finding:get",
  "report:get",
  "evidence:get",
  "evidence:screenshots",
  "orchestrator:run",
  "orchestrator",
  "branch:open",
  "branch:claim",
  "branch:submit",
  "branch:collect",
  "branch:abandon",
  "branch:status",
  "agent:register",
  "agent:report",
  "agent:release",
  "agent:list",
  "install",
  "installation-status",
  "health",
  "doctor",
  "recover",
  "task:release",
];

describe("CLI command registry", () => {
  test("exposes every command name and alias exactly once", () => {
    expect(commandInvocations()).toEqual(EXPECTED_INVOCATIONS);
    const names = COMMAND_REGISTRY.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("dispatches every registered invocation", async () => {
    for (const invocation of commandInvocations()) {
      // Every command rejects on an empty flag set, but never as an unknown command.
      const failure = await execute([invocation]).then(
        () => new Error("resolved"),
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain("unknown command");
    }
  });

  test("rejects a flag the command does not declare", async () => {
    await expect(execute(["plan:status", "--run", "/tmp/run", "--nope", "x"])).rejects.toThrow(
      "unknown option: --nope",
    );
  });

  test("declares well-formed specs", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(COMMAND_DOMAINS).toContain(spec.domain);
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.examples.length).toBeGreaterThan(0);
      expect(spec.exitCodes.length).toBeGreaterThan(0);
      const flagNames = spec.flags.map((flag) => flag.name);
      expect(new Set(flagNames).size).toBe(flagNames.length);
      for (const flag of spec.flags) expect(flag.description.length).toBeGreaterThan(0);
    }
  });

  test("accepts trailing -- arguments only where the spec allows them", async () => {
    expect(COMMAND_REGISTRY.filter((spec) => spec.takesRemainder).map((spec) => spec.name)).toEqual(
      ["run:exec"],
    );
    await expect(execute(["plan:status", "--run", "some-run", "--", "extra"])).rejects.toThrow(
      "command plan:status does not accept -- arguments",
    );
  });

  test("derives the prompt stdin rule from the registry", () => {
    expect(COMMAND_REGISTRY.filter((spec) => spec.readsStdin).map((spec) => spec.name)).toEqual([
      "plan:init",
      "orchestrator:run",
    ]);
    expect(shouldReadPromptStdin(["plan:init", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["orchestrator", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["run:status", "--prompt-stdin"])).toBeFalse();
    expect(shouldReadPromptStdin(["run:exec", "--", "--prompt-stdin"])).toBeFalse();
  });

  test("keeps the four previously unreachable commands wired", () => {
    for (const name of ["install", "installation-status", "recover", "doctor"]) {
      expect(findCommand(name)?.handler).toBeInstanceOf(Function);
    }
  });
});
