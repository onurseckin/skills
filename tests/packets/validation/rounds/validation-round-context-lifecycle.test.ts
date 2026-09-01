import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertNoConclusions,
  priorRoundDemands,
  validatorTaskContract,
} from "../../../../olt/scripts/src/packets/prior-round-demands.ts";
import { renderValidationRound } from "../../../../olt/scripts/src/packets/render-validation-round.ts";
import {
  filterMechanicTestReceipts,
  isMechanicValidatorReceipt,
  type RecordedCommand,
} from "../../../../olt/scripts/src/packets/round-commands.ts";
import { validationRoundContext } from "../../../../olt/scripts/src/packets/validation-round.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { commandRecord, workflowState } from "../../../workflow/index.ts";
import {
  DIFF,
  OBSERVATION,
  REVALIDATION,
  capsuleState,
  capsuleWithLog,
  contextWith,
  finding,
  gitReturning,
  rejectedTask,
} from "./validation-round-fixture.ts";

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

  test("filters mechanic validator test receipts", () => {
    const commands: RecordedCommand[] = [
      {
        command_id: "C-1",
        actor: "mechanic-validator-1",
        argv: ["bun", "test"],
        cwd_relative: ".",
        gate_id: null,
        status: "passed",
        exit_code: 0,
        started_at: "2026-08-13T12:00:00Z",
        finished_at: "2026-08-13T12:00:01Z",
      },
      {
        command_id: "C-2",
        actor: "ui-mechanic-validator-2",
        argv: ["bun", "test"],
        cwd_relative: ".",
        gate_id: null,
        status: "passed",
        exit_code: 0,
        started_at: "2026-08-13T12:00:00Z",
        finished_at: "2026-08-13T12:00:01Z",
      },
      {
        command_id: "C-3",
        actor: "implementer-1",
        argv: ["bun", "test"],
        cwd_relative: ".",
        gate_id: null,
        status: "passed",
        exit_code: 0,
        started_at: "2026-08-13T12:00:00Z",
        finished_at: "2026-08-13T12:00:01Z",
      },
    ];

    expect(isMechanicValidatorReceipt(commands[0]!)).toBe(true);
    expect(isMechanicValidatorReceipt(commands[1]!)).toBe(true);
    expect(isMechanicValidatorReceipt(commands[2]!)).toBe(false);

    const filtered = filterMechanicTestReceipts(commands);
    expect(filtered.length).toBe(2);
    expect(filtered.map((c) => c.command_id)).toEqual(["C-1", "C-2"]);
  });
});
