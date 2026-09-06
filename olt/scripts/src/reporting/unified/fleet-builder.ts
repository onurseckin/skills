import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { TIER_NAMES } from "../../authority/thread/index.ts";
import { listTrackWorktrees, type TrackWorktreeInfo } from "../../workflow/worktree/manager.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { buildSugiyamaDagReport } from "../sugiyama-dag/index.ts";
import { formatFleetDashboard } from "./fleet-renderer.ts";
import { buildAgentMatrixRows, segmentTaskLifecycle } from "./lifecycle-segmenter.ts";
import {
  buildNodesAndEdges,
  computeSupervisoryStats,
  deriveCapsuleScope,
  getCapsuleDoctorHealth,
  resolveSessionActor,
} from "./fleet-builder-helpers.ts";
import type {
  CapsuleFleetSummary,
  FleetReportData,
  GlobalFleetStats,
  UnifiedAgentRow,
} from "./types.ts";

declare module "./types.ts" {
  interface GlobalFleetStats {
    readonly activeWorktrees?: number | undefined;
    readonly worktrees?: readonly TrackWorktreeInfo[] | undefined;
  }
}

export type { CapsuleFleetSummary, GlobalFleetStats, FleetReportData };

export function discoverActiveCapsules(repoRoot: string): string[] {
  const dir = resolveCapsulesDir(repoRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((e) => !e.startsWith(".") && e !== "archive" && e !== ".locks")
      .map((e) => {
        const full = resolve(dir, e);
        try {
          const st = statSync(full);
          const ok =
            st.isDirectory() &&
            (existsSync(resolve(full, "state.json")) || existsSync(resolve(full, "manifest.json")));
          return ok ? { path: full, mtime: st.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is { path: string; mtime: number } => x !== null)
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => d.path);
  } catch {
    return [];
  }
}

export function generateFleetReport(repoRoot: string): FleetReportData {
  const capsulePaths = discoverActiveCapsules(repoRoot);
  const capsules: CapsuleFleetSummary[] = [];
  const allAgentRows: UnifiedAgentRow[] = [];
  let [gCoding, gValidating, gStandby, gSatisfied, gBlocked, globalTasks, maxWaves] = [
    0, 0, 0, 0, 0, 0, 0,
  ];

  for (const capsulePath of capsulePaths) {
    let manifest: Record<string, unknown> | null = null;
    let state: WorkflowState | null = null;
    try {
      const mPath = resolve(capsulePath, "manifest.json");
      if (existsSync(mPath)) manifest = JSON.parse(readFileSync(mPath, "utf-8"));
      const sPath = resolve(capsulePath, "state.json");
      if (existsSync(sPath)) state = JSON.parse(readFileSync(sPath, "utf-8"));
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

    gCoding += seg.implementersActive.length;
    gValidating += seg.validatorsActive.length;
    gStandby += seg.standbyTaskIds.length;
    gSatisfied += seg.satisfiedTaskIds.length;
    gBlocked += seg.blockedTaskIds.length;
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

    if (sugiyamaReport.metrics.totalWaves > maxWaves) maxWaves = sugiyamaReport.metrics.totalWaves;

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
      waves: sugiyamaReport.metrics.totalWaves,
      tasks,
      agents: capsuleAgents,
      sugiyamaReport,
    });
  }

  const uniqueAgentMap = new Map<string, UnifiedAgentRow>();
  for (const row of allAgentRows) {
    if (!uniqueAgentMap.has(row.agentId)) uniqueAgentMap.set(row.agentId, row);
  }

  const sessionActor = resolveSessionActor(repoRoot);
  if (sessionActor && !uniqueAgentMap.has(sessionActor.agentId)) {
    const bindingFleetId = sessionActor.fleetId ?? capsules[0]?.runId ?? "session";
    const sessionRow: UnifiedAgentRow = {
      agentId: sessionActor.agentId,
      tier: sessionActor.tier,
      tierName: TIER_NAMES[sessionActor.tier] ?? `Tier ${sessionActor.tier}`,
      role: sessionActor.role,
      status: "active",
      taskId: sessionActor.taskId ?? null,
      attempt: null,
      fleetId: bindingFleetId,
    };
    uniqueAgentMap.set(sessionRow.agentId, sessionRow);
  }

  const agentRoster = [...uniqueAgentMap.values()].sort((a, b) =>
    a.tier !== b.tier ? a.tier - b.tier : a.agentId.localeCompare(b.agentId),
  );

  const supervisoryHealth = computeSupervisoryStats(agentRoster);
  const trackWorktrees = listTrackWorktrees({ repoRoot });
  const activeWorktrees = trackWorktrees.filter((w) => w.status === "active").length;

  const stats: GlobalFleetStats = {
    activeFleets: capsules.length,
    totalSubagents: agentRoster.length,
    globalTasks,
    totalWaves: maxWaves,
    activeWorktrees,
    worktrees: trackWorktrees,
    occupancy: {
      coding: gCoding,
      validating: gValidating,
      standby: gStandby,
      satisfied: gSatisfied,
      blocked: gBlocked,
    },
    supervisoryHealth,
  };

  const fleetData: FleetReportData = {
    repoRoot,
    stats,
    capsules,
    agentRoster,
    markdown: "",
  };
  return { ...fleetData, markdown: formatFleetDashboard(fleetData) };
}
