import { describe, expect, test } from "bun:test";
import {
  abandonedCompletenessCritic,
  abandonedTaskValidations,
  criticTurnState,
  openCompletenessCritic,
  openTaskValidations,
  taskAttemptTurnState,
  validationTurnState,
} from "../../../olt/scripts/src/workflow/lease/turn-state.ts";
import { suspendLease } from "../../../olt/scripts/src/workflow/lease/suspension.ts";
import type {
  CompletionCriticAuthorization,
  ScopedLease,
  TaskRecord,
  ValidationAttempt,
  WorkflowState,
} from "../../../olt/scripts/src/workflow/types.ts";
import { workflowState } from "./test-port.ts";

const t0 = new Date("2026-08-19T00:00:00.000Z");

function baseTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "T-1",
    status: "ready",
    requirement_ids: ["R-1"],
    write_scope: ["src/owned"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

function lease(overrides: Partial<ScopedLease> = {}): ScopedLease {
  return {
    agent_id: "agent-a",
    role: "implementer",
    attempt: 1,
    token_digest: "digest",
    issued_at: t0.toISOString(),
    heartbeat_at: t0.toISOString(),
    expires_at: new Date(t0.valueOf() + 60_000).toISOString(),
    duration_seconds: 60,
    write_scope: ["src/owned"],
    resource_scope: [],
    ...overrides,
  };
}

function openAttempt() {
  return { attempt: 1, agent_id: "agent-a", role: "implementer", started_at: t0.toISOString() };
}

describe("taskAttemptTurnState — the task-lease half of the turn-completion contract", () => {
  test("closed: no attempt has ever been opened", () => {
    expect(taskAttemptTurnState(baseTask(), t0, 30_000)).toBe("closed");
  });

  test("closed: the last attempt already submitted", () => {
    const task = baseTask({
      attempts: [{ ...openAttempt(), submitted_at: t0.toISOString() }],
    });
    expect(taskAttemptTurnState(task, t0, 30_000)).toBe("closed");
  });

  test("closed: the last attempt was explicitly abandoned", () => {
    const task = baseTask({
      attempts: [
        {
          ...openAttempt(),
          abandoned_at: t0.toISOString(),
          abandoned_by: "x",
          abandoned_reason: "r",
        },
      ],
    });
    expect(taskAttemptTurnState(task, t0, 30_000)).toBe("closed");
  });

  test("abandoned: an attempt is open but no lease backs it (already reclaimed)", () => {
    const task = baseTask({ attempts: [openAttempt()] });
    expect(taskAttemptTurnState(task, t0, 30_000)).toBe("abandoned");
  });

  test("open: a live lease within its grace window", () => {
    const task = baseTask({
      attempts: [openAttempt()],
      lease: lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() }),
    });
    expect(taskAttemptTurnState(task, new Date(t0.valueOf() + 4_000), 30_000)).toBe("open");
  });

  test("abandoned: the lease's expiry plus grace has passed with no submission", () => {
    const task = baseTask({
      attempts: [openAttempt()],
      lease: lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() }),
    });
    expect(taskAttemptTurnState(task, new Date(t0.valueOf() + 36_000), 30_000)).toBe("abandoned");
  });

  test("open: a suspended lease never counts as abandoned, however long it has sat", () => {
    const suspended = lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() });
    suspendLease(suspended, t0);
    const task = baseTask({ attempts: [openAttempt()], lease: suspended });
    expect(taskAttemptTurnState(task, new Date(t0.valueOf() + 3_600_000), 30_000)).toBe("open");
  });
});

function validation(overrides: Partial<ValidationAttempt> = {}): ValidationAttempt {
  return {
    validator_id: "validator-1",
    domain: "code-quality",
    token_digest: "digest",
    attempt: 1,
    started_at: t0.toISOString(),
    deadline_at: new Date(t0.valueOf() + 5_000).toISOString(),
    ...overrides,
  };
}

describe("validationTurnState / openTaskValidations / abandonedTaskValidations", () => {
  test("closed: a verdict was recorded, no matter how long ago the deadline passed", () => {
    const entry = validation({ verdict: "pass" });
    expect(validationTurnState(entry, new Date(t0.valueOf() + 3_600_000), 30_000)).toBe("closed");
  });

  test("open: no verdict yet and the deadline plus grace has not passed", () => {
    const entry = validation();
    expect(validationTurnState(entry, new Date(t0.valueOf() + 4_000), 30_000)).toBe("open");
  });

  test("abandoned: no verdict and the deadline plus grace has passed", () => {
    const entry = validation();
    expect(validationTurnState(entry, new Date(t0.valueOf() + 36_000), 30_000)).toBe("abandoned");
  });

  test("openTaskValidations ignores a stale validations array on a task that is not validating", () => {
    const task = baseTask({ status: "submitted", validations: [validation()] });
    expect(openTaskValidations(task)).toEqual([]);
  });

  test("openTaskValidations returns only entries with no verdict yet", () => {
    const task = baseTask({
      status: "validating",
      validations: [
        validation({ validator_id: "v-pass", verdict: "pass" }),
        validation({ validator_id: "v-open" }),
      ],
    });
    expect(openTaskValidations(task).map((entry) => entry.validator_id)).toEqual(["v-open"]);
  });

  test("abandonedTaskValidations names only the entry whose deadline plus grace has passed", () => {
    const task = baseTask({
      status: "validating",
      validations: [
        validation({
          validator_id: "v-dead",
          deadline_at: new Date(t0.valueOf() + 5_000).toISOString(),
        }),
        validation({
          validator_id: "v-alive",
          deadline_at: new Date(t0.valueOf() + 3_600_000).toISOString(),
        }),
      ],
    });
    const abandoned = abandonedTaskValidations(task, new Date(t0.valueOf() + 36_000), 30_000);
    expect(abandoned.map((entry) => entry.validator_id)).toEqual(["v-dead"]);
  });
});

function critic(
  overrides: Partial<CompletionCriticAuthorization> = {},
): CompletionCriticAuthorization {
  return {
    critic_id: "critic-1",
    token_digest: "digest",
    attempt: 1,
    status: "assigned",
    started_at: t0.toISOString(),
    deadline_at: new Date(t0.valueOf() + 5_000).toISOString(),
    readiness_sha256: "sha",
    repository_binding: workflowState().current_repository_binding!,
    ...overrides,
  };
}

function stateWithCritic(entry?: CompletionCriticAuthorization): WorkflowState {
  const state = workflowState();
  if (entry) state.completion_critic = entry;
  return state;
}

describe("criticTurnState / openCompletenessCritic / abandonedCompletenessCritic", () => {
  test("closed: a reviewed critic, regardless of the deadline", () => {
    const entry = critic({ status: "reviewed" });
    expect(criticTurnState(entry, new Date(t0.valueOf() + 3_600_000), 30_000)).toBe("closed");
  });

  test("abandoned: a critic recover-stale already marked expired", () => {
    const entry = critic({ status: "expired" });
    expect(criticTurnState(entry, t0, 30_000)).toBe("abandoned");
  });

  test("open: an assigned critic within its deadline plus grace", () => {
    const entry = critic();
    expect(criticTurnState(entry, new Date(t0.valueOf() + 4_000), 30_000)).toBe("open");
  });

  test("abandoned: an assigned critic past its deadline plus grace", () => {
    const entry = critic();
    expect(criticTurnState(entry, new Date(t0.valueOf() + 36_000), 30_000)).toBe("abandoned");
  });

  test("openCompletenessCritic reports nothing when there is no critic, and nothing once it is reviewed or expired", () => {
    expect(openCompletenessCritic(stateWithCritic())).toBeUndefined();
    expect(openCompletenessCritic(stateWithCritic(critic({ status: "reviewed" })))).toBeUndefined();
    expect(openCompletenessCritic(stateWithCritic(critic({ status: "expired" })))).toBeUndefined();
    expect(openCompletenessCritic(stateWithCritic(critic()))?.critic_id).toBe("critic-1");
  });

  test("abandonedCompletenessCritic does not re-flag a critic recover-stale already expired", () => {
    const state = stateWithCritic(critic({ status: "expired" }));
    expect(
      abandonedCompletenessCritic(state, new Date(t0.valueOf() + 3_600_000), 30_000),
    ).toBeUndefined();
  });

  test("abandonedCompletenessCritic names a live-looking critic once its deadline plus grace has passed", () => {
    const state = stateWithCritic(critic());
    expect(
      abandonedCompletenessCritic(state, new Date(t0.valueOf() + 36_000), 30_000)?.critic_id,
    ).toBe("critic-1");
  });
});
