import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { validationRoundContext } from "../../../olt/scripts/src/packets/validation-round.ts";
import { commandRecord, workflowState } from "../workflow/test-port.ts";

/**
 * gateStatus (validation-round.ts) sorts a gate's runs by started_at before taking the latest
 * one — a sort whose comparator only actually runs when a gate has two or more recorded runs.
 * Every other validation-round test gives a gate at most one run, so this covers that branch.
 */
describe("gateStatus picks the most recently started run when a gate has several", () => {
  test("reports the later of two runs against the same gate as the latest_run", () => {
    const state = workflowState();
    state.commands["C-first"] = commandRecord("C-first", {
      actor: "validator-r1",
      task_id: "T-1",
      started_at: "2026-08-13T11:00:00.000Z",
      finished_at: "2026-08-13T11:00:01.000Z",
    });
    state.commands["C-second"] = commandRecord("C-second", {
      actor: "validator-r1",
      task_id: "T-1",
      started_at: "2026-08-13T12:00:00.000Z",
      finished_at: "2026-08-13T12:00:01.000Z",
    });
    const task = state.tasks["T-1"]!;
    Object.assign(task, {
      status: "submitted",
      repair_round: 1,
      validation_history: [
        {
          validator_id: "validator-r1",
          token_digest: "a".repeat(64),
          attempt: 1,
          started_at: "2026-08-13T10:00:00.000Z",
          deadline_at: "2026-08-13T10:20:00.000Z",
          verdict: "reject",
        },
      ],
      history: [
        {
          at: "2026-08-13T12:30:00.000Z",
          actor: "validator-r1",
          from: "validating",
          to: "changes_requested",
          reason: "validator requested changes",
          attempt: 1,
        },
      ],
    });

    const round = validationRoundContext({
      runRoot: "/missing",
      runState: {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: null,
      },
      state,
      task,
      context: { current_repository_state: {}, baseline_repository_state: {} },
    })!;

    expect((round.gates[0] as JsonObject).latest_run).toEqual({
      command_id: "C-second",
      exit_code: 0,
      finished_at: "2026-08-13T12:00:01.000Z",
      actor: "validator-r1",
    });
  });
});
