import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
} from "../../../olt/scripts/src/cli/registry/index.ts";
import { shouldReadPromptStdin } from "../../../olt/scripts/src/cli/prompt-input.ts";
import { taskCheckCommand } from "../../../olt/scripts/src/cli/commands/task-check.ts";
import { reportUnifiedCommand } from "../../../olt/scripts/src/cli/commands/unified-reporting.ts";
import { summaryViewCommand } from "../../../olt/scripts/src/cli/commands/summary-ops.ts";
import { dagViewCommand } from "../../../olt/scripts/src/cli/commands/dag-view.ts";
import { autoDeriveCallerIdentity } from "../../../olt/scripts/src/authority/session/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const EXPECTED_INVOCATIONS: readonly string[] = `
  plan:brainstorm brainstorm orchestrate plan:init init plan:enhance plan:add plan:audit
  plan:compile plan:validate-start plan:review plan:replan plan:claim plan:apply plan:status
  queue:next queue:list queue:wave queue:pop task:brief task:claim task:heartbeat task:submit
  task:validate-start task:review task:probe task:reject task:assign-repairer task:abandon
  task:check task:add task:list task:lease task:complete task:fail task:prune
  report report:all report:graph-json dag:export-json report:dag report:graph
  report:health report:leases report:decisions report:summary report:task stream:events
  events:stream events:tail dag dag:render dag:view graph:sugiyama report:sugiyama
  graph:ascii status:dag dag:trace trace:dag stream:trace usage:report telemetry:usage
  quota:report quota:check quota:circuit-break circuit-breaker:check circuit-break
  quota:circuit-breaker quota:freeze quota:suspend freeze:quota quota:resume quota:unfreeze
  resume:quota skill:audit:live skill:audit notify:phase notify phase:notify notify:test
  test:notify run:init run:exec run:status status run:complete shell sh exec:safe
  scope:expand scope-expand critic:start critic:review critic:reject critic:remediate
  summary:export summary:view test:summary finding:get report:get evidence:get
  evidence:screenshots orchestrator:run orchestrator orchestrator:supervise branch:open
  branch:claim branch:submit branch:collect branch:abandon branch:status agent:register
  agent:report agent:release agent:list agent:brief agent:define orphan:dispose
  authority:decide whoami watchdog:status
  watchdog:list watchdog:cleanup watchdog:clean watchdog:phase-cleanup watchdog:phase-clean
  watchdog:cleanup-phase watchdog:verify watchdog:check watchdog:lint watchdog:probe
  watchdog:supervise watchdog:health-probe install installation-status defect:audit
  defects coverage:check health doctor doctor:repair doctor:certify recover
  task:release meta-audit finding:file finding explain gate:prove
  coordinator:pushback capture:init capture:run capture:eval memory:query memory:search
  mind:init mind:wake mind:pulse-open mind:pulse mind:observe mind:candidate mind:admit
  mind:decline mind:quiesce mind:escalate mind:halt mind:round-open mind:round-close
  mind:audit-start mind:audit-report mind:rotate smart-task:plan task:synthesize
  smart-task:ingest smart-task:expand mind:queue:list todo:list feedback:list
  mind:queue:add todo:add feedback:ingest feedback:add mind:queue:drain todo:drain
  feedback:drain mind:queue:seal todo:seal feedback:seal mind:queue:clean todo:clean
  feedback:clean mind:audit:live mind:audit policy:init policy:get policy:set
  policy:check-drift policy:drift factory:preplan mind:preplan preplan:run factory:status
  mind:factory:status preplan:status msg:send msg:recv msg:poll msg:list
  worktree:create worktree:land worktree:list worktree:clean worktree:status worktree:reclaim
  sched:eval sched:backoff sched:jitter
  role:list role:profile role:cheat-sheet role:contract role:cheat
  hygiene:audit hygiene:fix
  defect:record defect:resolve defect:list
`
  .trim()
  .split(/\s+/);

describe("CLI command registry", () => {
  test("declares a distinct authority run and Mind-only grant policy for governed mutations", () => {
    for (const name of [
      "mind:queue:drain",
      "mind:queue:seal",
      "mind:queue:clean",
      "watchdog:cleanup",
      "watchdog:phase-cleanup",
    ]) {
      const spec = findCommand(name);
      expect(spec?.authority).toEqual({
        requiresActingIdentity: true,
        authorityRunFlag: "authority-run",
        allowedRoles: ["mind"],
        constrainedPathFlags: expect.any(Array),
      });
      expect(spec?.flags.some((flag) => flag.name === "authority-run" && flag.required)).toBe(true);
    }
    expect(findCommand("mind:queue:list")?.authority).toBeUndefined();
    expect(findCommand("mind:queue:add")?.authority).toBeUndefined();
  });

  test("exposes every command name and alias exactly once", () => {
    expect(commandInvocations()).toEqual(EXPECTED_INVOCATIONS);
    const names = COMMAND_REGISTRY.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("dispatches every registered invocation", async () => {
    for (const invocation of commandInvocations()) {
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
      expect(spec.examples.length).toBeGreaterThanOrEqual(0);
      expect(spec.exitCodes.length).toBeGreaterThan(0);
      const flagNames = spec.flags.map((flag) => flag.name);
      expect(new Set(flagNames).size).toBe(flagNames.length);
      for (const flag of spec.flags) expect(flag.description.length).toBeGreaterThan(0);
    }
  });

  test("accepts trailing -- arguments only where the spec allows them", async () => {
    expect(COMMAND_REGISTRY.filter((spec) => spec.takesRemainder).map((spec) => spec.name)).toEqual(
      ["run:exec", "shell"],
    );
    await expect(execute(["plan:status", "--run", "some-run", "--", "extra"])).rejects.toThrow(
      "command plan:status does not accept -- arguments",
    );
  });

  test("derives the prompt stdin rule from the registry", () => {
    expect(COMMAND_REGISTRY.filter((spec) => spec.readsStdin).map((spec) => spec.name)).toEqual([
      "orchestrate",
      "plan:init",
      "run:init",
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

  test("task:check declares --actor so a caller can supply its real identity", () => {
    const spec = findCommand("task:check");
    expect(spec).toBeDefined();
    expect(spec?.flags.map((flag) => flag.name)).toContain("actor");
  });

  test("task:check never attributes an omitted --actor to a fabricated role-name literal", async () => {
    const repo = scratchRoot(import.meta.path, "task-check-actor-attribution-repo");
    const cleanPath = join(repo, "clean.ts");
    writeFileSync(cleanPath, "export const cleanVal = 10;\n");
    const runRoot = initRun(
      repo,
      "actor-attribution-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );

    const result = await taskCheckCommand({ file: cleanPath, run: runRoot, lint: true });
    expect(result.passed).toBe(true);

    const loaded = loadRun(runRoot);
    const receipts = (loaded.state.receipts ?? {}) as Record<string, Record<string, unknown>>;
    const receiptKeys = Object.keys(receipts);
    expect(receiptKeys.length).toBe(1);
    const receiptEntry = receipts[receiptKeys[0] as string];
    expect(receiptEntry?.actor).not.toBe("mechanic-validator");
    expect(receiptEntry?.actor).toBe(autoDeriveCallerIdentity().actor);
  });

  test("a declared --json flag actually changes what the handler returns, for every command this lane owns", () => {
    const repo = scratchRoot(import.meta.path, "declared-json-flag-is-live-repo");
    const run = initRun(
      repo,
      "declared-json-flag-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );

    const liveJsonCommands: {
      name: string;
      handler: (flags: Record<string, unknown>) => Record<string, unknown>;
    }[] = [
      { name: "report", handler: reportUnifiedCommand },
      { name: "report:summary", handler: summaryViewCommand },
      { name: "dag", handler: dagViewCommand },
    ];

    for (const { name, handler } of liveJsonCommands) {
      const spec = findCommand(name);
      expect(spec?.flags.map((flag) => flag.name)).toContain("json");

      const withoutFlag = handler({ run });
      const withFlag = handler({ run, json: true });
      expect(withoutFlag["json"]).not.toBe(true);
      expect(withFlag["json"]).toBe(true);
    }
  });

  test("removes --json from commands whose handler never read it, instead of leaving a flag that silently does nothing", () => {
    const deadJsonCommands = [
      "whoami",
      "role:cheat-sheet",
      "watchdog:status",
      "watchdog:cleanup",
      "watchdog:phase-cleanup",
      "watchdog:verify",
      "watchdog:probe",
      "mind:queue:list",
      "mind:queue:add",
      "mind:queue:drain",
      "mind:queue:seal",
      "mind:queue:clean",
      "report:task",
      "dag:trace",
    ];
    for (const name of deadJsonCommands) {
      const spec = findCommand(name);
      expect(spec).toBeDefined();
      expect(spec?.flags.map((flag) => flag.name)).not.toContain("json");
    }

    const memoryQuerySpec = findCommand("memory:query");
    expect(memoryQuerySpec?.flags.map((flag) => flag.name)).not.toContain("json");
    expect(memoryQuerySpec?.flags.map((flag) => flag.name)).not.toContain("format");
  });
});
