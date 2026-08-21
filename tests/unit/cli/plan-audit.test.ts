import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { parseAuditAcceptance } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan-audit.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function initRun(runId: string, prompt: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "harness-plan-audit-"));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    runId,
    "--prompt-file",
    promptPath,
  ]);
  return init.run_root as string;
}

async function addTask(
  run: string,
  id: string,
  scope: string,
  gate: string,
  extra: readonly string[] = [],
): Promise<void> {
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    id,
    "--label",
    id,
    "--scope",
    scope,
    "--gate",
    gate,
    "--actor",
    "planner",
    ...extra,
  ]);
}

describe("plan:audit", () => {
  test("refuses to audit an empty planning buffer", async () => {
    const run = await initRun("audit-empty", "Some goal");
    await expect(execute(["plan:audit", "--run", run, "--actor", "planner"])).rejects.toThrow(
      "cannot audit empty planning buffer",
    );
  });

  test("reports a clean plan with zero blocking findings and A2 not_evaluated", async () => {
    const run = await initRun("audit-clean", "First goal\n\nSecond goal");
    await addTask(run, "task-a", "src/a", "bun test tests/unit/a");
    await addTask(run, "task-b", "src/b", "bun test tests/unit/b");

    const audit = await execute(["plan:audit", "--run", run, "--actor", "planner"]);
    expect(audit.blocking_count).toBe(0);
    expect(audit.not_evaluated).toEqual([expect.objectContaining({ invariant: "A2-parallelism" })]);
    expect(String(audit.markdown)).toContain("no invariant violations found");
  });

  test("flags a whole-suite task gate and records the verdict as a capsule event", async () => {
    const run = await initRun("audit-a6", "First goal\n\nSecond goal");
    await addTask(run, "task-a", "src/a", "bun test");
    await addTask(run, "task-b", "src/b", "bun test tests/unit/b");

    const audit = await execute(["plan:audit", "--run", run, "--actor", "planner"]);
    expect(audit.blocking_count).toBe(1);
    const findings = audit.findings as Array<{ invariant: string; task_ids: string[] }>;
    expect(findings).toContainEqual(
      expect.objectContaining({ invariant: "A6-whole-suite-gate", task_ids: ["task-a"] }),
    );

    const events = loadRun(run).events;
    const auditEvent = events.find((e) => e.kind === "plan-audited");
    expect(auditEvent).toBeDefined();
    expect(auditEvent?.payload.blocking_count).toBe(1);
  });
});

describe("plan:compile blocks on the audit by default", () => {
  test("refuses to seal with an unaccepted A6-whole-suite-gate finding", async () => {
    const run = await initRun("compile-a6-blocks", "First goal\n\nSecond goal");
    await addTask(run, "task-a", "src/a", "bun test");
    await addTask(run, "task-b", "src/b", "bun test tests/unit/b");

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]),
    ).rejects.toThrow("A6-whole-suite-gate");
  });

  test("seals once every blocking invariant is explicitly accepted", async () => {
    const run = await initRun("compile-a6-accepted", "First goal\n\nSecond goal");
    // pytest (bare) is both looksWholeSuite (trips A6) and, unlike bare `bun test`, still passes
    // the compiler's own separate "substantive verification" gate policy — see
    // graph/gate-tool-grammar.ts's directTestRunner, which treats a bare pytest invocation as a
    // real (if broad) test run rather than a no-op. That lets this test prove the audit's override
    // actually reaches a sealed plan, not just that the throw goes away.
    await addTask(run, "task-a", "src/a", "pytest");
    await addTask(run, "task-b", "src/b", "bun test tests/unit/b");

    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
      "--accept-audit",
      "A6-whole-suite-gate:task-a genuinely needs the whole suite for this migration",
    ]);
    expect(compiled.revision).toBe(1);
  });

  // The forensics run (docs/planning/coordinator-conformance/FORENSICS.md §2.3): ten disjoint
  // domain tasks each gated by the identical whole-repo `bun run typecheck`. That command does not
  // trip A6 (looksWholeSuite requires a test-runner verb, not any repo-wide command — see
  // graph/plan-audit.test.ts), but the identical-gate-over-disjoint-scopes shape is exactly what
  // A3-gate-discrimination exists to catch, and it must refuse this plan without any flag.
  test("A3-gate-discrimination refuses the exact forensics shape: N disjoint tasks, one shared gate", async () => {
    const run = await initRun("compile-forensics-a3", "d1 goal\n\nd2 goal\n\nd3 goal");
    await addTask(run, "task-d1", "src/d1", "bun run typecheck");
    await addTask(run, "task-d2", "src/d2", "bun run typecheck");
    await addTask(run, "task-d3", "src/d3", "bun run typecheck");

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]),
    ).rejects.toThrow("A3-gate-discrimination");
  });

  test("--accept-audit for an invariant the audit did not raise is refused, not silently accepted", async () => {
    const run = await initRun("compile-wrong-accept", "First goal\n\nSecond goal");
    await addTask(run, "task-a", "src/a", "bun test tests/unit/a");
    await addTask(run, "task-b", "src/b", "bun test tests/unit/b");

    await expect(
      execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
        "--accept-audit",
        "A6-whole-suite-gate:nothing to accept here",
      ]),
    ).rejects.toThrow("which the audit did not raise as blocking");
  });
});

describe("parseAuditAcceptance", () => {
  test("requires the <invariant-id>:<reason> shape", () => {
    expect(() => parseAuditAcceptance("no-colon-here")).toThrow(
      'must be "<invariant-id>:<reason>"',
    );
  });

  test("rejects an unknown invariant id", () => {
    expect(() => parseAuditAcceptance("A9-invented:some reason")).toThrow(
      "names an unknown invariant",
    );
  });

  test("rejects a blank reason", () => {
    expect(() => parseAuditAcceptance("A6-whole-suite-gate:   ")).toThrow(
      "must carry a reason after the colon",
    );
  });

  test("accepts a well-formed acceptance", () => {
    expect(parseAuditAcceptance("A6-whole-suite-gate:this task legitimately needs it")).toEqual({
      invariant: "A6-whole-suite-gate",
      reason: "this task legitimately needs it",
    });
  });
});
