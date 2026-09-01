import { describe, expect, test } from "bun:test";
import {
  assertNoUnfulfilledDemands,
  dispatchSubagent,
  evaluateUnfulfilledDemands,
  getHostAdapter,
  listHostCapabilities,
  listSupportedHostProviders,
  resolveHostProvider,
  type SubagentDispatchPacket,
} from "../../../olt/scripts/src/platform/index.ts";
import {
  isCoordinatorPushbackCause,
  type JsonObject,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  recordCoordinatorPushback,
  validateCoordinatorPushbackInput,
} from "../../../olt/scripts/src/workflow/review/coordinator-pushback.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

function createMockPortWithValidatedTask(taskId: string = "task-1"): {
  port: TransactionPort;
  state: WorkflowState;
} {
  const state: WorkflowState = {
    tasks: {
      [taskId]: {
        id: taskId,
        status: "validated",
        requirement_ids: ["R-001"],
        write_scope: ["src/backend"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "impl-1",
        validations: [
          {
            validator_id: "val-1",
            domain: "code-quality",
            token_digest: "digest-1",
            attempt: 1,
            started_at: "2026-08-22T10:00:00.000Z",
            deadline_at: "2026-08-22T11:00:00.000Z",
            verdict: "pass",
          },
        ],
      },
    },
    requirements: [{ id: "R-001", status: "planned", evidence: [] }],
    gates: [
      {
        id: "gate-1",
        command: "bun test",
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
    ],
    commands: {},
    orphan_evidence: [],
  };

  const port: TransactionPort = {
    read: () => structuredClone(state),
    transact: (actor, kind, payload, mutate) => {
      mutate(state);
      return state;
    },
  };

  return { port, state };
}

describe("Unified Platform Host Adapters & Dispatch", () => {
  const samplePacket: SubagentDispatchPacket = {
    agentId: "impl-worker-alpha",
    role: "implementer",
    runRoot: ".olt/capsules/test-capsule",
    taskId: "task-101",
    taskDescription: "Implement strict POSIX flock primitives.",
    writeScope: ["src/platform/"],
    modelTier: "l",
    thinkingLevel: "high",
  };

  test("listSupportedHostProviders returns 5 canonical providers", () => {
    const providers = listSupportedHostProviders();
    expect(providers).toEqual(["antigravity", "claude-code", "cursor", "codex", "chatgpt"]);
  });

  test("listHostCapabilities returns capabilities for all providers", () => {
    const caps = listHostCapabilities();
    expect(caps).toHaveLength(5);
  });

  test("resolveHostProvider accurately maps aliases", () => {
    expect(resolveHostProvider("antigravity-cli")).toBe("antigravity");
    expect(resolveHostProvider("claude-3-7")).toBe("claude-code");
    expect(resolveHostProvider("cursor-editor")).toBe("cursor");
    expect(resolveHostProvider("codex-cli")).toBe("codex");
    expect(resolveHostProvider("chatgpt-o3")).toBe("chatgpt");
  });

  test("dispatchSubagent dispatches mechanically by default", () => {
    const res = dispatchSubagent("antigravity", samplePacket);
    expect(res.mode).toBe("mechanical");
    expect(res.provider).toBe("antigravity");
  });

  test("dispatchSubagent triggers cognitive fallback when forced", () => {
    const res = dispatchSubagent("claude-code", samplePacket, {
      forceCognitiveFallback: true,
    });

    expect(res.mode).toBe("cognitive_fallback");
    expect(res.provider).toBe("claude-code");
  });

  test("getHostAdapter builds mandatory CLI sequence correctly", () => {
    const adapter = getHostAdapter("cursor");
    const seq = adapter.buildMandatoryCliSequence(
      ".olt/capsules/run-1",
      "worker-1",
      "implementer",
      "task-1",
    );

    expect(seq.registerCommand).toContain("agent:register");
    expect(seq.claimCommand).toContain("task:claim");
    expect(seq.submitCommand).toContain("task:submit");
  });
});

describe("Coordinator Pushback Execution Logic", () => {
  test("isCoordinatorPushbackCause type guard", () => {
    expect(isCoordinatorPushbackCause("procedural")).toBeTrue();
    expect(isCoordinatorPushbackCause("substantive")).toBeTrue();
    expect(isCoordinatorPushbackCause("invalid")).toBeFalse();
  });

  test("validateCoordinatorPushbackInput enforces non-blank observation and remediation", () => {
    expect(() =>
      validateCoordinatorPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "",
        remediation: "remedy",
      }),
    ).toThrow();
    expect(() =>
      validateCoordinatorPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "obs",
        remediation: "",
      }),
    ).toThrow();
    expect(() =>
      validateCoordinatorPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "invalid" as unknown as "procedural",
        observation: "obs",
        remediation: "rem",
      }),
    ).toThrow(/cause/);
  });

  test("procedural pushback reopens validation and changes status to validating", () => {
    const { port } = createMockPortWithValidatedTask("task-1");

    const updated = recordCoordinatorPushback(port, "task-1", "coord-1", {
      validator_id: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing required automated test runner artifacts.",
      remediation: "Re-run validation with comprehensive coverage evidence.",
    });

    const task = updated.tasks["task-1"]!;
    expect(task.status).toBe("validating");
    expect(task.coordinator_pushbacks).toBeDefined();
    expect(task.coordinator_pushbacks).toHaveLength(1);
  });

  test("substantive pushback transitions task to changes_requested and assigns repairer", () => {
    const { port } = createMockPortWithValidatedTask("task-1");

    const updated = recordCoordinatorPushback(port, "task-1", "coord-1", {
      validator_id: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Critical concurrency race condition observed in mutex locking.",
      remediation: "Refactor flock locking to atomic compare-and-swap.",
    });

    const task = updated.tasks["task-1"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.repair_assignee).toBe("impl-1");
    expect(task.repair_round).toBe(1);
  });

  test("substantive pushback escalates when max repair rounds exhausted", () => {
    const { port, state } = createMockPortWithValidatedTask("task-1");
    state.tasks["task-1"]!.repair_round = 2;

    const updated = recordCoordinatorPushback(
      port,
      "task-1",
      "coord-1",
      {
        validator_id: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Repeated failure to fix memory leak.",
        remediation: "Escalate to coordinator authority.",
      },
      undefined,
      3,
    );

    const task = updated.tasks["task-1"]!;
    expect(task.status).toBe("escalated");
  });

  test("evaluateUnfulfilledDemands and assertNoUnfulfilledDemands detect unfulfilled demands", () => {
    const { state } = createMockPortWithValidatedTask("task-1");
    state.tasks["task-2"] = {
      id: "task-2",
      status: "proposed",
      requirement_ids: ["R-001"],
      write_scope: ["src/frontend"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    const report = evaluateUnfulfilledDemands(state as unknown as JsonObject);
    expect(report.hasUnfulfilledDemands).toBeTrue();
    expect(report.totalUnfulfilled).toBeGreaterThan(0);

    expect(() => assertNoUnfulfilledDemands(state as unknown as JsonObject)).toThrow(
      /unfulfilled.*demand/i,
    );
  });
});
