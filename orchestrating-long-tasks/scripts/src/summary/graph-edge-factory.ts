import type { TaskRecord } from "../workflow/types.ts";
import { createEdge } from "./edge-builder.ts";
import type { EdgeTrafficExchange, FileRef, FindingDetail, GraphEdgeData } from "./types.ts";

export interface TaskEdgeFactoryParams {
  task: TaskRecord;
  taskNodeId: string;
  gateNodeId: string;
  taskName: string;
  taskStep: number;
  gateStep: number;
  agent?: string | undefined;
  validatorId?: string | undefined;
  files: FileRef[];
  findings: FindingDetail[];
  now: string;
  isGateDone: boolean;
}

export function buildTaskEdges(params: TaskEdgeFactoryParams): GraphEdgeData[] {
  const {
    task,
    taskNodeId,
    gateNodeId,
    taskName,
    taskStep,
    gateStep,
    agent,
    validatorId,
    files,
    findings,
    now,
    isGateDone,
  } = params;

  const spawnExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-spawn-${task.id}`,
      timestamp: now,
      source: "node-orchestrator-plan",
      target: taskNodeId,
      stepNumber: taskStep,
      step: taskStep,
      direction: "forward",
      type: "dispatch",
      kind: "prompt",
      summary: `Dispatched task ${task.id} to worker ${agent ?? "unassigned"}`,
      tokens: 350,
      tokensIn: 100,
      tokensOut: 250,
      bytes: 1400,
      durationMs: 30,
      latencyMs: 30,
      status: "success",
      inputGoal: `Goal: ${taskName}`,
      payloadSnippet: `Goal: ${taskName}`,
      payloadPreview: `Goal: ${taskName}`,
      fullPayload: `Goal: ${taskName}\nWrite Scope: ${task.write_scope.join(", ")}`,
      metadata: { taskId: task.id, agent: agent ?? "unassigned" },
    },
  ];

  const submitExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-submit-${task.id}`,
      timestamp: now,
      source: taskNodeId,
      target: gateNodeId,
      stepNumber: `${taskStep} -> ${gateStep}`,
      step: taskStep,
      direction: "forward",
      type: "submission",
      kind: "file",
      summary: `Submitted diffs for ${task.id} (${files.length} files)`,
      tokens: 650,
      tokensIn: 150,
      tokensOut: 500,
      bytes: files.length * 1024,
      durationMs: 80,
      latencyMs: 80,
      status: "success",
      outputPassed: `Diff submission with ${files.length} files`,
      filesTransferred: files.map((f) => ({ path: f.path, mode: f.mode ?? "write" })),
      files: files.map((f) => ({ path: f.path, mode: f.mode ?? "write" })),
      payloadSnippet: files.map((f) => f.path).join(", ") || "No files modified",
      payloadPreview: files.map((f) => f.path).join(", ") || "No files modified",
      fullPayload: `Files modified:\n${files.map((f) => `- ${f.path}`).join("\n")}`,
      metadata: { taskId: task.id, filesCount: files.length },
    },
  ];

  const taskEdges: GraphEdgeData[] = [
    createEdge(
      `edge-plan-${task.id}`,
      "node-orchestrator-plan",
      taskNodeId,
      "spawn",
      taskStep,
      "Dispatches Worker",
      agent ? `Lease: ${agent}` : "Task Assignment",
      "info",
      "IconRocket",
      undefined,
      undefined,
      spawnExchanges,
      false,
      "#3b82f6",
      0.75,
      { tokensIn: 100, tokensOut: 250, latencyMs: 30, status: "nominal" },
    ),
    createEdge(
      `edge-task-gate-${task.id}`,
      taskNodeId,
      gateNodeId,
      "sequence",
      `${taskStep} -> ${gateStep}`,
      "Submits Implementation",
      files.length > 0 ? `${files.length} Files Modified` : "Diff Submission",
      "neutral",
      "IconArrowRight",
      undefined,
      undefined,
      submitExchanges,
      files.length > 1,
      "#8b5cf6",
      0.8,
      {
        tokensIn: 150,
        tokensOut: 500,
        latencyMs: 80,
        status: files.length > 2 ? "high" : "nominal",
      },
    ),
  ];

  if ((task.repair_round ?? 0) > 0) {
    const rawFindings =
      findings.length > 0
        ? findings
        : [
            {
              id: `finding-${task.id}-0`,
              observation: "Pushback requested changes",
              pushbackReason: "Pushback requested changes",
              severity: "important" as const,
              status: "open" as const,
            },
          ];
    const repairExchanges: EdgeTrafficExchange[] = rawFindings.map((f, idx) => ({
      id: `exch-repair-${task.id}-${idx + 1}`,
      timestamp: now,
      source: gateNodeId,
      target: taskNodeId,
      stepNumber: `${gateStep} -> ${taskStep}`,
      step: gateStep,
      direction: "reverse",
      type: "rejection",
      kind: "decision",
      summary: `Pushback Finding: ${f.observation}`,
      tokens: 280,
      tokensIn: 180,
      tokensOut: 100,
      bytes: 890,
      durationMs: 60,
      latencyMs: 60,
      status: "warning",
      payloadSnippet: f.remediation ?? f.observation,
      payloadPreview: f.remediation ?? f.observation,
      fullPayload: `Finding: ${f.observation}\nRemediation: ${f.remediation ?? "None"}\nPushback Reason: ${f.pushbackReason ?? f.observation}`,
      auditFinding: {
        id: f.id,
        ...(f.requirementId !== undefined ? { requirementId: f.requirementId } : {}),
        severity: f.severity,
        observation: f.observation,
        ...(f.remediation !== undefined ? { remediation: f.remediation } : {}),
        status: f.status,
        ...(f.revalidationProof !== undefined ? { revalidationProof: f.revalidationProof } : {}),
      },
      finding: {
        id: f.id,
        ...(f.requirementId !== undefined ? { requirementId: f.requirementId } : {}),
        severity: f.severity,
        observation: f.observation,
        ...(f.remediation !== undefined ? { remediation: f.remediation } : {}),
        status: f.status,
        ...(f.revalidationProof !== undefined ? { revalidationProof: f.revalidationProof } : {}),
      },
      rejectionObservation: f.observation,
      observation: f.observation,
      opposedChanges: f.opposedChanges ?? files.map((file) => file.path).join(", "),
      requiredRemediation: f.remediation ?? "Address validator findings",
      remediation: f.remediation ?? "Address validator findings",
      verdict: "FAIL",
      ...(f.revalidationProof
        ? {
            resolutionProof: {
              method: f.revalidationProof.method,
              evidence: f.revalidationProof.evidence,
            },
            proof: {
              method: f.revalidationProof.method,
              evidence: f.revalidationProof.evidence,
            },
          }
        : {}),
      evidence:
        f.evidence
          ?.map((e) => e.reference ?? e.observation ?? "")
          .filter((s): s is string => Boolean(s)) ?? [],
      metadata: {
        findingId: f.id,
        round: task.repair_round,
        ...(validatorId ? { validatorId } : {}),
      },
    }));
    taskEdges.push(
      createEdge(
        `edge-repair-${task.id}`,
        gateNodeId,
        taskNodeId,
        "loop",
        `${gateStep} -> ${taskStep}`,
        `Validator Pushback (Round ${task.repair_round})`,
        `${findings.length} Findings`,
        "warning",
        "IconAlertCircle",
        true,
        "feedback",
        repairExchanges,
        true,
        "#f43f5e",
        0.9,
        {
          tokensIn: rawFindings.length * 180,
          tokensOut: rawFindings.length * 100,
          latencyMs: 60,
          status: "congested",
        },
      ),
    );
  }

  for (const depId of task.dependencies) {
    const depExchanges: EdgeTrafficExchange[] = [
      {
        id: `exch-dep-${depId}-${task.id}`,
        timestamp: now,
        source: `node-gate-${depId}`,
        target: taskNodeId,
        stepNumber: taskStep,
        step: taskStep,
        direction: "forward",
        type: "handoff",
        kind: "artifact",
        summary: `Handoff verified artifact from ${depId} to ${task.id}`,
        tokens: 420,
        tokensIn: 120,
        tokensOut: 300,
        bytes: 1200,
        durationMs: 40,
        latencyMs: 40,
        status: "success",
        payloadSnippet: `Dependency contract ${depId} fulfilled`,
        payloadPreview: `Dependency contract ${depId} fulfilled`,
        fullPayload: `Verified upstream dependency artifact from gate ${depId} handed off to ${task.id}`,
        metadata: { dependencyId: depId, targetTaskId: task.id },
      },
    ];
    taskEdges.push(
      createEdge(
        `edge-dep-${depId}-${task.id}`,
        `node-gate-${depId}`,
        taskNodeId,
        "dependency",
        taskStep,
        "Dependency Unlocked",
        `Dep: ${depId}`,
        "cyan",
        "IconArrowRight",
        undefined,
        undefined,
        depExchanges,
        true,
        "#06b6d4",
        0.85,
        { tokensIn: 120, tokensOut: 300, latencyMs: 40, status: "nominal" },
      ),
    );
  }

  const joinExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-join-${task.id}`,
      timestamp: now,
      source: gateNodeId,
      target: "node-critic-authority",
      stepNumber: gateStep + 1,
      step: gateStep,
      direction: "forward",
      type: "approval",
      kind: "artifact",
      summary: `Evidence scorecard and verification proof for ${task.id}`,
      tokens: 300,
      tokensIn: 100,
      tokensOut: 200,
      bytes: 950,
      durationMs: 35,
      latencyMs: 35,
      status: "success",
      verdict: isGateDone ? "PASS" : "FAIL",
      outputPassed: isGateDone ? "PASSED" : "PENDING",
      payloadSnippet: `Gate check passed with status ${isGateDone ? "DONE" : "PENDING"}`,
      payloadPreview: `Gate check passed with status ${isGateDone ? "DONE" : "PENDING"}`,
      fullPayload: `Evidence report from gate ${gateNodeId} for task ${task.id}: status=${isGateDone ? "DONE" : "PENDING"}, findings=${findings.length}`,
      metadata: { taskId: task.id, gateDone: isGateDone },
    },
  ];
  taskEdges.push(
    createEdge(
      `edge-join-${task.id}`,
      gateNodeId,
      "node-critic-authority",
      "join",
      gateStep + 1,
      "Evidence Report",
      "Gate Verified",
      "success",
      "IconFileText",
      undefined,
      undefined,
      joinExchanges,
      false,
      "#10b981",
      0.7,
      { tokensIn: 100, tokensOut: 200, latencyMs: 35, status: "nominal" },
    ),
  );

  return taskEdges;
}
