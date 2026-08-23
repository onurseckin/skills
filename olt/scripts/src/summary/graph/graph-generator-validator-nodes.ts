import {
  buildNodeTelemetry,
  buildNodeTools,
  reportedTokenUsage,
} from "../metrics/agent-telemetry.ts";
import { mapGateStatus, type TaskNodeContext } from "./graph-node-context.ts";
import { computeGateTiming, computeGateTokens } from "../metrics/metrics-collector.ts";
import { buildNodeBrowserTests } from "../formatters/browser-tests.ts";
import { buildNodeScripts } from "../markdown/node-evidence.ts";
import { earliestOpenValidation } from "../../workflow/review/validation-state.ts";
import { isValidatorDomain, type ValidatorDomain } from "../../core/contracts/workflow.ts";
import type { BadgeDetail, GraphNodeData, IoPort, NodeKind, NodeMetrics } from "../types.ts";

function resolvedValidatorDomain(rawDomain: unknown): ValidatorDomain | undefined {
  return typeof rawDomain === "string" && isValidatorDomain(rawDomain) ? rawDomain : undefined;
}

function validatorBadge(ctx: TaskNodeContext): BadgeDetail {
  const { task } = ctx;
  const probes = task.probe_round ?? 0;
  const validation = earliestOpenValidation(task);
  if (validation?.verdict === "probe" || (probes > 0 && task.status === "validating")) {
    return {
      text: `Adversarial Probe (Round ${probes})`,
      variant: "info",
      icon: "IconSearch",
      targetTab: "feedback",
    };
  }
  if (task.status === "changes_requested") {
    return {
      text: `Pushback: ${ctx.findings.length} Finding${ctx.findings.length === 1 ? "" : "s"}`,
      variant: "warning",
      icon: "IconAlertTriangle",
      targetTab: "feedback",
    };
  }
  if (task.status === "done" || task.status === "validated") {
    return { text: "Verification Complete", variant: "success", icon: "IconShieldCheck" };
  }
  return { text: "Auditing", variant: "info", icon: "IconShield" };
}

function validatorIo(ctx: TaskNodeContext): { inputs: IoPort[]; outputs: IoPort[] } {
  const { task, files, findings } = ctx;
  const probes = task.probe_round ?? 0;
  const validation = earliestOpenValidation(task);
  const inputs: IoPort[] = [
    {
      node: ctx.taskNodeId,
      kind: "file",
      label: "Task Submission",
      preview: `${files.length} modified files handed off for verification`,
    },
    {
      node: "node-orchestrator-plan",
      kind: "artifact",
      label: "Acceptance Criteria",
      preview: `Requirements bound to ${task.id}: ${task.requirement_ids.join(", ")}`,
    },
  ];

  const outputs: IoPort[] = [
    {
      kind: "decision",
      label: "Verification Verdict",
      preview:
        validation?.verdict !== undefined
          ? `Recorded verdict: ${validation.verdict}`
          : `Task status: ${task.status}`,
    },
    {
      kind: "artifact",
      label: "Validator Findings",
      preview: `${findings.length} findings recorded (${findings.filter((f) => f.status === "resolved").length} resolved)`,
    },
  ];
  if (probes > 0) {
    outputs.push({
      kind: "decision",
      label: "Adversarial Probe Demands",
      preview: `${probes} probe round${probes === 1 ? "" : "s"} demanding proof`,
    });
  }
  return { inputs, outputs };
}

export function buildValidatorNode(ctx: TaskNodeContext): GraphNodeData {
  const { task, validatorId, validatorCommands, ledger } = ctx;
  const nodeId = ctx.validatorNodeId ?? `node-validator-${task.id}`;
  const assets = ctx.validatorAssets;

  const telemetry = buildNodeTelemetry(validatorId, ledger);
  const tools = buildNodeTools(validatorId, ledger);
  const timingBreakdown = computeGateTiming(task, ctx.events, validatorCommands);
  const tokens = computeGateTokens(
    task,
    validatorCommands,
    reportedTokenUsage(validatorId, ledger),
  );

  const metrics: NodeMetrics = {
    ...(tokens.inputTokens !== undefined ? { tokensIn: tokens.inputTokens } : {}),
    ...(tokens.outputTokens !== undefined ? { tokensOut: tokens.outputTokens } : {}),
    ...(tokens.costUsd !== undefined ? { costUsd: tokens.costUsd } : {}),
    ...(timingBreakdown ? { durationMs: timingBreakdown.wallDurationMs } : {}),
    commandCount: validatorCommands.length,
    retries: task.repair_round ?? 0,
    tokens,
    ...(timingBreakdown ? { timingBreakdown } : {}),
  };

  const browserTests = buildNodeBrowserTests(validatorCommands, ctx.runRoot);
  const io = validatorIo(ctx);
  const openValidation = earliestOpenValidation(task);
  const domain = resolvedValidatorDomain(openValidation?.domain);
  const domainLabel = domain ?? "unknown";
  const plan = openValidation?.plan;
  const description =
    typeof plan === "string" && plan.trim().length > 0
      ? plan
      : `Independent verification of ${ctx.taskName}.`;

  return {
    id: nodeId,
    name: validatorId
      ? `Validator (${domainLabel}): ${validatorId}`
      : `Validator (${domainLabel}): ${ctx.taskName}`,
    description,
    kind: "agent" as NodeKind,
    status: mapGateStatus(task),
    step: ctx.gateStep,
    stepLabel: `Wave ${ctx.taskWave} · Verification`,
    badge: validatorBadge(ctx),
    ...(telemetry ? { telemetry } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    scripts: buildNodeScripts(validatorCommands, ctx.runRoot),
    ...(browserTests.length > 0 ? { browserTests } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    metrics,
    io: { inputs: io.inputs, outputs: io.outputs },
    metadata: {
      role: "validator",
      validatorDomain: domainLabel,
      ...(validatorId ? { agentId: validatorId, validatorId } : {}),
      findings: ctx.findings,
      repairRounds: task.repair_round ?? 0,
      probeRounds: task.probe_round ?? 0,
      validationHistory: task.validation_history ?? [],
      ...(openValidation?.verdict !== undefined ? { verdict: openValidation.verdict } : {}),
    },
  };
}
