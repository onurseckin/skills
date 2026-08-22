import { describe, expect, test } from "bun:test";
import {
  AntigravityHostAdapter,
  ClaudeCodeHostAdapter,
  CursorHostAdapter,
  CodexHostAdapter,
  ChatGptHostAdapter,
  dispatchSubagent,
  dispatchWithFallback,
  getHostAdapter,
  listHostCapabilities,
  listSupportedHostProviders,
  MechanicalFirstDispatcher,
  resolveHostProvider,
  validateDispatchPacket,
  type SubagentDispatchPacket,
} from "../../../orchestrating-long-tasks/scripts/src/platform/index.ts";
import {
  assertPushbackSafety,
  contestValidatorVerdict,
  evaluatePushbackReport,
  executeCoordinatorPushback,
  isProceduralPushback,
  isSubstantivePushback,
  validatePushbackEvidence,
} from "../../../orchestrating-long-tasks/scripts/src/task/pushback.ts";
import type { TaskRecord, TransactionPort, WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

function createMockPortWithValidatedTask(taskId: string = "task-1"): { port: TransactionPort; state: WorkflowState } {
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
    gates: [{ id: "gate-1", command: "bun test", cwd: ".", scope: "task", requirement_ids: ["R-001"], mandatory: true }],
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

describe("Unified Platform Host Adapters & Mechanical Dispatch", () => {
  const samplePacket: SubagentDispatchPacket = {
    agentId: "impl-worker-alpha",
    role: "implementer",
    runRoot: ".capsules/test-capsule",
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

  test("MechanicalFirstDispatcher dispatches mechanically by default", () => {
    const res = MechanicalFirstDispatcher.dispatch("antigravity", samplePacket);
    expect(res.mode).toBe("mechanical");
    expect(res.provider).toBe("antigravity");
  });

  test("MechanicalFirstDispatcher triggers cognitive fallback when forced", () => {
    let fallbackReason = "";
    const res = MechanicalFirstDispatcher.dispatch("claude-code", samplePacket, {
      forceCognitiveFallback: true,
      onFallbackTriggered: (reason) => {
        fallbackReason = reason;
      },
    });

    expect(res.mode).toBe("cognitive_fallback");
    expect(res.provider).toBe("claude-code");
    expect(fallbackReason).toContain("forceCognitiveFallback");
  });

  test("MechanicalFirstDispatcher builds mandatory CLI sequence correctly", () => {
    const seq = MechanicalFirstDispatcher.buildMandatoryCliSequence(
      "cursor",
      ".capsules/run-1",
      "worker-1",
      "implementer",
      "task-1",
    );

    expect(seq.registerCommand).toContain("agent:register");
    expect(seq.claimCommand).toContain("task:claim");
    expect(seq.submitCommand).toContain("task:submit");
  });

  test("validateDispatchPacket rejects missing required fields", () => {
    expect(() =>
      validateDispatchPacket({
        ...samplePacket,
        agentId: "",
      }),
    ).toThrow(/agentId/);

    expect(() =>
      validateDispatchPacket({
        ...samplePacket,
        taskDescription: "",
      }),
    ).toThrow(/taskDescription/);
  });

  test("dispatchWithFallback wrapper functions as expected", () => {
    const res = dispatchWithFallback("codex", samplePacket);
    expect(res.mode).toBe("mechanical");
    expect(res.provider).toBe("codex");
  });
});

describe("Coordinator Pushback Execution Logic", () => {
  test("isProceduralPushback and isSubstantivePushback type guards", () => {
    expect(isProceduralPushback("procedural")).toBeTrue();
    expect(isProceduralPushback("substantive")).toBeFalse();
    expect(isSubstantivePushback("substantive")).toBeTrue();
    expect(isSubstantivePushback("procedural")).toBeFalse();
  });

  test("validatePushbackEvidence enforces non-blank observation and remediation", () => {
    expect(() => validatePushbackEvidence("procedural", "", "remedy")).toThrow(/observation/);
    expect(() => validatePushbackEvidence("substantive", "obs", "")).toThrow(/remediation/);
    expect(() => validatePushbackEvidence("invalid" as unknown as "procedural", "obs", "rem")).toThrow(/cause/);
  });

  test("procedural pushback reopens validation and changes status to validating", () => {
    const { port, state } = createMockPortWithValidatedTask("task-1");

    const updated = executeCoordinatorPushback(
      port,
      "task-1",
      "coord-1",
      {
        validatorId: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Missing required automated test runner artifacts.",
        remediation: "Re-run validation with comprehensive coverage evidence.",
      },
    );

    const task = updated.tasks["task-1"]!;
    expect(task.status).toBe("validating");
    expect(task.coordinator_pushbacks).toBeDefined();
    expect(task.coordinator_pushbacks).toHaveLength(1);
  });

  test("substantive pushback transitions task to changes_requested and assigns repairer", () => {
    const { port, state } = createMockPortWithValidatedTask("task-1");

    const updated = contestValidatorVerdict(port, {
      taskId: "task-1",
      coordinatorId: "coord-1",
      validatorId: "val-1",
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
    state.tasks["task-1"]!.repair_round = 2; // Next will reach 3 (maxRepairRounds = 3)

    const updated = executeCoordinatorPushback(
      port,
      "task-1",
      "coord-1",
      {
        validatorId: "val-1",
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

  test("evaluatePushbackReport and assertPushbackSafety detect unfulfilled demands", () => {
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

    const report = evaluatePushbackReport(state as unknown as Record<string, unknown>);
    expect(report.hasUnfulfilledDemands).toBeTrue();
    expect(report.totalUnfulfilled).toBeGreaterThan(0);

    expect(() => assertPushbackSafety(state as unknown as Record<string, unknown>)).toThrow(/unfulfilled.*demand/i);
  });
});
