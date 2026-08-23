export interface DagNodeSummary {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly priority: number;
  readonly writeScope: readonly string[];
  readonly resourceScope: readonly string[];
  readonly gate: string;
  readonly dependencies: readonly string[];
  readonly assignedAgent: string | null;
  readonly assignedRole?: string | null | undefined;
  readonly assignedTool?: string | null | undefined;
  readonly attempt: number | null;
  readonly wave: number;
  readonly criticalDepth: number;
  readonly descendantCount: number;
  readonly effort?: number | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
}

export interface DependencyForensicItem {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly reason: string;
  readonly edgeType:
    | "dataflow"
    | "scope_conflict"
    | "explicit_justification"
    | "prerequisite_gate"
    | "declared_dep";
}

export interface DagWaveMetrics {
  readonly totalWaves: number;
  readonly maxParallelLanes: number;
  readonly criticalPathLength: number;
  readonly averageWaveConcurrency: number;
  readonly serialBottlenecks: number;
  readonly parallelEligibleChains: number;
  readonly totalWork: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly optimalConcurrency: number;
}

export interface VisualDagWave {
  readonly wave: number;
  readonly tasks: readonly DagNodeSummary[];
}

export interface VisualDagRenderOptions {
  readonly detailed?: boolean | undefined;
  readonly forensics?: readonly DependencyForensicItem[] | undefined;
  readonly metrics?: DagWaveMetrics | undefined;
}

export function statusGlyph(status: string, hasDeps = false): string {
  switch (status) {
    case "done":
    case "satisfied":
      return "(✓ SATISFIED)";
    case "leased":
    case "running":
      return "(🟢 ACTIVE)";
    case "validating":
      return "(🔵 VALIDATING)";
    case "validated":
      return "(🟣 VALIDATED)";
    case "ready":
    case "retry_ready":
      return "(○ READY)";
    case "draft":
      return hasDeps ? "(⏳ BLOCKED)" : "(○ READY)";
    case "changes_requested":
      return "(🔴 CHANGES_REQ)";
    case "failed":
      return "(❌ FAILED)";
    case "escalated":
      return "(🚨 ESCALATED)";
    case "proposed":
    case "blocked":
    default:
      return "(⏳ BLOCKED)";
  }
}

export function statusBadge(status: string): string {
  return statusGlyph(status);
}

export function activeAgentBadge(task: DagNodeSummary): string {
  const isActivelyLeased =
    (task.status === "leased" || task.status === "running" || task.status === "validating") &&
    Boolean(task.assignedAgent);
  if (!isActivelyLeased || !task.assignedAgent) {
    return "";
  }
  const role = task.assignedRole ?? (task.status === "validating" ? "validator" : "implementer");
  const actionPrefix = task.status === "validating" ? "VALIDATING" : "LEASED";
  return ` [⚡ ${actionPrefix}: ${task.assignedAgent} (${role})]`;
}

export function formatBox(
  rows: readonly string[],
  boxWidth = 63,
  hasDownConnector = false,
): string[] {
  const innerWidth = boxWidth - 4;
  const topBorder = `┌${"─".repeat(boxWidth - 2)}┐`;

  const formattedRows = rows.map((row) => {
    const padding = Math.max(0, innerWidth - row.length);
    return `│ ${row}${" ".repeat(padding)} │`;
  });

  const mid = Math.floor((boxWidth - 3) / 2);
  const rightDashes = boxWidth - 3 - mid;
  const bottomBorder = hasDownConnector
    ? `└${"─".repeat(mid)}┬${"─".repeat(rightDashes)}┘`
    : `└${"─".repeat(boxWidth - 2)}┘`;

  return [topBorder, ...formattedRows, bottomBorder];
}

export function renderNodeBox(
  task: DagNodeSummary,
  options: {
    detailed?: boolean | undefined;
    hasDownConnector?: boolean | undefined;
    forensics?: readonly DependencyForensicItem[] | undefined;
    boxWidth?: number | undefined;
  } = {},
): string[] {
  const glyph = statusGlyph(task.status, task.dependencies.length > 0);
  const agentBadge = activeAgentBadge(task);
  const labelSuffix = task.label && task.label !== task.id ? ` • ${task.label}` : "";
  const titleLine = `${glyph} ${task.id}${labelSuffix}${agentBadge}`;

  const role = task.assignedRole ?? (task.assignedAgent ? "implementer" : "unassigned");
  const work = typeof task.effort === "number" ? task.effort : 1;
  const span = task.criticalDepth + 1;

  const rows: string[] = [titleLine];

  if (task.dependencies.length === 0) {
    rows.push(`Role: ${role} | Phase: Wave ${task.wave} | Work: ${work} | Span: ${span}`);
  } else {
    rows.push(`Role: ${role} | Needs: ${task.dependencies.join(", ")}`);
    rows.push(`Phase: Wave ${task.wave} | Work: ${work} | Span: ${span}`);
  }

  if (options.detailed || task.writeScope.length > 0) {
    const scopes = task.writeScope.length > 0 ? task.writeScope.join(", ") : "none";
    rows.push(`Scope:  ${scopes}`);
  }

  if (task.dependencies.length > 0) {
    rows.push(`Deps:   ${task.dependencies.join(", ")}`);
    for (const depId of task.dependencies) {
      const explicitReason = task.depReasons?.[depId];
      const forensic = options.forensics?.find(
        (f) => f.fromTaskId === depId && f.toTaskId === task.id,
      );
      const reason =
        explicitReason && explicitReason.trim().length > 0
          ? explicitReason.trim()
          : forensic?.reason;
      if (reason) {
        rows.push(`↳ Dep on ${depId}: ${reason}`);
      }
    }
  }

  if (options.detailed && task.gate) {
    rows.push(`Gate:   ${task.gate}`);
  }

  const isActivelyLeased =
    (task.status === "leased" || task.status === "running" || task.status === "validating") &&
    Boolean(task.assignedAgent);

  if (!isActivelyLeased && task.assignedAgent) {
    const attemptStr = task.attempt !== null ? ` (Attempt #${task.attempt})` : "";
    const toolStr = task.assignedTool ? ` • Tool: ${task.assignedTool}` : "";
    rows.push(`Agent:  ${task.assignedAgent}${attemptStr}${toolStr}`);
  } else if (isActivelyLeased && task.assignedTool) {
    rows.push(`Tool:   ${task.assignedTool}`);
  }

  const maxRowLen = Math.max(...rows.map((r) => r.length));
  const defaultWidth = options.boxWidth ?? 63;
  const targetWidth = Math.max(defaultWidth, maxRowLen + 4);
  const finalWidth = targetWidth % 2 === 0 ? targetWidth + 1 : targetWidth;

  return formatBox(rows, finalWidth, options.hasDownConnector ?? false);
}

export function renderVisualDag(
  waves: readonly VisualDagWave[],
  options: VisualDagRenderOptions = {},
): string {
  if (waves.length === 0) {
    return (
      "  ┌──────────────────────────────────────────────┐\n" +
      "  │  (No tasks declared in planning buffer/graph) │\n" +
      "  └──────────────────────────────────────────────┘"
    );
  }

  const lines: string[] = [];
  const detailed = options.detailed ?? false;
  const forensics = options.forensics;

  for (let w = 0; w < waves.length; w += 1) {
    const waveEntry = waves[w]!;
    const waveNum = waveEntry.wave;
    const waveTasks = waveEntry.tasks;

    const waveStatuses = [...new Set(waveTasks.map((t) => t.status))].join("/");
    const hasActiveTasks = waveTasks.some(
      (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
    );
    const activeWaveBadge = hasActiveTasks ? " ⚡ [ACTIVE EXECUTION SUBGRAPH]" : "";
    const headerTitle = ` WAVE ${waveNum} (${waveTasks.length} ${waveTasks.length === 1 ? "lane" : "lanes"} • ${waveStatuses})${activeWaveBadge} `;

    // Compute max box width needed for this wave
    let maxBoxWidth = 63;
    for (const task of waveTasks) {
      const glyph = statusGlyph(task.status, task.dependencies.length > 0);
      const agentBadge = activeAgentBadge(task);
      const labelSuffix = task.label && task.label !== task.id ? ` • ${task.label}` : "";
      const titleLen = `${glyph} ${task.id}${labelSuffix}${agentBadge}`.length;
      const scopesLen =
        task.writeScope.length > 0 ? `Scope:  ${task.writeScope.join(", ")}`.length : 0;
      const depsLen =
        task.dependencies.length > 0 ? `Deps:   ${task.dependencies.join(", ")}`.length : 0;
      const maxLen = Math.max(titleLen, scopesLen, depsLen, 55);
      const target = maxLen + 4;
      const finalW = target % 2 === 0 ? target + 1 : target;
      if (finalW > maxBoxWidth) maxBoxWidth = finalW;
    }

    const barLength = Math.max(2, maxBoxWidth - 3 - headerTitle.length);
    const headerLine = `┌─${headerTitle}${"─".repeat(barLength)}┐`;
    lines.push(headerLine);

    const isLastWave = w === waves.length - 1;
    const mid = Math.floor((maxBoxWidth - 3) / 2);
    const connectorPad = " ".repeat(mid + 1);

    for (let t = 0; t < waveTasks.length; t += 1) {
      const task = waveTasks[t]!;
      const isLastTaskInWave = t === waveTasks.length - 1;
      const hasDownConnector = isLastTaskInWave ? !isLastWave : true;

      const boxLines = renderNodeBox(task, {
        detailed,
        hasDownConnector,
        forensics,
        boxWidth: maxBoxWidth,
      });
      lines.push(...boxLines);

      if (!isLastTaskInWave) {
        lines.push(`${connectorPad}│`);
        const lanePad = Math.max(0, mid - 6);
        lines.push(`${" ".repeat(lanePad)}──┬── ──▶ [PARALLEL LANE]`);
        lines.push(`${connectorPad}│`);
      }
    }

    if (!isLastWave) {
      lines.push(`${connectorPad}│`);
      lines.push(`${connectorPad}▼`);
    }
  }

  return lines.join("\n");
}

export function renderAsciiDag(
  waves: readonly { wave: number; tasks: readonly DagNodeSummary[] }[],
  detailed = false,
  forensics?: readonly DependencyForensicItem[],
): string {
  return renderVisualDag(waves, { detailed, forensics });
}
