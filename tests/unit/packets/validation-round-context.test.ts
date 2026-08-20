import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunState } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  assertNoConclusions,
  priorRoundDemands,
  validatorTaskContract,
} from "../../../orchestrating-long-tasks/scripts/src/packets/prior-round-demands.ts";
import { renderValidationRound } from "../../../orchestrating-long-tasks/scripts/src/packets/render-validation-round.ts";
import type { RepositoryGitCommand } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import { taskCommandEvidence } from "../../../orchestrating-long-tasks/scripts/src/packets/round-commands.ts";
import {
  anchoredDiff,
  diffAnchor,
} from "../../../orchestrating-long-tasks/scripts/src/packets/round-repository-delta.ts";
import { validationRoundContext } from "../../../orchestrating-long-tasks/scripts/src/packets/validation-round.ts";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { commandRecord, workflowState } from "../workflow/test-port.ts";
import { inspection } from "./inspection-fixture.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const DIFF = "diff --git a/src/owned/a.ts b/src/owned/a.ts\n+const fixed = true;\n";
const REVALIDATION = "bun test tests/unit/owned/a.test.ts";
const OBSERVATION = "the empty payload path is unhandled";

function finding(overrides: JsonObject = {}): JsonObject {
  return {
    id: "F-1",
    requirement_id: "R-1",
    severity: "critical",
    class: "defect",
    observation: OBSERVATION,
    remediation: "handle the empty payload before the insert",
    revalidation: REVALIDATION,
    evidence: [{ path: "src/owned/a.ts", observation: "line 12 drops the row" }],
    status: "open",
    resolved_by: "validator-r1",
    ...overrides,
  };
}

function rejectedTask(state: WorkflowState): TaskRecord {
  const task = state.tasks["T-1"]!;
  Object.assign(task, {
    status: "submitted",
    repair_round: 1,
    original_implementer: "worker",
    findings: [finding()],
    gate_results: [{ gate_id: "G-1", command_id: "C-gate", status: "passed" }],
    validation_history: [
      {
        validator_id: "validator-r1",
        token_digest: "a".repeat(64),
        attempt: 1,
        started_at: "2026-08-13T12:05:00.000Z",
        deadline_at: "2026-08-13T12:25:00.000Z",
        verdict: "reject",
      },
    ],
    history: [
      {
        at: "2026-08-13T12:10:00.000Z",
        actor: "validator-r1",
        from: "validating",
        to: "changes_requested",
        reason: "validator requested changes",
        attempt: 1,
      },
    ],
  });
  return task;
}

const capsuleState = (): RunState => ({
  schema: "harness.state",
  version: 1,
  revision: 4,
  event_sequence: 4,
  event_head: null,
  repository_inspections: {
    older: inspection("current", "2026-08-13T12:04:00.000Z"),
    early: inspection("current", "2026-08-13T12:06:00.000Z"),
    late: inspection("current", "2026-08-13T12:30:00.000Z"),
  },
});

const gitReturning =
  (text: string): RepositoryGitCommand =>
  () => ({
    status: 0,
    bytes: Buffer.from(text, "utf8"),
  });

function contextWith(root: string): JsonObject {
  return {
    baseline_repository_state: { ...inspection("baseline"), repository_root: root },
    current_repository_state: {
      ...inspection("current", "2026-08-13T12:31:00.000Z"),
      repository_root: root,
      repository_content_sha256: "f".repeat(64),
    },
  };
}

async function capsuleWithLog(name: string, text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `harness-round-${name}-`));
  roots.push(root);
  await mkdir(join(root, "commands/C-gate/attempts/1"), { recursive: true });
  await writeFile(join(root, "commands/C-gate/attempts/1/stdout.log"), text);
  return root;
}

describe("the round-N record carries facts and demands", () => {
  test("round 1 is handed nothing extra", () => {
    const state = workflowState();
    const root = "/repo";
    expect(
      validationRoundContext({
        runRoot: root,
        runState: capsuleState(),
        state,
        task: state.tasks["T-1"]!,
        context: contextWith(root),
        git: gitReturning(DIFF),
      }),
    ).toBeUndefined();
  });

  test("round 2 carries the demands, the recorded commands and both anchored diffs", async () => {
    const runRoot = await capsuleWithLog("round-two", "1 pass 0 fail\n");
    const state = workflowState();
    state.commands["C-gate"] = commandRecord("C-gate", { actor: "worker", task_id: "T-1" });
    state.commands["C-other"] = commandRecord("C-other", { actor: "worker", task_id: "T-2" });
    const task = rejectedTask(state);
    const round = validationRoundContext({
      runRoot,
      runState: capsuleState(),
      state,
      task,
      context: contextWith(runRoot),
      now: new Date("2026-08-13T12:40:00.000Z"),
      git: gitReturning(DIFF),
    })!;

    expect(round.round).toBe(2);
    expect(round.previous_round).toEqual({
      round: 1,
      started_at: "2026-08-13T12:05:00.000Z",
      ended_at: "2026-08-13T12:10:00.000Z",
    });
    expect(round.prove_these_hold).toEqual([
      {
        demand_id: "F-1",
        requirement_id: "R-1",
        prove: REVALIDATION,
        look_at: [{ path: "src/owned/a.ts" }],
      },
    ]);
    // Only the task's own commands, and the output is the bytes the run wrote to disk.
    expect(round.commands_already_run).toHaveLength(1);
    const [command] = round.commands_already_run;
    expect(command!.command_id).toBe("C-gate");
    expect(command!.exit_code).toBe(0);
    expect(command!.stdout).toEqual({ text: "1 pass 0 fail", truncated: false });
    expect(round.gates).toEqual([
      {
        gate_id: "G-1",
        command: ["bun", "test", "tests/unit/runner/output-evidence.test.ts"],
        mandatory: true,
        recorded_pass: { command_id: "C-gate" },
      },
    ]);
    const delta = round.repository_delta as JsonObject;
    const since = delta.since_previous_round as JsonObject;
    expect((delta.full as JsonObject).text).toBe(DIFF);
    // The anchor is the inspection taken inside the previous round, not the newest one.
    expect((since.anchor as JsonObject).captured_at).toBe("2026-08-13T12:06:00.000Z");
    expect(since.recorded_change).toEqual({
      content_sha256_changed: true,
      file_count: { before: 2, after: 2 },
      total_bytes: { before: 128, after: 128 },
    });
  });

  test("a repository the packet cannot locate yields no diff rather than an invented one", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    const round = validationRoundContext({
      runRoot: "/missing",
      runState: capsuleState(),
      state,
      task,
      context: { current_repository_state: {}, baseline_repository_state: {} },
      git: gitReturning(DIFF),
    })!;
    expect(round.repository_delta).toEqual({});
    expect(round.commands_already_run).toEqual([]);
  });

  test("an anchor with no recorded commit says so instead of measuring something else", () => {
    const withoutGit = { ...inspection("baseline"), git: { available: false } };
    const diff = anchoredDiff("/repo", diffAnchor(withoutGit), new Date(), gitReturning(DIFF));
    expect(diff.unavailable).toBe("the anchor inspection recorded no commit");
    expect(diff.text).toBeUndefined();
  });

  test("a Git failure is reported as the reason there is no diff", () => {
    const failing: RepositoryGitCommand = () => {
      throw new HarnessError("INTEGRITY", "repository Git command failed: not a repository");
    };
    const diff = anchoredDiff("/repo", diffAnchor(inspection("baseline")), new Date(), failing);
    expect(diff.unavailable).toBe("repository Git command failed: not a repository");
    expect(diff.argv).toContain("diff");
  });

  test("a long log is carried as its tail and says that is what it is", async () => {
    const runRoot = await capsuleWithLog("long-log", `${"noise\n".repeat(200)}final line\n`);
    const state = workflowState();
    state.commands["C-gate"] = commandRecord("C-gate", { actor: "worker", task_id: "T-1" });
    const [command] = taskCommandEvidence(runRoot, state, "T-1", 64);
    expect(command!.stdout!.truncated).toBe(true);
    expect(command!.stdout!.text.endsWith("final line")).toBe(true);
  });

  test("a command that records logs only on its attempt is still read", async () => {
    const runRoot = await capsuleWithLog("attempt-log", "attempt output\n");
    const state = workflowState();
    const record = commandRecord("C-gate", { actor: "worker", task_id: "T-1" });
    delete (record as { logs?: unknown }).logs;
    state.commands["C-gate"] = record;
    const [command] = taskCommandEvidence(runRoot, state, "T-1");
    expect(command!.stdout).toEqual({ text: "attempt output", truncated: false });
  });

  test("a diff longer than the packet ceiling is cut and flagged", () => {
    const huge = `${"+".repeat(300 * 1024)}\n`;
    const diff = anchoredDiff(
      "/repo",
      diffAnchor(inspection("baseline")),
      new Date(),
      gitReturning(huge),
    );
    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(diff.text as string, "utf8")).toBe(256 * 1024);
  });

  test("the gate carries the run bound to it and the pass already on record", () => {
    const state = workflowState();
    state.commands["C-gate"] = commandRecord("C-gate", { actor: "validator-r1", task_id: "T-1" });
    const task = rejectedTask(state);
    const round = validationRoundContext({
      runRoot: "/missing",
      runState: capsuleState(),
      state,
      task,
      context: { current_repository_state: {}, baseline_repository_state: {} },
    })!;
    expect((round.gates[0] as JsonObject).latest_run).toEqual({
      command_id: "C-gate",
      exit_code: 0,
      finished_at: "2026-08-13T12:00:01.000Z",
      actor: "validator-r1",
    });
  });

  test("with no transition out of validation the previous round's start is the anchor", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    task.history = [];
    const round = validationRoundContext({
      runRoot: "/missing",
      runState: capsuleState(),
      state,
      task,
      context: contextWith("/repo"),
      git: gitReturning(DIFF),
    })!;
    expect(round.previous_round).toEqual({ round: 1, started_at: "2026-08-13T12:05:00.000Z" });
    const since = (round.repository_delta as JsonObject).since_previous_round as JsonObject;
    expect((since.anchor as JsonObject).captured_at).toBe("2026-08-13T12:04:00.000Z");
  });

  test("no inspection old enough to anchor the delta leaves it absent", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    const runState = capsuleState();
    runState.repository_inspections = { late: inspection("current", "2026-08-13T12:30:00.000Z") };
    const round = validationRoundContext({
      runRoot: "/missing",
      runState,
      state,
      task,
      context: contextWith("/repo"),
      git: gitReturning(DIFF),
    })!;
    const delta = round.repository_delta as JsonObject;
    expect(delta.since_previous_round).toBeUndefined();
    expect((delta.full as JsonObject).text).toBe(DIFF);
  });

  test("a round with nothing recorded yet says so rather than showing an empty list", () => {
    const markdown = renderValidationRound({
      round: 2,
      previous_round: { round: 1 },
      prove_these_hold: [],
      commands_already_run: [],
      gates: [],
      repository_delta: {},
    });
    expect(markdown).toContain("No demand from an earlier round stands on the record.");
    expect(markdown).toContain("This run has recorded no command against this task.");
    expect(markdown).toContain("The previous round is round 1.");
  });

  test("a log the capsule no longer holds is absent, not empty", async () => {
    const runRoot = await capsuleWithLog("missing-log", "");
    const state = workflowState();
    state.commands["C-gone"] = commandRecord("C-gone", { actor: "worker", task_id: "T-1" });
    const [command] = taskCommandEvidence(runRoot, state, "T-1");
    expect(command!.command_id).toBe("C-gone");
    expect(command!.stdout).toBeUndefined();
  });
});

describe("a prior round enters the packet as a demand and never as a conclusion", () => {
  test("the demand keeps the check and drops the diagnosis", () => {
    const state = workflowState();
    const demands = priorRoundDemands(rejectedTask(state));
    const rendered = JSON.stringify(demands);
    expect(rendered).toContain(REVALIDATION);
    for (const conclusion of [OBSERVATION, "critical", "defect", "line 12 drops the row"]) {
      expect(rendered).not.toContain(conclusion);
    }
  });

  test("a probe demand asks for its own demand text, with the check that settles it", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    const demanded = "Prove the gate still fails when the fix is reverted";
    task.findings = [
      finding({
        id: "probe-1",
        class: "probe_demand",
        severity: "minor",
        observation: demanded,
        revalidation: "Cite a command id that proves this for T-1",
        evidence: [{ kind: "demand", detail: demanded, evidence_class: "agent_reported" }],
        probe_round: 1,
      }),
    ] as TaskRecord["findings"];
    expect(priorRoundDemands(task)).toEqual([
      {
        demand_id: "probe-1",
        requirement_id: "R-1",
        prove: demanded,
        prove_by: "Cite a command id that proves this for T-1",
        look_at: [{ kind: "demand", evidence_class: "agent_reported" }],
        probe_round: 1,
      },
    ]);
  });

  test("a defect that cites no command does not smuggle its diagnosis through the evidence", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    task.findings = [
      finding({ evidence: [{ kind: "failure", detail: OBSERVATION }] }),
    ] as TaskRecord["findings"];
    const [demand] = priorRoundDemands(task);
    expect(JSON.stringify(demand)).not.toContain(OBSERVATION);
    expect(demand!.look_at).toEqual([{ kind: "failure" }]);
  });

  test("a finding with no recorded check cannot become a demand", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    task.findings = [finding({ revalidation: "  " })] as TaskRecord["findings"];
    expect(() => priorRoundDemands(task)).toThrow(HarnessError);
  });

  test("the validator's task contract loses the verdicts and keeps the facts", () => {
    const state = workflowState();
    const task = rejectedTask(state);
    const contract = validatorTaskContract(structuredClone(task) as JsonObject, task);
    expect(contract.validation_history).toBeUndefined();
    expect(contract.status).toBe("submitted");
    expect(contract.repair_round).toBe(1);
    expect(JSON.stringify(contract)).not.toContain(OBSERVATION);
    expect((contract.findings as JsonObject[])[0]!.prove).toBe(REVALIDATION);
  });

  test("a task with no findings carries no demand list at all", () => {
    const state = workflowState();
    const contract = validatorTaskContract({ id: "T-1", findings: [] }, state.tasks["T-1"]!);
    expect(contract.findings).toBeUndefined();
  });

  test("rendering refuses a round record that smuggled a verdict back in", () => {
    const smuggled = { round: 2, prove_these_hold: [{ demand_id: "F-1", verdict: "reject" }] };
    expect(() => renderValidationRound(smuggled)).toThrow(HarnessError);
    try {
      assertNoConclusions(smuggled, "validation_round");
      throw new Error("the guard was expected to refuse");
    } catch (error) {
      expect((error as HarnessError).code).toBe("INTEGRITY");
      expect((error as HarnessError).message).toContain("prove_these_hold[0].verdict");
    }
  });

  test("the rendering asks for proof and never reports a conclusion", async () => {
    const runRoot = await capsuleWithLog("render", "42 tests passed\n");
    const state = workflowState();
    state.commands["C-gate"] = commandRecord("C-gate", { actor: "worker", task_id: "T-1" });
    const round = validationRoundContext({
      runRoot,
      runState: capsuleState(),
      state,
      task: rejectedTask(state),
      context: contextWith(runRoot),
      git: gitReturning(DIFF),
    })!;
    const markdown = renderValidationRound(round);
    expect(markdown).toContain("### Prove these hold");
    expect(markdown).toContain(`- Prove: ${REVALIDATION}`);
    expect(markdown).toContain("42 tests passed");
    expect(markdown).toContain("+const fixed = true;");
    for (const anchoring of [OBSERVATION, "concluded", "verdict", "reject"]) {
      expect(markdown).not.toContain(anchoring);
    }
  });

  test("the delta reports what the two inspections recorded, not only the anchored diff", () => {
    const markdown = renderValidationRound({
      round: 2,
      previous_round: { round: 1 },
      prove_these_hold: [],
      commands_already_run: [],
      gates: [],
      repository_delta: {
        since_previous_round: {
          anchor: { captured_at: "2026-08-13T12:06:00.000Z", head_commit: "c".repeat(40) },
          unavailable: "repository Git command failed: not a repository",
          recorded_change: {
            content_sha256_changed: true,
            file_count: { before: 2, after: 3 },
            total_bytes: { before: 128, after: null },
          },
        },
      },
    });
    expect(markdown).toContain(
      "That inspection and the current one recorded different content digests (2 → 3 files, 128 → null bytes).",
    );
  });

  test("an unchanged digest is reported as unchanged, and an absent one is not invented", () => {
    const markdown = renderValidationRound({
      round: 2,
      previous_round: { round: 1 },
      prove_these_hold: [],
      commands_already_run: [],
      gates: [],
      repository_delta: {
        full: {
          anchor: { captured_at: "2026-08-13T12:06:00.000Z", head_commit: null },
          recorded_change: { content_sha256_changed: false },
          text: "",
        },
      },
    });
    expect(markdown).toContain(
      "That inspection and the current one recorded the same content digest (null → null files, null → null bytes).",
    );
    expect(markdown).toContain("No tracked file differs from that commit.");
  });
});
