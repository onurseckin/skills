import { dagViewCommand, type DagViewReport } from "../cli/commands/dag-view.ts";
import { basename } from "node:path";

export interface DagJsonCoordinates {
  rank: number;
  lane: number;
}

export interface DagJsonLease {
  agentId: string;
  taskId: string | null;
  role: string;
  status: string;
  attempt: number | null;
  tool: string | null;
}

export interface DagJsonMetrics {
  work: number;
  span: number;
  parallelWidth: number;
  speedupFactor: number;
}

export interface DagJsonDependency {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export interface DagJsonNode {
  id: string;
  label: string;
  status: string;
  coordinates: DagJsonCoordinates;
  effort: number;
}

export interface DagJsonReport {
  runId: string;
  nodes: DagJsonNode[];
  edges: DagJsonDependency[];
  leases: DagJsonLease[];
  metrics: DagJsonMetrics;
}

export function generateDagJsonReport(
  runRoot: string,
  injectedDagView?: DagViewReport,
): DagJsonReport {
  const flags = { run: runRoot };
  const dagView = injectedDagView ?? (dagViewCommand(flags) as unknown as DagViewReport);

  const nodes: DagJsonNode[] = (dagView.nodes || []).map((n) => {
    return {
      id: n.id,
      label: n.label,
      status: n.status,
      coordinates: {
        rank: n.wave,
        lane: 0,
      },
      effort: n.effort ?? 1,
    };
  });

  const waveGroups = new Map<number, DagJsonNode[]>();
  for (const n of nodes) {
    const group = waveGroups.get(n.coordinates.rank) || [];
    group.push(n);
    waveGroups.set(n.coordinates.rank, group);
  }
  for (const group of waveGroups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < group.length; i++) {
      group[i]!.coordinates.lane = i;
    }
  }

  const leases: DagJsonLease[] = (dagView.active_agents ?? []).map((a) => ({
    agentId: a.id,
    taskId: a.taskId,
    role: a.role,
    status: a.status,
    attempt: a.attempt,
    tool: a.tool ?? null,
  }));

  const metrics: DagJsonMetrics = {
    work: dagView.metrics?.totalWork ?? 0,
    span: dagView.metrics?.span ?? 0,
    parallelWidth: dagView.metrics?.maxParallelLanes ?? 0,
    speedupFactor: dagView.metrics?.parallelismFactor ?? 0,
  };

  const edges: DagJsonDependency[] = (dagView.dependency_forensics ?? []).map((d) => {
    let type = "hard";
    if (d.edgeType === "explicit_justification") type = "soft";
    if (d.edgeType === "scope_conflict") type = "authority";
    return {
      from: d.fromTaskId,
      to: d.toTaskId,
      type,
      reason: d.reason,
    };
  });

  return {
    runId: basename(runRoot),
    nodes,
    edges,
    leases,
    metrics,
  };
}

export function isDagJsonReport(value: unknown): value is DagJsonReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.runId === "string" &&
    Array.isArray(rec.nodes) &&
    Array.isArray(rec.edges) &&
    Array.isArray(rec.leases) &&
    typeof rec.metrics === "object" &&
    rec.metrics !== null
  );
}

export interface GduiIntegrityResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export function validateGduiReportIntegrity(report: unknown): GduiIntegrityResult {
  const issues: string[] = [];
  if (!isDagJsonReport(report)) {
    issues.push("Invalid report structure: fails isDagJsonReport schema check");
    return { valid: false, issues };
  }
  if (typeof report.runId !== "string" || report.runId.trim().length === 0) {
    issues.push("Missing or invalid runId");
  }
  for (const node of report.nodes) {
    if (!node.id) issues.push("Node missing id");
    if (node.coordinates.rank < 0 || node.coordinates.lane < 0) {
      issues.push(`Node ${node.id} has invalid coordinates rank=${node.coordinates.rank}, lane=${node.coordinates.lane}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

