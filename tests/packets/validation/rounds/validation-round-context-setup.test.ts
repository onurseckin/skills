import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { renderValidationRound } from "../../../../olt/scripts/src/packets/render-validation-round.ts";
import type { RepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import { taskCommandEvidence } from "../../../../olt/scripts/src/packets/round-commands.ts";
import {
  anchoredDiff,
  diffAnchor,
} from "../../../../olt/scripts/src/packets/round-repository-delta.ts";
import { validationRoundContext } from "../../../../olt/scripts/src/packets/validation-round.ts";
import { commandRecord, workflowState } from "../../../workflow/index.ts";
import { inspection } from "../../payloads/slicing/inspection-fixture.ts";
import {
  DIFF,
  REVALIDATION,
  capsuleState,
  capsuleWithLog,
  contextWith,
  gitReturning,
  rejectedTask,
} from "./validation-round-fixture.ts";

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
    expect(round.commands_already_run).toHaveLength(1);
    const [command] = round.commands_already_run;
    expect(command!.command_id).toBe("C-gate");
    expect(command!.exit_code).toBe(0);
    expect(command!.stdout).toEqual({ text: "1 pass 0 fail", truncated: false });
    expect(round.gates).toEqual([
      {
        gate_id: "G-1",
        command: ["bun", "test", "tests/runner/receipt/output-evidence.test.ts"],
        mandatory: true,
        recorded_pass: { command_id: "C-gate" },
      },
    ]);
    const delta = round.repository_delta as JsonObject;
    const since = delta.since_previous_round as JsonObject;
    expect((delta.full as JsonObject).text).toBe(DIFF);
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
