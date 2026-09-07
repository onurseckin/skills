import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { executeCoordinatorPushback } from "../../../olt/scripts/src/task/pushback.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CoordinatorPushbackCause,
  ValidatorDomain,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { cleanupVirtualTaskFS, setupVirtualTaskFS } from "../task-fixture.ts";

function createMockPort(initial: WorkflowState): TransactionPort {
  let state = structuredClone(initial);
  return {
    read: () => state,
    transact: <T>(
      _actor: string,
      _action: string,
      _payload: unknown,
      fn: (draft: WorkflowState) => T,
    ): WorkflowState => {
      const draft = structuredClone(state);
      fn(draft);
      state = draft;
      return state;
    },
  };
}

function createValidatedState(
  taskId = "task-alpha",
  validatorId = "val-1",
  domain: ValidatorDomain = "code-quality",
): WorkflowState {
  return {
    tasks: {
      [taskId]: {
        id: taskId,
        status: "validated",
        requirement_ids: ["req-1"],
        write_scope: ["src/test.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "impl-1",
        validations: [
          {
            validator_id: validatorId,
            domain,
            token_digest: "digest-1",
            attempt: 1,
            started_at: "2026-08-29T10:00:00.000Z",
            deadline_at: "2026-08-29T11:00:00.000Z",
            verdict: "pass",
          },
        ],
      },
    },
  };
}

describe("task pushback interleave lifecycle unit tests", () => {
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("interleaves procedural pushback followed by substantive pushback without resetting repair history", () => {
    const state = createValidatedState("task-interleave", "val-1", "code-quality");
    const port = createMockPort(state);

    const step1 = executeCoordinatorPushback(port, "task-interleave", "coordinator-1", {
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing test evidence logs",
      remediation: "Re-run suite with logging enabled",
    });
    expect(step1.tasks["task-interleave"]?.status).toBe("validating");
    expect(step1.tasks["task-interleave"]?.repair_round).toBe(0);
    expect(step1.tasks["task-interleave"]?.repair_assignee).toBeUndefined();

    const pushbackInput = {
      validatorId: "val-1",
      domain: "code-quality" as ValidatorDomain,
      cause: "substantive" as CoordinatorPushbackCause,
      observation: "Defect found in math parser",
      remediation: "Correct operator precedence calculation",
    };

    expect(() =>
      executeCoordinatorPushback(
        port,
        "task-interleave",
        "coordinator-1",
        pushbackInput,
        undefined,
        3,
      ),
    ).toThrow(HarnessError);

    const compState = createValidatedState("task-comp", "val-1");
    compState.tasks["task-comp"]!.status = "completed";
    expect(() =>
      executeCoordinatorPushback(
        createMockPort(compState),
        "task-comp",
        "coordinator-1",
        pushbackInput,
      ),
    ).toThrow(HarnessError);

    port.transact("val-1", "repass", {}, (draft) => {
      const task = draft.tasks["task-interleave"]!;
      task.status = "validated";
      task.validations = [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "digest-2",
          attempt: 2,
          started_at: "2026-08-29T11:00:00.000Z",
          deadline_at: "2026-08-29T12:00:00.000Z",
          verdict: "pass",
        },
      ];
    });

    const step1b = executeCoordinatorPushback(port, "task-interleave", "coordinator-1", {
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Still missing proof",
      remediation: "Re-run suite with logging enabled",
    });
    expect(step1b.tasks["task-interleave"]?.status).toBe("validating");
    expect(step1b.tasks["task-interleave"]?.repair_round).toBe(0);
    expect(step1b.tasks["task-interleave"]?.repair_assignee).toBeUndefined();

    port.transact("val-1", "repass-sub", {}, (draft) => {
      const task = draft.tasks["task-interleave"]!;
      task.status = "validated";
      task.validations = [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "digest-3",
          attempt: 3,
          started_at: "2026-08-29T12:00:00.000Z",
          deadline_at: "2026-08-29T13:00:00.000Z",
          verdict: "pass",
        },
      ];
    });

    const step2 = executeCoordinatorPushback(
      port,
      "task-interleave",
      "coordinator-1",
      pushbackInput,
      undefined,
      3,
    );
    expect(step2.tasks["task-interleave"]?.status).toBe("changes_requested");
    expect(step2.tasks["task-interleave"]?.repair_round).toBe(1);
    expect(step2.tasks["task-interleave"]?.repair_assignee).toBe("impl-1");
    expect(step2.tasks["task-interleave"]?.coordinator_pushbacks).toHaveLength(3);
  });
});
