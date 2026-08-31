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

class FakeClock {
  private ms: number;
  public constructor(start: string | Date = "2026-08-19T00:00:00.000Z") {
    this.ms = new Date(start).getTime();
  }
  public now(): Date {
    return new Date(this.ms);
  }
  public tick(deltaMs = 1_000): Date {
    this.ms += deltaMs;
    return this.now();
  }
  public iso(): string {
    return this.now().toISOString();
  }
}

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

function lease(clock: FakeClock, overrides: Partial<ScopedLease> = {}): ScopedLease {
  return {
    agent_id: "agent-a",
    role: "implementer",
    attempt: 1,
    token_digest: "digest",
    issued_at: clock.iso(),
    heartbeat_at: clock.iso(),
    expires_at: new Date(clock.now().valueOf() + 60_000).toISOString(),
    duration_seconds: 60,
    write_scope: ["src/owned"],
    resource_scope: [],
    ...overrides,
  };
}

function openAttempt(clock: FakeClock) {
  return { attempt: 1, agent_id: "agent-a", role: "implementer", started_at: clock.iso() };
}

describe("taskAttemptTurnState — the task-lease half of the turn-completion contract", () => {
  test("closed: no attempt has ever been opened", () => {
    const clock = new FakeClock();
    expect(taskAttemptTurnState(baseTask(), clock.now(), 30_000)).toBe("closed");
  });

  test("closed: the last attempt already submitted", () => {
    const clock = new FakeClock();
    const task = baseTask({
      attempts: [{ ...openAttempt(clock), submitted_at: clock.iso() }],
    });
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("closed");
  });

  test("closed: the last attempt was explicitly abandoned", () => {
    const clock = new FakeClock();
    const task = baseTask({
      attempts: [
        {
          ...openAttempt(clock),
          abandoned_at: clock.iso(),
          abandoned_by: "x",
          abandoned_reason: "r",
        },
      ],
    });
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("closed");
  });

  test("abandoned: an attempt is open but no lease backs it (already reclaimed)", () => {
    const clock = new FakeClock();
    const task = baseTask({ attempts: [openAttempt(clock)] });
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("abandoned");
  });

  test("open: a live lease within its grace window", () => {
    const clock = new FakeClock();
    const task = baseTask({
      attempts: [openAttempt(clock)],
      lease: lease(clock, { expires_at: new Date(clock.now().valueOf() + 5_000).toISOString() }),
    });
    clock.tick(4_000);
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("open");
  });

  test("abandoned: the lease's expiry plus grace has passed with no submission", () => {
    const clock = new FakeClock();
    const task = baseTask({
      attempts: [openAttempt(clock)],
      lease: lease(clock, { expires_at: new Date(clock.now().valueOf() + 5_000).toISOString() }),
    });
    clock.tick(36_000);
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("abandoned");
  });

  test("open: a suspended lease never counts as abandoned, however long it has sat", () => {
    const clock = new FakeClock();
    const suspended = lease(clock, {
      expires_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
    });
    suspendLease(suspended, clock.now());
    const task = baseTask({ attempts: [openAttempt(clock)], lease: suspended });
    clock.tick(3_600_000);
    expect(taskAttemptTurnState(task, clock.now(), 30_000)).toBe("open");
  });
});

function validation(
  clock: FakeClock,
  overrides: Partial<ValidationAttempt> = {},
): ValidationAttempt {
  return {
    validator_id: "validator-1",
    domain: "code-quality",
    token_digest: "digest",
    attempt: 1,
    started_at: clock.iso(),
    deadline_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
    ...overrides,
  };
}

describe("validationTurnState / openTaskValidations / abandonedTaskValidations", () => {
  test("closed: a verdict was recorded, no matter how long ago the deadline passed", () => {
    const clock = new FakeClock();
    const entry = validation(clock, { verdict: "pass" });
    clock.tick(3_600_000);
    expect(validationTurnState(entry, clock.now(), 30_000)).toBe("closed");
  });

  test("open: no verdict yet and the deadline plus grace has not passed", () => {
    const clock = new FakeClock();
    const entry = validation(clock);
    clock.tick(4_000);
    expect(validationTurnState(entry, clock.now(), 30_000)).toBe("open");
  });

  test("abandoned: no verdict and the deadline plus grace has passed", () => {
    const clock = new FakeClock();
    const entry = validation(clock);
    clock.tick(36_000);
    expect(validationTurnState(entry, clock.now(), 30_000)).toBe("abandoned");
  });

  test("openTaskValidations ignores a stale validations array on a task that is not validating", () => {
    const clock = new FakeClock();
    const task = baseTask({ status: "submitted", validations: [validation(clock)] });
    expect(openTaskValidations(task)).toEqual([]);
  });

  test("openTaskValidations returns only entries with no verdict yet", () => {
    const clock = new FakeClock();
    const task = baseTask({
      status: "validating",
      validations: [
        validation(clock, { validator_id: "v-pass", verdict: "pass" }),
        validation(clock, { validator_id: "v-open" }),
      ],
    });
    expect(openTaskValidations(task).map((entry) => entry.validator_id)).toEqual(["v-open"]);
  });

  test("abandonedTaskValidations names only the entry whose deadline plus grace has passed", () => {
    const clock = new FakeClock();
    const task = baseTask({
      status: "validating",
      validations: [
        validation(clock, {
          validator_id: "v-dead",
          deadline_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
        }),
        validation(clock, {
          validator_id: "v-alive",
          deadline_at: new Date(clock.now().valueOf() + 3_600_000).toISOString(),
        }),
      ],
    });
    clock.tick(36_000);
    const abandoned = abandonedTaskValidations(task, clock.now(), 30_000);
    expect(abandoned.map((entry) => entry.validator_id)).toEqual(["v-dead"]);
  });
});

function critic(
  clock: FakeClock,
  overrides: Partial<CompletionCriticAuthorization> = {},
): CompletionCriticAuthorization {
  return {
    critic_id: "critic-1",
    token_digest: "digest",
    attempt: 1,
    status: "assigned",
    started_at: clock.iso(),
    deadline_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
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
    const clock = new FakeClock();
    const entry = critic(clock, { status: "reviewed" });
    clock.tick(3_600_000);
    expect(criticTurnState(entry, clock.now(), 30_000)).toBe("closed");
  });

  test("abandoned: a critic recover-stale already marked expired", () => {
    const clock = new FakeClock();
    const entry = critic(clock, { status: "expired" });
    expect(criticTurnState(entry, clock.now(), 30_000)).toBe("abandoned");
  });

  test("open: an assigned critic within its deadline plus grace", () => {
    const clock = new FakeClock();
    const entry = critic(clock);
    clock.tick(4_000);
    expect(criticTurnState(entry, clock.now(), 30_000)).toBe("open");
  });

  test("abandoned: an assigned critic past its deadline plus grace", () => {
    const clock = new FakeClock();
    const entry = critic(clock);
    clock.tick(36_000);
    expect(criticTurnState(entry, clock.now(), 30_000)).toBe("abandoned");
  });

  test("openCompletenessCritic reports nothing when there is no critic, and nothing once it is reviewed or expired", () => {
    const clock = new FakeClock();
    expect(openCompletenessCritic(stateWithCritic())).toBeUndefined();
    expect(
      openCompletenessCritic(stateWithCritic(critic(clock, { status: "reviewed" }))),
    ).toBeUndefined();
    expect(
      openCompletenessCritic(stateWithCritic(critic(clock, { status: "expired" }))),
    ).toBeUndefined();
    expect(openCompletenessCritic(stateWithCritic(critic(clock)))?.critic_id).toBe("critic-1");
  });

  test("abandonedCompletenessCritic does not re-flag a critic recover-stale already expired", () => {
    const clock = new FakeClock();
    const state = stateWithCritic(critic(clock, { status: "expired" }));
    clock.tick(3_600_000);
    expect(abandonedCompletenessCritic(state, clock.now(), 30_000)).toBeUndefined();
  });

  test("abandonedCompletenessCritic names a live-looking critic once its deadline plus grace has passed", () => {
    const clock = new FakeClock();
    const state = stateWithCritic(critic(clock));
    clock.tick(36_000);
    expect(abandonedCompletenessCritic(state, clock.now(), 30_000)?.critic_id).toBe("critic-1");
  });
});
