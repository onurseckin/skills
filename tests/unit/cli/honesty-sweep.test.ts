import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { requirementIds, setupReadyRun } from "./critic-run-fixture.ts";
import {
  answeredBy,
  claimSubmitValidate,
  recordProbe,
  reviewPass,
  runGate,
  setupRun,
  TASK_ID,
  VALIDATOR,
} from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function events(run: string): Array<{ kind: string; payload: Record<string, unknown> }> {
  return readFileSync(join(run, "events.jsonl"), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; payload: Record<string, unknown> });
}

function runGates(run: string): Array<{ id: string; command: string[]; scope: string }> {
  const state = loadRun(run).state as unknown as {
    gates?: Array<{ id: string; command: string[]; scope: string }>;
    graph?: { gates?: Array<{ id: string; command: string[]; scope: string }> };
  };
  const gates = state.gates ?? state.graph?.gates ?? [];
  return gates.filter((gate) => gate.scope === "run");
}

describe("the run-completion gate is declared, never invented", () => {
  test("plan:compile refuses to compile without a declared completion gate", async () => {
    const { run } = await setupRun("completion-gate-required", roots);
    // The buffer is already compiled by the fixture, so a second compile would fail anyway; the
    // point here is that the missing flag is refused before anything else is considered.
    await expect(execute(["plan:compile", "--run", run, "--actor", "planner"])).rejects.toThrow(
      "--completion-gate is required",
    );
  });

  test("the recorded run gate is the command the caller declared", async () => {
    const { run } = await setupRun("completion-gate-recorded", roots);
    expect(runGates(run)).toEqual([
      expect.objectContaining({ id: "gate-run-completion", command: ["bun", "test", "tests"] }),
    ]);
  });
});

describe("A4-false-barrier blocks an unjustified dependency by default", () => {
  async function planWithUnjustifiedBarrier(runId: string): Promise<string> {
    const repo = realpathSync(await mkdtemp(join(tmpdir(), "harness-false-barrier-")));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "First goal\n\nSecond goal");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      runId,
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    for (const [id, scope, deps] of [
      ["task-a", "src/a", []],
      ["task-b", "src/b", ["task-a"]],
    ] as Array<[string, string, string[]]>) {
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
        `bun test ${scope}`,
        "--actor",
        "planner",
        ...(deps.length === 0 ? [] : ["--deps", deps.join(",")]),
        ...deps.flatMap((dep) => ["--dep-reason", `${dep}:fixture-declared ordering dependency`]),
      ]);
    }
    return run;
  }

  // task-b is serialized behind task-a for no scope reason — the exact shape plan:audit's
  // A4-false-barrier invariant exists to catch. Unlike the old --strict-parallel flag (opt-in,
  // and previously accepted without ever being read), this is fatal with no flag at all.
  test("plan:compile refuses to seal with no flag needed", async () => {
    const run = await planWithUnjustifiedBarrier("false-barrier-refused");
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
    ).rejects.toThrow("A4-false-barrier");
  });

  test("--accept-audit records an attributed override and lets the seal proceed", async () => {
    const run = await planWithUnjustifiedBarrier("false-barrier-accepted");
    const compiled = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
      "--accept-audit",
      "A4-false-barrier:task-b intentionally waits for task-a's rollout order",
    ]);
    expect(compiled.revision).toBe(1);
    const audit = compiled.audit as { blocking_count: number; accepted: { invariant: string }[] };
    expect(audit.blocking_count).toBe(1);
    expect(audit.accepted).toEqual([
      {
        invariant: "A4-false-barrier",
        reason: "task-b intentionally waits for task-a's rollout order",
      },
    ]);
  });

  test("--accept-audit for an invariant the audit did not raise is refused, not silently accepted", async () => {
    const run = await planWithUnjustifiedBarrier("false-barrier-wrong-accept");
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
        "A6-whole-suite-gate:not what actually blocked this plan",
      ]),
    ).rejects.toThrow("which the audit did not raise as blocking");
  });
});

describe("a recorded command says what it ran and how it ended", () => {
  test("command-recorded carries the argv and the exit code, not an empty payload", async () => {
    const { repo, run } = await setupRun("command-recorded-payload", roots);
    const executed = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    // The durable intent/reconcile protocol records "running" before the spawn and a terminal
    // reconciliation after, so a crash mid-command leaves recoverable evidence instead of nothing.
    const commandEvents = events(run).filter(
      (event) => event.kind === "command-intent-recorded" || event.kind === "command-reconciled",
    );
    expect(commandEvents.map((event) => event.kind)).toEqual([
      "command-intent-recorded",
      "command-reconciled",
    ]);
    expect(commandEvents.every((event) => event.payload.command_id === executed.command_id)).toBe(
      true,
    );

    const stored = (
      loadRun(run).state.commands as Record<
        string,
        { argv: string[]; status: string; exit_code: number | null }
      >
    )[executed.command_id as string];
    expect(stored).toMatchObject({
      argv: ["bun", "gate-core.ts"],
      status: "succeeded",
      exit_code: 0,
    });
  });

  test("run:exec demands an actor rather than attributing the command to the coordinator", async () => {
    const { repo, run } = await setupRun("exec-actor-required", roots);
    await expect(
      execute(["run:exec", "--run", run, "--cwd", repo, "--", "bun", "gate-core.ts"]),
    ).rejects.toThrow("--actor is required");
  });
});

describe("a failing verdict is the validator's own finding", () => {
  async function validating(name: string) {
    const { repo, run } = await setupRun(name, roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    return { repo, run, token, gateCmd };
  }

  function reviewArgv(run: string, token: string, gateCmd: string): string[] {
    return [
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      token,
      "--evidence",
      gateCmd,
      "--status",
      "fail",
    ];
  }

  test("severity and remediation are demanded, not composed", async () => {
    const { run, token, gateCmd } = await validating("review-fail-demands");
    await expect(execute(reviewArgv(run, token, gateCmd))).rejects.toThrow("--summary is required");
    await expect(
      execute([
        ...reviewArgv(run, token, gateCmd),
        "--summary",
        "The decoder skips the bound check",
      ]),
    ).rejects.toThrow("--severity is required");
    await expect(
      execute([
        ...reviewArgv(run, token, gateCmd),
        "--summary",
        "The decoder skips the bound check",
        "--severity",
        "critical",
      ]),
    ).rejects.toThrow("--remediation is required");
  });

  test("the recorded finding carries the validator's severity and remediation verbatim", async () => {
    const { run, token, gateCmd } = await validating("review-fail-verbatim");
    const rejected = await execute([
      ...reviewArgv(run, token, gateCmd),
      "--summary",
      "The decoder skips the bound check",
      "--severity",
      "minor",
      "--remediation",
      "Check the bound before the read and cover it in the gate",
    ]);

    expect(rejected.finding).toMatchObject({
      severity: "minor",
      observation: "The decoder skips the bound check",
      remediation: "Check the bound before the read and cover it in the gate",
    });
  });
});

describe("a claim names the role contract it binds to", () => {
  test("task:claim refuses to default the role", async () => {
    const { run } = await setupRun("claim-role-required", roots);
    await expect(
      execute(["task:claim", "--run", run, "--task", TASK_ID, "--agent", "worker-core"]),
    ).rejects.toThrow("--role is required");
  });
});

describe("a review file cannot certify its own capsule", () => {
  test("critic:review --review replaces the declared integrity evidence with the observation", async () => {
    const { repo, run } = await setupReadyRun("critic-review-file", roots);
    const inspect = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "critic-file",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-t1.ts",
    ]);
    const commandId = inspect.command_id as string;
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-file",
      "--repository-command-ids",
      commandId,
    ]);
    const assignment = start.critic as {
      readiness_sha256: string;
      repository_binding: Record<string, unknown>;
    };
    const evidence = [{ kind: "command", reference: commandId, observation: "gate covers it" }];
    // The payload lives outside the repository: writing it inside would change the very bytes the
    // critic authorization is bound to.
    const reviewRoot = await mkdtemp(join(tmpdir(), "harness-review-file-"));
    roots.push(reviewRoot);
    const reviewPath = join(reviewRoot, "completion-review.json");
    await writeFile(
      reviewPath,
      JSON.stringify({
        graph_revision: 1,
        status: "clean",
        readiness_sha256: assignment.readiness_sha256,
        repository_binding: assignment.repository_binding,
        // The file asserts a clean capsule. The harness measures one instead of believing this.
        integrity_evidence: [{ kind: "capsule_integrity", status: "passed", issues: [] }],
        repository_command_ids: [commandId],
        checks: [{ command_id: commandId }],
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: requirementIds(run).map((id) => ({
          requirement_id: id,
          status: "satisfied",
          evidence,
        })),
        residual_risks: [],
      }),
    );

    const review = await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-file",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--review",
      reviewPath,
      "--summary",
      "Whole diff verified against the run gate",
    ]);

    const recorded = review.completion_review as {
      integrity_evidence: Record<string, unknown>[];
    };
    expect(recorded.integrity_evidence).toHaveLength(1);
    expect(recorded.integrity_evidence[0]).toMatchObject({
      kind: "capsule_integrity",
      evidence_class: "harness_observed",
      status: "passed",
    });
    // The observation carries the head it measured; the declared blob never did.
    expect(recorded.integrity_evidence[0]?.event_head).toBeString();
  });
});

describe("a passing review reports the gate ledger, not a composed sentence", () => {
  test("the brief names the recorded gate run and its exit code", async () => {
    const { repo, run } = await setupRun("pass-gate-evidence", roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probe = await recordProbe(run, token, "Prove the gate covers the new branch");

    const review = await execute([
      ...reviewPass(run, token, gateCmd, answeredBy(probe.finding_ids, gateCmd)),
    ]);
    const markdown = String(review.markdown);
    // "(passed with exit code 0)" was composed, never read: it printed even for a task whose gate
    // had no recorded run at all.
    expect(markdown).not.toContain("passed with exit code 0");
    expect(markdown).toContain(`gate-core: ${gateCmd} exited 0`);
  });

  test("a pass without --summary files no summary rather than one the harness wrote", async () => {
    const { repo, run } = await setupRun("pass-no-summary", roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probe = await recordProbe(run, token, "Prove the gate covers the new branch");

    await execute([
      ...reviewPass(run, token, gateCmd, answeredBy(probe.finding_ids, gateCmd)).filter(
        (arg, index, all) => arg !== "--summary" && all[index - 1] !== "--summary",
      ),
    ]);
    const report = JSON.parse(
      readFileSync(join(run, "reports", `${TASK_ID}-review.json`), "utf-8"),
    ) as Record<string, unknown>;
    expect(report.verdict).toBe("pass");
    expect("summary" in report).toBe(false);
  });
});
