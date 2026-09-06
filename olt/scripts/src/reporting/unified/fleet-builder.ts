import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { computeCapsuleDoctorFacts } from "../doctor/facts.ts";
import { extractLeaseAgentId } from "../lease-agent-extractor.ts";
import {
  buildSugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../sugiyama-dag/index.ts";
import { formatFleetDashboard } from "./fleet-renderer.ts";
import { buildAgentMatrixRows, segmentTaskLifecycle } from "./lifecycle-segmenter.ts";
import type {
  CapsuleFleetSummary,
  FleetReportData,
  GlobalFleetStats,
  UnifiedAgentRow,
} from "./types.ts";

export type { CapsuleFleetSummary, GlobalFleetStats, FleetReportData };

export function discoverActiveCapsules(repoRoot: string): string[] {
  const capsulesDir = resolveCapsulesDir(repoRoot);
  if (!existsSync(capsulesDir)) return [];

  try {
    const entries = readdirSync(capsulesDir);
    const discovered: { path: string; mtime: number }[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      if (entry === "archive" || entry === ".locks") continue;
      const fullPath = resolve(capsulesDir, entry);
      try {
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          const hasState = existsSync(resolve(fullPath, "state.json"));
          const hasManifest = existsSync(resolve(fullPath, "manifest.json"));
          if (!hasState && !hasManifest) continue;
          discovered.push({ path: fullPath, mtime: st.mtimeMs });
        }
      } catch {}
    }
    discovered.sort((a, b) => b.mtime - a.mtime);
    return discovered.map((d) => d.path);
  } catch {
    return [];
  }
}

function deriveCapsuleScope(
  runId: string,
  manifest?: Record<string, unknown> | null,
  promptPath?: string,
): string {
  if (typeof manifest?.title === "string" && manifest.title.trim()) return manifest.title.trim();
  if (typeof manifest?.scope === "string" && manifest.scope.trim()) return manifest.scope.trim();
  if (promptPath && existsSync(promptPath)) {
    try {
      const content = readFileSync(promptPath, "utf-8");
      const firstLine = content.split("\n").find((l) => l.trim().startsWith("#"));
      if (firstLine) return firstLine.replace(/^#+\s*/, "").trim();
    } catch {}
  }
  if (runId.includes("dag") || runId.includes("reporting")) return "Reporting & DAG Engine";
  if (runId.includes("cluster-engine")) return "Engine & Scheduler Defects";
  if (runId.includes("cluster-tooling")) return "Tooling & CLI Defects";
  if (runId.includes("cluster-validation")) return "Validation Gate Defects";
  if (runId.includes("cluster-mind")) return "Mind Cadence Defects";
  if (runId.includes("cluster-core")) return "Core Shared Defects";
  if (runId.startsWith("mind-gen")) return "Mind Autonomous Cadence";

  return runId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getCapsuleDoctorHealth(capsulePath: string): string {
  try {
    const facts = computeCapsuleDoctorFacts(capsulePath);
    if (facts.healthy) return "✅ Healthy";
    if (facts.criticalIssues.length > 0) return "❌ Critical";
    return "⚠️ Warning";
  } catch {
    return "⚪ Unchecked";
  }
}

function buildNodesAndEdges(
  tasks: readonly TaskRecord[],
  state?: WorkflowState | null,
): { nodes: SugiyamaNode[]; edges: SugiyamaEdge[] } {
  const nodes: SugiyamaNode[] = [];
  const edges: SugiyamaEdge[] = [];

  for (const t of tasks) {
    const deps = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
    const lease = isRecord(t.lease) ? t.lease : null;
    nodes.push({
      id: t.id,
      label: typeof t.label === "string" ? t.label : t.id,
      status: typeof t.status === "string" ? t.status : "proposed",
      priority: typeof t.priority === "number" ? t.priority : 50,
      writeScope: Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [],
      resourceScope: Array.isArray(t.resource_scope) ? (t.resource_scope as string[]) : [],
      gate: typeof t.gate === "string" ? t.gate : undefined,
      dependencies: deps,
      assignedAgent: lease ? extractLeaseAgentId(lease) : null,
      attempt: lease && typeof lease.attempt === "number" ? lease.attempt : null,
      effort: typeof t.effort === "number" ? t.effort : 1,
    });
    for (const dep of deps) edges.push({ from: dep, to: t.id });
  }

  if (nodes.length === 0 && Array.isArray(state?.planning_buffer)) {
    for (const p of state.planning_buffer as {
      id: string;
      label?: string;
      deps?: string[];
      effort?: number;
      writeScope?: string[];
    }[]) {
      const deps = Array.isArray(p.deps) ? p.deps : [];
      nodes.push({
        id: p.id,
        label: p.label || p.id,
        status: "ready",
        priority: 50,
        writeScope: Array.isArray(p.writeScope) ? p.writeScope : [],
        dependencies: deps,
        effort: typeof p.effort === "number" ? p.effort : 1,
      });
      for (const dep of deps) edges.push({ from: dep, to: p.id });
    }
  }

  return { nodes, edges };
}

export function generateFleetReport(repoRoot: string): FleetReportData {
  const capsulePaths = discoverActiveCapsules(repoRoot);
  const capsules: CapsuleFleetSummary[] = [];
  const allAgentRows: UnifiedAgentRow[] = [];

  let [
    globalCoding,
    globalValidating,
    globalStandby,
    globalSatisfied,
    globalBlocked,
    globalTasks,
    maxWaves,
  ] = [0, 0, 0, 0, 0, 0, 0];

  for (const capsulePath of capsulePaths) {
    let manifest: Record<string, unknown> | null = null;
    let state: WorkflowState | null = null;

    try {
      const mPath = resolve(capsulePath, "manifest.json");
      if (existsSync(mPath))
        manifest = JSON.parse(readFileSync(mPath, "utf-8")) as Record<string, unknown>;
      const sPath = resolve(capsulePath, "state.json");
      if (existsSync(sPath)) state = JSON.parse(readFileSync(sPath, "utf-8")) as WorkflowState;
    } catch {}

    const runId = typeof manifest?.run_id === "string" ? manifest.run_id : basename(capsulePath);
    const scope = deriveCapsuleScope(runId, manifest, resolve(capsulePath, "prompt.md"));
    const tasks = Object.values((state?.tasks ?? {}) as Record<string, TaskRecord>);
    const seg = segmentTaskLifecycle(tasks);

    const completion = state?.completion_result as { status: string } | undefined;
    const phase =
      completion?.status === "complete"
        ? "Completed"
        : state?.graph
          ? "Executing"
          : tasks.length > 0 ||
              (Array.isArray(state?.planning_buffer) && state.planning_buffer.length > 0)
            ? "Planning"
            : "Initialized";

    globalCoding += seg.implementersActive.length;
    globalValidating += seg.validatorsActive.length;
    globalStandby += seg.standbyTaskIds.length;
    globalSatisfied += seg.satisfiedTaskIds.length;
    globalBlocked += seg.blockedTaskIds.length;
    globalTasks += tasks.length;

    const rawAgents = (Array.isArray(state?.agents) ? state.agents : []) as Record<
      string,
      unknown
    >[];
    const capsuleAgents = buildAgentMatrixRows(
      rawAgents,
      tasks,
      seg.implementersActive,
      seg.validatorsActive,
    ).map((a) => ({ ...a, fleetId: runId }));
    allAgentRows.push(...capsuleAgents);

    const { nodes, edges } = buildNodesAndEdges(tasks, state);
    const sugiyamaReport = buildSugiyamaDagReport(nodes, edges, {
      runRoot: capsulePath,
      runId,
      isCompiled: state?.graph !== undefined && state?.graph !== null,
      graphRevision:
        isRecord(state?.graph) && typeof state?.graph.revision === "number"
          ? state.graph.revision
          : null,
      maxParallel: 4,
      boxStyle: "rounded",
    });

    const capsuleWaves = sugiyamaReport.metrics.totalWaves;
    if (capsuleWaves > maxWaves) maxWaves = capsuleWaves;

    capsules.push({
      runId,
      runRoot: capsulePath,
      scope,
      phase,
      totalTasks: tasks.length,
      coding: seg.implementersActive.length,
      validating: seg.validatorsActive.length,
      ready: seg.standbyTaskIds.length,
      blocked: seg.blockedTaskIds.length,
      done: seg.satisfiedTaskIds.length,
      doctorHealth: getCapsuleDoctorHealth(capsulePath),
      waves: capsuleWaves,
      tasks,
      agents: capsuleAgents,
      sugiyamaReport,
    });
  }

  const uniqueAgentMap = new Map<string, UnifiedAgentRow>();
  for (const row of allAgentRows) {
    if (!uniqueAgentMap.has(row.agentId)) uniqueAgentMap.set(row.agentId, row);
  }
  const agentRoster = [...uniqueAgentMap.values()].sort((a, b) =>
    a.tier !== b.tier ? a.tier - b.tier : a.agentId.localeCompare(b.agentId),
  );

  let [hasMind, hasMindAuditor, skillAuditorCount] = [false, false, 0];
  for (const a of agentRoster) {
    const role = a.role.toLowerCase();
    const id = a.agentId.toLowerCase();
    if (a.status === "active") {
      if (
        role === "mind" ||
        (role.includes("mind") && !role.includes("auditor")) ||
        id.startsWith("mind-gen") ||
        id === "mind"
      )
        hasMind = true;
      if (
        role.includes("mind-auditor") ||
        role.includes("mind_auditor") ||
        id.includes("mind_auditor") ||
        id.includes("mind-auditor")
      )
        hasMindAuditor = true;
      if (
        role.includes("skill-auditor") ||
        role.includes("skill_auditor") ||
        id.includes("skill_auditor") ||
        id.includes("skill-auditor")
      )
        skillAuditorCount += 1;
    }
  }

  const stats: GlobalFleetStats = {
    activeFleets: capsules.length,
    totalSubagents: agentRoster.length,
    globalTasks,
    totalWaves: maxWaves,
    occupancy: {
      coding: globalCoding,
      validating: globalValidating,
      standby: globalStandby,
      satisfied: globalSatisfied,
      blocked: globalBlocked,
    },
    supervisoryHealth: {
      mind: hasMind ? "Active" : "Inactive",
      mindAuditor: hasMindAuditor ? "Active" : "Inactive",
      skillAuditor: skillAuditorCount === 1 ? "1/1" : `${skillAuditorCount}/1`,
      healthy: hasMind ? hasMindAuditor && skillAuditorCount === 1 : true,
    },
  };

  const fleetData: FleetReportData = { repoRoot, stats, capsules, agentRoster, markdown: "" };
  return { ...fleetData, markdown: formatFleetDashboard(fleetData) };
}
