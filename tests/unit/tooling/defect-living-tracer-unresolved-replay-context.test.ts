import { describe, expect, test } from "bun:test";
import {
  assertLivingTracerTaskTransitionsValid,
  auditLivingTracerTaskStateTransitions,
  CANONICAL_LIVING_TRACER_DIR,
  CANONICAL_LIVING_TRACER_INDEX_PATH,
  CANONICAL_LIVING_TRACER_REPLAYER_PATH,
  CANONICAL_LIVING_TRACER_TRANSITIONS_PATH,
  CANONICAL_LIVING_TRACER_TYPES_PATH,
  createInitialReplayContext,
  createLivingTracerDefectEntry,
  createLivingTracerDefectProof,
  createSampleDynamicTask,
  createSampleEventTransitionData,
  DEFECT_ERROR_CODE,
  DEFECT_REF,
  ERROR_CODE,
  handleTaskStateTransition,
  KNOWN_LIVING_TRACER_CORE_FILES,
  LivingTracerReplayContextError,
  remediateLivingTracerTaskTransitions,
  remediateLivingTracerTaskTransitionsWithReport,
  TARGET_MEMBER,
  UNEXPORTED_MEMBER_IMPORT,
  UnresolvedReplayContextError,
  validateLivingTracerTaskTransitions,
  verifyReplayContextAndTransitions,
} from "../../../olt/scripts/src/tooling/defect-living-tracer-unresolved-replay-context.ts";

describe("Task 1.7: defect-living-tracer-unresolved-replay-context", () => {
  test("1. defect constants & metadata are canonical and immutable", () => {
    expect(DEFECT_REF).toBe("defect-living-tracer-unresolved-replay-context");
    expect(DEFECT_ERROR_CODE).toBe("UNEXPORTED_MEMBER_IMPORT");
    expect(ERROR_CODE).toBe("UNEXPORTED_MEMBER_IMPORT");
    expect(UNEXPORTED_MEMBER_IMPORT).toBe("UNEXPORTED_MEMBER_IMPORT");
    expect(TARGET_MEMBER).toBe("ReplayContext");

    expect(CANONICAL_LIVING_TRACER_TYPES_PATH).toBe(
      "olt/scripts/src/reporting/living-tracer/types.ts",
    );
    expect(CANONICAL_LIVING_TRACER_TRANSITIONS_PATH).toBe(
      "olt/scripts/src/reporting/living-tracer/task-state-transitions.ts",
    );
    expect(CANONICAL_LIVING_TRACER_REPLAYER_PATH).toBe(
      "olt/scripts/src/reporting/living-tracer/event-replayer.ts",
    );
    expect(CANONICAL_LIVING_TRACER_INDEX_PATH).toBe(
      "olt/scripts/src/reporting/living-tracer/index.ts",
    );
    expect(CANONICAL_LIVING_TRACER_DIR).toBe(
      "olt/scripts/src/reporting/living-tracer",
    );

    expect(Array.isArray(KNOWN_LIVING_TRACER_CORE_FILES)).toBe(true);
    expect(KNOWN_LIVING_TRACER_CORE_FILES.length).toBeGreaterThanOrEqual(4);
    expect(Object.isFrozen(KNOWN_LIVING_TRACER_CORE_FILES)).toBe(true);
  });

  test("2. createInitialReplayContext produces valid ReplayContext instances with defaults and overrides", () => {
    const defaultCtx = createInitialReplayContext();
    expect(defaultCtx.taskMap instanceof Map).toBe(true);
    expect(defaultCtx.agentMap instanceof Map).toBe(true);
    expect(defaultCtx.branches instanceof Set).toBe(true);
    expect(Array.isArray(defaultCtx.sproutedRepairPairs)).toBe(true);
    expect(defaultCtx.sproutedRepairPairs.length).toBe(0);
    expect(defaultCtx.revision).toBe(0);
    expect(defaultCtx.maxRoundReached).toBe(1);

    const customTaskMap = new Map();
    const customCtx = createInitialReplayContext({
      taskMap: customTaskMap,
      revision: 42,
      maxRoundReached: 3,
    });
    expect(customCtx.taskMap).toBe(customTaskMap);
    expect(customCtx.revision).toBe(42);
    expect(customCtx.maxRoundReached).toBe(3);
  });

  test("3. createSampleDynamicTask produces fully populated DynamicTaskState", () => {
    const task = createSampleDynamicTask();
    expect(task.id).toBe("task-001");
    expect(task.label).toBe("Sample Task");
    expect(task.status).toBe("ready");
    expect(task.role).toBe("implementer");
    expect(task.dependencies).toEqual([]);
    expect(task.writeScope).toEqual(["src/"]);
    expect(task.assignedAgent).toBeNull();
    expect(task.origin).toBe("static");
    expect(task.round).toBe(1);
    expect(task.attempt).toBe(1);
    expect(task.executionState).toBe("[⏳ READY]");

    const overridden = createSampleDynamicTask({
      id: "task-custom-99",
      label: "Custom Task 99",
      status: "leased",
      round: 2,
      assignedAgent: "agent-zeta",
    });
    expect(overridden.id).toBe("task-custom-99");
    expect(overridden.label).toBe("Custom Task 99");
    expect(overridden.status).toBe("leased");
    expect(overridden.round).toBe(2);
    expect(overridden.assignedAgent).toBe("agent-zeta");
  });

  test("4. createSampleEventTransitionData creates valid EventTransitionData", () => {
    const ev = createSampleEventTransitionData();
    expect(ev.actor).toBe("agent-alpha");
    expect(ev.kind).toBe("task-claimed");
    expect(ev.lowerKind).toBe("task-claimed");
    expect(ev.seq).toBe(10);
    expect(ev.role).toBe("implementer");

    const customEv = createSampleEventTransitionData({
      actor: "validator-beta",
      kind: "TASK-REJECTED",
      payload: { verdict: "reject", reason: "Type error" },
      seq: 25,
      role: "validator",
    });
    expect(customEv.actor).toBe("validator-beta");
    expect(customEv.kind).toBe("TASK-REJECTED");
    expect(customEv.lowerKind).toBe("task-rejected");
    expect(customEv.seq).toBe(25);
    expect(customEv.role).toBe("validator");
    expect(customEv.payload).toEqual({ verdict: "reject", reason: "Type error" });
  });

  test("5. verifyReplayContextAndTransitions validates live system contracts", () => {
    const result = verifyReplayContextAndTransitions();
    expect(result.verified).toBe(true);
    expect(result.typesModuleExists).toBe(true);
    expect(result.transitionsModuleExists).toBe(true);
    expect(result.replayContextInstantiable).toBe(true);
    expect(result.taskTransitionsFunctional).toBe(true);
    expect(result.details).toContain("verified");
  });

  test("6. handleTaskStateTransition accurately transitions task states and agents", () => {
    const ctx = createInitialReplayContext();
    const task = createSampleDynamicTask({ id: "task-flow-1", status: "ready" });
    ctx.taskMap.set(task.id, task);

    // 1. Claim task
    handleTaskStateTransition(
      task,
      task.id,
      createSampleEventTransitionData({
        actor: "agent-coder",
        kind: "task-claimed",
        role: "implementer",
        seq: 1,
      }),
      ctx,
    );
    let current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("leased");
    expect(current.assignedAgent).toBe("agent-coder");
    expect(ctx.agentMap.get("agent-coder")?.taskId).toBe("task-flow-1");

    // 2. Tool exec
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-coder",
        kind: "tool-exec",
        tool: "edit_file",
        cmd: "bun test",
        seq: 2,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("in_progress");
    expect(current.activeTool).toBe("edit_file");
    expect(current.activeCommand).toBe("bun test");

    // 3. Gate prove
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-coder",
        kind: "gate:prove",
        exitCode: 0,
        seq: 3,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.executionState).toContain("GATE PASSED");

    // 4. Submit
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-coder",
        kind: "task-submitted",
        seq: 4,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("validating");

    // 5. Begin validation
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-verifier",
        kind: "begin-validation",
        role: "validator",
        seq: 5,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.validatorId).toBe("agent-verifier");
    expect(ctx.agentMap.get("agent-verifier")?.role).toBe("validator");

    // 6. Explicit rejection & sprout branch
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-verifier",
        kind: "verdict-rejected",
        payload: { verdict: "reject", reason: "Failed acceptance criteria" },
        seq: 6,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("changes_requested");
    expect(current.rejectionReason).toBe("Failed acceptance criteria");
    expect(ctx.sproutedRepairPairs.length).toBe(1);
    expect(current.sproutedChildren?.length).toBe(2);

    // 7. Explicit pass
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-verifier",
        kind: "verdict-passed",
        payload: { verdict: "pass" },
        seq: 7,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("satisfied");

    // 8. Release
    handleTaskStateTransition(
      current,
      current.id,
      createSampleEventTransitionData({
        actor: "agent-coder",
        kind: "task-released",
        seq: 8,
      }),
      ctx,
    );
    current = ctx.taskMap.get("task-flow-1")!;
    expect(current.status).toBe("ready");
    expect(current.assignedAgent).toBeNull();
  });

  test("7. validateLivingTracerTaskTransitions approves canonical codebase files", () => {
    const transitionsVal = validateLivingTracerTaskTransitions(
      CANONICAL_LIVING_TRACER_TRANSITIONS_PATH,
    );
    expect(transitionsVal.valid).toBe(true);
    expect(transitionsVal.defectRef).toBe(DEFECT_REF);
    expect(transitionsVal.replayContextImported).toBe(true);
    expect(transitionsVal.roleVariableDeclared).toBe(true);
    expect(transitionsVal.issueCount).toBe(0);

    const typesVal = validateLivingTracerTaskTransitions(
      CANONICAL_LIVING_TRACER_TYPES_PATH,
    );
    expect(typesVal.valid).toBe(true);
    expect(typesVal.replayContextExported).toBe(true);
    expect(typesVal.issueCount).toBe(0);
  });

  test("8. validateLivingTracerTaskTransitions flags missing ReplayContext and undeclared role", () => {
    // Missing ReplayContext import in transitions module
    const badTransitionsCode = `
      import { formatSeq, parsePayloadString, type DynamicTaskState } from "./types.ts";
      export function handleTaskStateTransition(targetTask: DynamicTaskState, targetTaskId: string, evData: unknown, ctx: unknown): void {
        const { actor, seq } = evData;
        const roleStr = role ? role : "implementer";
      }
    `;
    const badTransVal = validateLivingTracerTaskTransitions(badTransitionsCode, {
      filePath: "task-state-transitions.ts",
    });
    expect(badTransVal.valid).toBe(false);
    expect(badTransVal.missingExportsDetected).toBe(true);
    expect(badTransVal.roleVariableDeclared).toBe(false);
    expect(badTransVal.issues.some((i) => i.message.includes("ReplayContext"))).toBe(true);
    expect(badTransVal.issues.some((i) => i.message.includes("role"))).toBe(true);

    // Missing ReplayContext export in types module
    const badTypesCode = `
      export interface DynamicTaskState { id: string; }
    `;
    const badTypesVal = validateLivingTracerTaskTransitions(badTypesCode, {
      filePath: "types.ts",
    });
    expect(badTypesVal.valid).toBe(false);
    expect(badTypesVal.replayContextExported).toBe(false);
    expect(badTypesVal.issues.some((i) => i.message.includes("export of 'ReplayContext'"))).toBe(true);
  });

  test("9. auditLivingTracerTaskStateTransitions audits repository tree successfully", () => {
    const report = auditLivingTracerTaskStateTransitions();
    expect(report.defectRef).toBe(DEFECT_REF);
    expect(report.errorCode).toBe(DEFECT_ERROR_CODE);
    expect(report.resolved).toBe(true);
    expect(report.totalFilesScanned).toBeGreaterThanOrEqual(4);
    expect(report.validFilesCount).toBe(report.totalFilesScanned);
    expect(report.invalidFilesCount).toBe(0);
    expect(report.issues.length).toBe(0);
  });

  test("10. remediateLivingTracerTaskTransitions fixes missing imports and undeclared role", () => {
    const unmediated = [
      'import { formatSeq, parsePayloadString, type DynamicTaskState } from "./types.ts";',
      "export interface EventTransitionData {",
      "  readonly actor: string;",
      "  readonly payload: Record<string, unknown>;",
      "}",
      "export function handleTaskStateTransition(targetTask: DynamicTaskState, targetTaskId: string, evData: EventTransitionData, ctx: ReplayContext): void {",
      "  const { actor, lowerKind, seq, payload } = evData;",
      '  const r = role ? role : "implementer";',
      "}",
    ].join("\n");

    const report = remediateLivingTracerTaskTransitionsWithReport(unmediated);
    expect(report.defectRef).toBe(DEFECT_REF);
    expect(report.success).toBe(true);
    expect(report.replacementsCount).toBe(1);
    expect(report.remediatedSource).toContain("type ReplayContext");
    expect(report.remediatedSource).toContain("readonly role: string | null;");
    expect(report.remediatedSource).toContain("role");

    // Idempotence test
    const secondPass = remediateLivingTracerTaskTransitions(report.remediatedSource);
    expect(secondPass).toBe(report.remediatedSource);
  });

  test("11. assertLivingTracerTaskTransitionsValid throws LivingTracerReplayContextError on invalid source", () => {
    expect(() => {
      assertLivingTracerTaskTransitionsValid(CANONICAL_LIVING_TRACER_TRANSITIONS_PATH);
    }).not.toThrow();

    const invalidSnippet = `
      import { formatSeq } from "./types.ts";
      export function handleTaskStateTransition(): void {}
    `;
    expect(() => {
      assertLivingTracerTaskTransitionsValid(invalidSnippet, {
        filePath: "task-state-transitions.ts",
      });
    }).toThrow(LivingTracerReplayContextError);
  });

  test("12. LivingTracerReplayContextError sets proper prototype and error metadata", () => {
    const err = new LivingTracerReplayContextError("Unresolved ReplayContext import", {
      code: DEFECT_ERROR_CODE,
      defectRef: DEFECT_REF,
      filePath: CANONICAL_LIVING_TRACER_TRANSITIONS_PATH,
      member: TARGET_MEMBER,
      issues: [
        {
          code: UNEXPORTED_MEMBER_IMPORT,
          message: "Missing ReplayContext export in types.ts",
        },
      ],
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LivingTracerReplayContextError);
    expect(err).toBeInstanceOf(UnresolvedReplayContextError);
    expect(err.name).toBe("LivingTracerReplayContextError");
    expect(err.code).toBe(DEFECT_ERROR_CODE);
    expect(err.defectRef).toBe(DEFECT_REF);
    expect(err.member).toBe(TARGET_MEMBER);
    expect(err.filePath).toBe(CANONICAL_LIVING_TRACER_TRANSITIONS_PATH);
    expect(err.issues.length).toBe(1);
  });

  test("13. createLivingTracerDefectProof produces verified DefectResolutionProof", () => {
    const proof = createLivingTracerDefectProof();
    expect(proof.commit_sha).toBeDefined();
    expect(proof.task_id).toBe(`task-remediate-${DEFECT_REF}`);
    expect(proof.verified).toBe(true);
    expect(proof.test_assertion).toContain("auditLivingTracerTaskStateTransitions");
    expect(proof.empirical_command).toBe(
      "bun test tests/unit/tooling/defect-living-tracer-unresolved-replay-context.test.ts",
    );
  });

  test("14. createLivingTracerDefectEntry produces valid DefectEntry with tooling domain", () => {
    const defect = createLivingTracerDefectEntry({
      status: "resolved",
      severity: "high",
    });

    expect(defect.id).toContain(DEFECT_REF);
    expect(defect.domain).toBe("tooling");
    expect(defect.error_code).toBe(DEFECT_ERROR_CODE);
    expect(defect.status).toBe("resolved");
    expect(defect.severity).toBe("high");
    expect(defect.type).toBe("CODE_HEALTH");
    expect(defect.category).toBe("modularity_violation");
    expect(defect.resolution?.verified).toBe(true);
  });
});
