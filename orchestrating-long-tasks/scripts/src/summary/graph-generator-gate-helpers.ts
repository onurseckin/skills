import type { HarnessEvent } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { detectHostTelemetry } from "./host-telemetry.ts";
import { computeGateTiming, computeGateTokens } from "./metrics-collector.ts";
import type {
  BadgeDetail,
  FileRef,
  FindingDetail,
  GraphNodeData,
  IoPort,
  MediaAsset,
  NodeKind,
  NodeMetrics,
  NodeStatus,
  PlaywrightMetadata,
} from "./types.ts";

export function mapGateStatus(task: TaskRecord): NodeStatus {
  if (task.status === "done" || task.status === "validated") return "success";
  if (task.status === "changes_requested") return "warning";
  if (task.status === "cancelled" || task.status === "escalated") return "error";
  if (task.status === "validating" || task.status === "gating" || Boolean(task.validation))
    return "running";
  return "pending";
}

export interface GateNodeBuilderParams {
  task: TaskRecord;
  taskNodeId: string;
  gateNodeId: string;
  taskName: string;
  gateStep: number;
  taskWave: number;
  files: FileRef[];
  findings: FindingDetail[];
  mediaAssets: MediaAsset[];
  screenshots: MediaAsset[];
  playwrightMetadata?: PlaywrightMetadata | undefined;
  validatorId?: string | undefined;
  taskCmds: CommandRecord[];
  events?: readonly HarnessEvent[] | undefined;
  runRoot?: string | undefined;
}

export function buildGateNode(params: GateNodeBuilderParams): GraphNodeData {
  const {
    task,
    taskNodeId,
    gateNodeId,
    taskName,
    gateStep,
    taskWave,
    files,
    findings,
    mediaAssets,
    screenshots,
    playwrightMetadata,
    validatorId,
    taskCmds,
    events,
  } = params;

  const gateTelemetry = detectHostTelemetry(validatorId);
  const gateTimingBreakdown = computeGateTiming(task, events, taskCmds);
  const gateTokens = computeGateTokens(task, taskCmds, gateTelemetry.hostAgent?.tokens);

  const opposedChangesCount = findings.filter((f) => Boolean(f.opposedChanges)).length;
  const pushbackCount = task.repair_round ?? (findings.length > 0 ? 1 : 0);

  const gateMetadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    validationHistory: task.validation_history ?? [],
    findings,
    mediaAssets,
    screenshots,
    assets: mediaAssets,
    opposedChangesCount,
    pushbackCount,
    ...(validatorId ? { validator_id: validatorId, validatorId, leaseAgent: validatorId } : {}),
    ...(playwrightMetadata ? { playwrightMetadata } : {}),
  };

  let gateBadge: BadgeDetail | undefined = undefined;
  if (task.status === "changes_requested") {
    gateBadge = {
      text: `Pushback: ${findings.length} Finding${findings.length === 1 ? "" : "s"}`,
      variant: "warning",
      icon: "IconAlertTriangle",
      targetTab: "feedback",
    };
  } else if (task.status === "done" || task.status === "validated") {
    gateBadge = {
      text: "Gate Passed",
      variant: "success",
      icon: "IconShieldCheck",
    };
  } else if (task.status === "validating" || task.status === "gating" || Boolean(task.validation)) {
    gateBadge = {
      text: "Auditing",
      variant: "info",
      icon: "IconShield",
    };
  }

  const isGateDone = task.status === "done" || task.status === "validated";

  const gateInputs: IoPort[] = [
    {
      node: taskNodeId,
      kind: "file",
      label: "Task Submission",
      preview: `${files.length} modified files submitted for verification`,
    },
    {
      node: "node-orchestrator-plan",
      kind: "artifact",
      label: "Acceptance Test Suite",
      preview: `Independent test requirements for ${task.id}`,
    },
  ];

  const gateOutputs: IoPort[] = [
    {
      kind: "decision",
      label: "Verification Verdict",
      preview: isGateDone
        ? "PASSED: All criteria verified"
        : task.status === "changes_requested"
          ? `CHANGES REQUESTED: ${findings.length} pushback findings`
          : "PENDING: Verification in progress",
    },
    {
      kind: "artifact",
      label: "Validator Findings",
      preview: `${findings.length} findings recorded (${findings.filter((f) => f.status === "resolved").length} resolved)`,
    },
    {
      kind: "artifact",
      label: "Validator Visual Evidence",
      preview: `${mediaAssets.length} media assets captured`,
    },
  ];

  const gateCostUsd =
    gateTokens.costUsd ??
    (gateTelemetry.hostAgent?.tokens?.costUsd !== undefined
      ? gateTelemetry.hostAgent.tokens.costUsd
      : undefined);

  const gateMetrics: NodeMetrics = {
    tokensIn: gateTokens.inputTokens,
    tokensOut: gateTokens.outputTokens,
    ...(gateCostUsd !== undefined ? { costUsd: gateCostUsd } : {}),
    ...(gateTimingBreakdown ? { durationMs: gateTimingBreakdown.wallDurationMs } : {}),
    commandCount: taskCmds.filter((c) => Boolean(c.gate_id) || c.actor === "val").length,
    retries: task.repair_round ?? 0,
    tokens: gateTokens,
    hostAgent: gateTelemetry.hostAgent,
    ...(gateTimingBreakdown ? { timingBreakdown: gateTimingBreakdown } : {}),
  };

  const gateDescription =
    typeof task.validation?.plan === "string" && task.validation.plan.trim().length > 0
      ? task.validation.plan
      : `Verification gate enforcing quality, assertions, and criteria for ${taskName}.`;

  return {
    id: gateNodeId,
    name: `Gate: ${taskName}`,
    description: gateDescription,
    kind: "gate" as NodeKind,
    status: mapGateStatus(task),
    step: gateStep,
    stepLabel: `Gate ${taskWave}`,
    ...(gateBadge ? { badge: gateBadge } : {}),
    metrics: gateMetrics,
    io: {
      inputs: gateInputs,
      outputs: gateOutputs,
    },
    metadata: gateMetadata,
    mediaAssets,
    screenshots,
  };
}
