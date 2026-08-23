import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import { shouldReadPromptStdin } from "../../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";

const EXPECTED_INVOCATIONS = [
  "orchestrate",
  "plan:init",
  "init",
  "plan:enhance",
  "plan:add",
  "plan:audit",
  "plan:compile",
  "plan:validate-start",
  "plan:review",
  "plan:replan",
  "plan:claim",
  "plan:apply",
  "plan:status",
  "dag:view",
  "graph:ascii",
  "status:dag",
  "queue:next",
  "queue:list",
  "queue:wave",
  "queue:pop",
  "task:brief",
  "task:claim",
  "task:heartbeat",
  "task:submit",
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "task:assign-repairer",
  "task:abandon",
  "report",
  "report:unified",
  "report:all",
  "report:graph-json",
  "dag:export-json",
  "report:dag",
  "report:graph",
  "report:health",
  "report:leases",
  "report:decisions",
  "report:summary",
  "report:task",
  "stream:events",
  "events:stream",
  "events:tail",
  "dag:render",
  "graph:sugiyama",
  "report:sugiyama",
  "dag:trace",
  "trace:dag",
  "stream:trace",
  "run:exec",
  "run:status",
  "status",
  "run:complete",
  "critic:start",
  "critic:review",
  "critic:reject",
  "critic:remediate",
  "summary:export",
  "summary:view",
  "test:summary",
  "finding:get",
  "report:get",
  "evidence:get",
  "evidence:screenshots",
  "orchestrator:run",
  "orchestrator",
  "orchestrator:supervise",
  "branch:open",
  "branch:claim",
  "branch:submit",
  "branch:collect",
  "branch:abandon",
  "branch:status",
  "agent:brief",
  "agent:register",
  "agent:report",
  "agent:release",
  "agent:list",
  "orphan:dispose",
  "authority:decide",
  "whoami",
  "role:cheat-sheet",
  "role:contract",
  "role:cheat",
  "watchdog:status",
  "watchdog:list",
  "watchdog:cleanup",
  "watchdog:clean",
  "watchdog:phase-cleanup",
  "watchdog:phase-clean",
  "watchdog:cleanup-phase",
  "watchdog:verify",
  "watchdog:check",
  "watchdog:lint",
  "watchdog:probe",
  "watchdog:supervise",
  "watchdog:health-probe",
  "install",
  "installation-status",
  "blunder:audit",
  "coverage:check",
  "health",
  "doctor",
  "doctor:repair",
  "recover",
  "task:release",
  "worktree:reclaim",
  "explain",
  "gate:prove",
  "coordinator:pushback",
  "capture:init",
  "capture:run",
  "capture:eval",
  "memory:query",
  "memory:search",
  "mind:init",
  "mind:wake",
  "mind:pulse-open",
  "mind:pulse",
  "mind:observe",
  "mind:candidate",
  "mind:admit",
  "mind:decline",
  "mind:quiesce",
  "mind:escalate",
  "mind:halt",
  "mind:round-open",
  "mind:round-close",
  "mind:audit-start",
  "mind:audit-report",
  "mind:rotate",
  "feedback:list",
  "feedback:query",
  "feedback:status",
  "feedback:ingest",
  "feedback:add",
  "feedback:drain",
  "feedback:pop",
  "smart-task:plan",
  "task:synthesize",
  "smart-task:ingest",
  "smart-task:expand",
];

describe("CLI command registry", () => {
  test("exposes every command name and alias exactly once", () => {
    expect(commandInvocations()).toEqual(EXPECTED_INVOCATIONS);
    const names = COMMAND_REGISTRY.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("dispatches every registered invocation", async () => {
    for (const invocation of commandInvocations()) {
      // Every command rejects on an empty flag set, but never as an unknown command. `health`
      // alone declares no required flags, so left alone it would actually run its real,
      // multi-second structural scan against this harness's own source tree; pointing --scripts
      // at a plain directory makes it fail its own fast "no src directory" check instead, which
      // is still a rejection and still not "unknown command".
      const argv =
        invocation === "health"
          ? [invocation, "--scripts", tmpdir()]
          : invocation === "coverage:check"
            ? [invocation, "--dir", `${tmpdir()}/nonexistent-${Date.now()}`]
            : invocation === "capture:init"
              ? [invocation, "--config-dir", `${tmpdir()}/init-out-${Date.now()}`]
              : invocation === "capture:run"
                ? [invocation, "--out-dir", `${tmpdir()}/capture-out-${Date.now()}`]
                : invocation === "capture:eval"
                  ? [invocation, "--manifest", `${tmpdir()}/nonexistent-${Date.now()}.json`]
                  : [invocation];
      const failure = await execute(argv).then(
        () => new Error("resolved"),
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain("unknown command");
    }
  }, 120_000);

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
      "orchestrate",
      "plan:init",
      "orchestrator:run",
    ]);
    expect(shouldReadPromptStdin(["orchestrate", "--prompt-stdin"])).toBeTrue();
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
