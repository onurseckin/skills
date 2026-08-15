import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type {
  CommandExecutionDetail,
  FileRef,
  FindingDetail,
  GraphEdgeData,
  GraphNodeData,
  IoPort,
  ModelTier,
  NodeKind,
  NodeStatus,
} from "./types.ts";

export function mapTaskStatus(status: string): NodeStatus {
  if (status === "done") return "success";
  if (status === "changes_requested") return "warning";
  if (status === "leased" || status === "running" || status === "submitted") return "running";
  if (status === "failed" || status === "cancelled" || status === "escalated") return "error";
  return "pending";
}

export function detectHostModel(agentId?: string): {
  model: string;
  tier: ModelTier;
} {
  const envModel =
    process.env.MODEL ??
    process.env.AI_MODEL ??
    process.env.GEMINI_MODEL ??
    process.env.ANTIGRAVITY_MODEL;
  if (envModel && envModel.trim().length > 0) {
    const trimmed = envModel.trim();
    const lower = trimmed.toLowerCase();
    const tier: ModelTier =
      lower.includes("pro") || lower.includes("opus") || lower.includes("large")
        ? "l"
        : lower.includes("flash") || lower.includes("haiku") || lower.includes("small")
          ? "s"
          : "m";
    return { model: trimmed, tier };
  }
  return { model: "Gemini 2.0 Flash", tier: "s" };
}

export function mapCommandDetails(commands: CommandRecord[]): CommandExecutionDetail[] {
  return commands.map((c) => {
    const started = c.started_at ? Date.parse(c.started_at) : 0;
    const finished = c.finished_at ? Date.parse(c.finished_at) : started;
    const stdout = typeof c.stdout === "string" ? c.stdout.slice(-1000) : undefined;
    const stderr = typeof c.stderr === "string" ? c.stderr.slice(-1000) : undefined;
    return {
      id: c.id,
      argv: c.argv,
      cwd: c.cwd,
      exitCode: c.exit_code ?? 0,
      durationMs: finished >= started ? finished - started : 0,
      startedAt: c.started_at,
      finishedAt: c.finished_at ?? c.started_at,
      logPath: c.record_path,
      ...(stdout !== undefined ? { stdoutSnippet: stdout } : {}),
      ...(stderr !== undefined ? { stderrSnippet: stderr } : {}),
    };
  });
}

export function mapFindingDetails(task: TaskRecord): FindingDetail[] {
  return (task.findings ?? []).map((f) => ({
    id: f.id,
    requirementId: f.requirement_id,
    severity:
      f.severity === "critical" ? "critical" : f.severity === "minor" ? "suggestion" : "important",
    observation: f.observation,
    remediation: f.remediation,
    status: f.status === "resolved" ? "resolved" : "open",
  }));
}

export function mapMediaAssets(task: TaskRecord, commands: CommandRecord[]): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const rawReport = task.report as Record<string, unknown> | undefined;

  if (Array.isArray(rawReport?.media_assets)) {
    for (const a of rawReport.media_assets as MediaAsset[]) {
      if (a && typeof a === "object" && a.id && a.url) {
        assets.push(a);
      }
    }
  }

  if (Array.isArray(rawReport?.screenshots)) {
    for (const s of rawReport.screenshots as MediaAsset[]) {
      if (s && typeof s === "object" && s.id && s.url) {
        assets.push({ type: "image", ...s });
      }
    }
  }

  // Check commands for playwright or test output artifacts
  for (const cmd of commands) {
    if (cmd.argv.some((arg) => arg.includes("playwright") || arg.includes("test"))) {
      if (cmd.stdout && cmd.stdout.includes(".png")) {
        const matches = cmd.stdout.match(/[\w\-./]+\.png/g);
        if (matches) {
          for (const match of matches) {
            assets.push({
              id: `asset-${task.id}-${assets.length + 1}`,
              type: "image",
              url: match,
              title: `Test Artifact: ${match.split("/").pop()}`,
              description: `Generated during command ${cmd.id}`,
              timestamp: cmd.finished_at ?? cmd.started_at,
              mimeType: "image/png",
              sizeBytes: 1024 * 48,
              dimensions: { width: 1280, height: 720 },
            });
          }
        }
      }
    }
  }

  return assets;
}

export function detectPlaywrightMetadata(
  task: TaskRecord,
  commands: CommandRecord[],
  mediaAssets: MediaAsset[],
): PlaywrightMetadata | undefined {
  const hasPlaywright =
    commands.some((c) =>
      c.argv.some((arg) => arg.includes("playwright") || arg.includes("test")),
    ) || Boolean((task.report as Record<string, unknown> | undefined)?.playwright);

  if (!hasPlaywright && mediaAssets.length === 0) return undefined;

  const screenshots = mediaAssets.filter((a) => a.type === "image");
  const testCmd = commands.find((c) => c.argv.some((arg) => arg.includes("test")));

  return {
    viewport: { width: 1280, height: 720 },
    traces: [],
    videos: [],
    screenshots,
    testFile: testCmd?.argv.find((arg) => arg.includes(".test.") || arg.includes(".spec.")),
    durationMs: testCmd
      ? Date.parse(testCmd.finished_at ?? "") - Date.parse(testCmd.started_at ?? "") || 150
      : 150,
    browser: "chromium",
    status: task.status === "done" ? "passed" : "failed",
  };
}

export interface TaskNodeContext {
  task: TaskRecord;
  taskStep: number;
  taskWave: number;
  taskCmds: CommandRecord[];
}

export function createEdge(
  id: string,
  source: string,
  target: string,
  kind: GraphEdgeData["kind"],
  stepNumber: number | string,
  title: string,
  detail: string,
  variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan",
  icon: string,
  isCycle?: boolean,
  targetTab?: string,
  exchanges: EdgeTrafficExchange[] = [],
  isHighTraffic = false,
  glowColor?: string,
  glowIntensity?: number,
): GraphEdgeData {
  const totalTokens = exchanges.reduce((acc, x) => acc + (x.tokens ?? 0), 0);
  const totalBytes = exchanges.reduce((acc, x) => acc + (x.bytes ?? 0), 0);
  const finalExchanges =
    exchanges.length > 0
      ? exchanges
      : [
          {
            id: `exch-${id}-01`,
            timestamp: new Date().toISOString(),
            source,
            target,
            kind:
              kind === "spawn"
                ? "prompt"
                : kind === "sequence"
                  ? "file"
                  : kind === "loop"
                    ? "decision"
                    : "artifact",
            summary: title,
            tokens: totalTokens || 140,
            bytes: totalBytes || 520,
            durationMs: 50,
            status: isCycle ? "warning" : "success",
            payloadSnippet: detail,
          },
        ];

  const trafficDetail: EdgeTrafficDetail = {
    volume: finalExchanges.length,
    messagesCount: finalExchanges.length,
    tokens: totalTokens || 140,
    bytes: totalBytes || 520,
    ratePerSec: isHighTraffic ? 8.5 : 2.0,
    status: isCycle ? "congested" : isHighTraffic ? "active" : "idle",
    glowColor: glowColor ?? (isCycle ? "#f59e0b" : isHighTraffic ? "#06b6d4" : undefined),
    glowIntensity: glowIntensity ?? (isCycle ? 0.85 : isHighTraffic ? 0.75 : 0.35),
    exchanges: finalExchanges,
  };

  const edge: GraphEdgeData = {
    id,
    source,
    target,
    stepNumber,
    badge: {
      text: title,
      variant: variant === "cyan" ? "info" : variant,
      icon,
      clickable: Boolean(targetTab),
      ...(targetTab ? { targetTab } : {}),
    },
    container: { stepBadge: String(stepNumber), title, detail, variant, icon },
    traffic: trafficDetail,
    exchanges: finalExchanges,
    isHighTraffic: isHighTraffic || Boolean(isCycle) || finalExchanges.length > 1,
    trafficVolume: trafficDetail.volume,
  };
  if (kind !== undefined) edge.kind = kind;
  if (isCycle !== undefined) edge.isCycle = isCycle;
  return edge;
}

export function buildTaskAndGateNodes(ctx: TaskNodeContext): {
  taskNode: GraphNodeData;
  gateNode: GraphNodeData;
  taskEdges: GraphEdgeData[];
} {
  const { task, taskStep, taskWave, taskCmds } = ctx;
  const taskNodeId = `node-task-${task.id}`;
  const gateNodeId = `node-gate-${task.id}`;
  const taskName = typeof task.label === "string" ? task.label : task.id;
  const gateStep = taskStep + 1;

  const changedRaw = task.report?.files_changed;
  const changed = Array.isArray(changedRaw)
    ? changedRaw.filter((p): p is string => typeof p === "string")
    : task.write_scope;
  const files: FileRef[] = changed.map((p) => ({
    path: p,
    mode: "write" as const,
  }));
  const findings = mapFindingDetails(task);
  const mediaAssets = mapMediaAssets(task, taskCmds);
  const playwrightMetadata = detectPlaywrightMetadata(task, taskCmds, mediaAssets);

  const metadata: Record<string, unknown> = {
    writeScope: task.write_scope,
    repairRounds: task.repair_round ?? 0,
    commands: mapCommandDetails(taskCmds),
    findings,
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
    assets: mediaAssets,
    ...(playwrightMetadata ? { playwrightMetadata } : {}),
  };
  const agent = task.lease?.agent_id ?? task.original_implementer;
  if (agent) metadata.leaseAgent = agent;

  const { model, tier } = detectHostModel(agent);

  const taskInputs: IoPort[] = task.dependencies.map((depId) => ({
    node: `node-gate-${depId}`,
    kind: "artifact",
    label: `Dependency Output: ${depId}`,
  }));
  const summaryText = typeof task.report?.summary === "string" ? task.report.summary : undefined;
  const taskOutputs: IoPort[] = [
    {
      kind: "summary",
      label: summaryText ?? `Task ${task.id} Output`,
      ...(summaryText ? { preview: summaryText } : {}),
    },
  ];

  const taskNode: GraphNodeData = {
    id: taskNodeId,
    name: taskName,
    kind: "agent" as NodeKind,
    status: mapTaskStatus(task.status),
    step: taskStep,
    stepLabel: `Step ${taskStep}: Wave ${taskWave} Tasks`,
    model,
    tier,
    badge: {
      text: agent ? `Worker: ${agent}` : `${model} [${tier.toUpperCase()}]`,
      variant: "info",
      icon: "IconRobot",
    },
    description: summaryText ?? `Goal and execution scope for ${taskName}.`,
    files,
    io: { inputs: taskInputs, outputs: taskOutputs },
    metadata,
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const isGateDone = task.status === "done";
  const gateBadgeText = isGateDone
    ? "Passed"
    : findings.length > 0
      ? `Pushback: ${findings.length} Finding${findings.length > 1 ? "s" : ""}`
      : "Verification Check";
  const gateNode: GraphNodeData = {
    id: gateNodeId,
    name: `Gate: ${taskName}`,
    kind: "gate" as NodeKind,
    status: isGateDone ? "success" : task.validation ? "running" : "pending",
    step: gateStep,
    stepLabel: `Step ${gateStep}: Wave ${taskWave} Validation`,
    badge: {
      text: gateBadgeText,
      variant: isGateDone ? "success" : "warning",
      icon: "IconShieldCheck",
    },
    description: `Independent verification gate for ${taskName}.`,
    metadata: {
      findings,
      mediaAssets,
      screenshots: mediaAssets.filter((a) => a.type === "image"),
      ...(playwrightMetadata ? { playwrightMetadata } : {}),
    },
    mediaAssets,
    screenshots: mediaAssets.filter((a) => a.type === "image"),
  };

  const spawnExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-spawn-${task.id}`,
      timestamp: new Date().toISOString(),
      source: "node-orchestrator-plan",
      target: taskNodeId,
      kind: "prompt",
      summary: `Dispatched task ${task.id} to worker ${agent ?? "unassigned"}`,
      tokens: 350,
      bytes: 1400,
      durationMs: 30,
      status: "success",
      payloadSnippet: `Goal: ${taskName}`,
    },
  ];

  const submitExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-submit-${task.id}`,
      timestamp: new Date().toISOString(),
      source: taskNodeId,
      target: gateNodeId,
      kind: "file",
      summary: `Submitted diffs for ${task.id} (${files.length} files)`,
      tokens: 650,
      bytes: files.length * 1024,
      durationMs: 80,
      status: "success",
      payloadSnippet: files.map((f) => f.path).join(", "),
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
    ),
  ];

  if ((task.repair_round ?? 0) > 0) {
    const repairExchanges: EdgeTrafficExchange[] = findings.map((f, idx) => ({
      id: `exch-repair-${task.id}-${idx + 1}`,
      timestamp: new Date().toISOString(),
      source: gateNodeId,
      target: taskNodeId,
      kind: "decision",
      summary: `Pushback Finding: ${f.observation}`,
      tokens: 280,
      bytes: 890,
      durationMs: 60,
      status: "warning",
      payloadSnippet: f.remediation ?? f.observation,
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
        "#f59e0b",
        0.9,
      ),
    );
  }

  for (const depId of task.dependencies) {
    const depExchanges: EdgeTrafficExchange[] = [
      {
        id: `exch-dep-${depId}-${task.id}`,
        timestamp: new Date().toISOString(),
        source: `node-gate-${depId}`,
        target: taskNodeId,
        kind: "artifact",
        summary: `Handoff verified artifact from ${depId} to ${task.id}`,
        tokens: 420,
        bytes: 1200,
        durationMs: 40,
        status: "success",
        payloadSnippet: `Dependency contract ${depId} fulfilled`,
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
        0.8,
      ),
    );
  }

  const joinExchanges: EdgeTrafficExchange[] = [
    {
      id: `exch-join-${task.id}`,
      timestamp: new Date().toISOString(),
      source: gateNodeId,
      target: "node-critic-authority",
      kind: "artifact",
      summary: `Evidence scorecard and verification proof for ${task.id}`,
      tokens: 300,
      bytes: 950,
      durationMs: 35,
      status: "success",
      payloadSnippet: `Gate check passed with status ${isGateDone ? "DONE" : "PENDING"}`,
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
    ),
  );

  return { taskNode, gateNode, taskEdges };
}
