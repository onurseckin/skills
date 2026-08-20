import { mapGateStatus, type TaskNodeContext } from "./graph-node-context.ts";
import type { BadgeDetail, GraphNodeData, IoPort, NodeKind } from "./types.ts";

export { mapGateStatus };

function gateBadge(ctx: TaskNodeContext): BadgeDetail | undefined {
  const { task, findings } = ctx;
  if (task.status === "changes_requested") {
    return {
      text: `Pushback: ${findings.length} Finding${findings.length === 1 ? "" : "s"}`,
      variant: "warning",
      icon: "IconAlertTriangle",
      targetTab: "feedback",
    };
  }
  if (task.status === "done" || task.status === "validated") {
    return { text: "Gate Passed", variant: "success", icon: "IconShieldCheck" };
  }
  if (
    task.status === "validating" ||
    task.status === "gating" ||
    (task.validations !== undefined && task.validations.length > 0)
  ) {
    return { text: "Awaiting Verdict", variant: "info", icon: "IconShield" };
  }
  return undefined;
}

function gateIo(ctx: TaskNodeContext): { inputs: IoPort[]; outputs: IoPort[] } {
  const { task, findings } = ctx;
  const source = ctx.validatorNodeId ?? ctx.taskNodeId;
  const isDone = task.status === "done" || task.status === "validated";
  return {
    inputs: [
      {
        node: source,
        kind: "decision",
        label: ctx.validatorNodeId ? "Validator Verdict" : "Task Submission",
        preview: ctx.validatorNodeId
          ? `Verdict recorded for ${task.id}`
          : `${ctx.files.length} modified files submitted`,
      },
    ],
    outputs: [
      {
        kind: "decision",
        label: "Gate Decision",
        preview: isDone
          ? "PASSED: recorded gates satisfied"
          : task.status === "changes_requested"
            ? `CHANGES REQUESTED: ${findings.length} findings`
            : `PENDING: task is ${task.status}`,
      },
    ],
  };
}

/**
 * The gate is a decision, not an agent. It holds the recorded gate results and references the
 * findings by id; the evidence itself stays on the node whose agent produced it.
 */
export function buildGateNode(ctx: TaskNodeContext): GraphNodeData {
  const { task, findings } = ctx;
  const badge = gateBadge(ctx);
  const io = gateIo(ctx);
  const gateResults = (task.gate_results ?? []).map((result) => ({
    gateId: result.gate_id,
    commandId: result.command_id,
    status: result.status,
  }));

  return {
    id: ctx.gateNodeId,
    name: `Gate: ${ctx.taskName}`,
    description: `Verification gate for ${ctx.taskName}: ${gateResults.length} recorded gate result(s).`,
    kind: "gate" as NodeKind,
    status: mapGateStatus(task),
    step: ctx.gateStep,
    stepLabel: `Gate ${ctx.taskWave}`,
    ...(badge ? { badge } : {}),
    io: { inputs: io.inputs, outputs: io.outputs },
    metadata: {
      writeScope: task.write_scope,
      repairRounds: task.repair_round ?? 0,
      probeRounds: task.probe_round ?? 0,
      gateResults,
      openFindingIds: findings.filter((f) => f.status !== "resolved").map((f) => f.id),
      ...(ctx.validatorNodeId ? { validatorNodeId: ctx.validatorNodeId } : {}),
      ...(ctx.validatorId ? { validatorId: ctx.validatorId } : {}),
      // Without a validator node the findings have no author node to live on, so the gate keeps them.
      ...(ctx.validatorNodeId === undefined ? { findings } : {}),
    },
  };
}
