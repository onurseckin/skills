/**
 * Single-definition state projection and graceful degradation fallback.
 *
 * Maintains a continuously-updated projection of:
 * - Run and task states, lease holders, and distinct implementer identities per run
 * - Capsule event count and last event timestamp
 * - HEAD, dirty count, ahead/behind git metrics
 * - Named ratchet/gate metrics computed once by a single canonical method
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  GitRunner,
  GitStateSummary,
  LaneConcurrencyMetric,
  LeaseSummary,
  RatchetMetric,
  StateProjection,
  TaskStateSummary,
} from "./types.ts";

export const defaultGitRunner: GitRunner = (args: readonly string[], cwd: string) => {
  try {
    const res = spawnSync("git", [...args], { cwd, encoding: "utf-8", timeout: 5000 });
    return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  } catch (err: unknown) {
    return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
};

function parseGitStatus(cwd: string, runner: GitRunner): GitStateSummary {
  const res = runner(["status", "--porcelain=v2", "--branch"], cwd);
  if (!res.ok) {
    return { head: null, branch: null, dirty_count: 0, ahead: 0, behind: 0, available: false };
  }
  let head: string | null = null,
    branch: string | null = null,
    ahead = 0,
    behind = 0,
    dirty = 0;
  for (const raw of res.stdout.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("# branch.oid ")) {
      const oid = l.slice(13).trim();
      if (oid !== "(initial)" && oid !== "(none)") head = oid;
    } else if (l.startsWith("# branch.head ")) {
      const b = l.slice(14).trim();
      if (b !== "(detached)") branch = b;
    } else if (l.startsWith("# branch.ab ")) {
      for (const p of l.slice(12).trim().split(" ")) {
        if (p.startsWith("+")) ahead = parseInt(p.slice(1), 10) || 0;
        if (p.startsWith("-")) behind = parseInt(p.slice(1), 10) || 0;
      }
    } else if (!l.startsWith("#")) dirty++;
  }
  return { head, branch, dirty_count: dirty, ahead, behind, available: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeReadJson(path: string): unknown | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
  } catch {
    return null;
  }
}

function safeReadLines(path: string): string[] {
  try {
    return existsSync(path)
      ? readFileSync(path, "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export interface ComputeProjectionOptions {
  readonly capsuleDir?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly stateJson?: unknown | undefined;
  readonly eventsJsonlLines?: readonly string[] | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly customMetrics?: readonly RatchetMetric[] | undefined;
}

export function computeStateProjection(options: ComputeProjectionOptions): StateProjection {
  const capsuleDir = options.capsuleDir;
  const repoRoot = options.repoRoot ?? process.cwd();
  const gitRunner = options.gitRunner ?? defaultGitRunner;

  const stateObj = isRecord(options.stateJson)
    ? options.stateJson
    : capsuleDir && isRecord(safeReadJson(join(capsuleDir, "state.json")))
      ? (safeReadJson(join(capsuleDir, "state.json")) as Record<string, unknown>)
      : null;

  const eventLines =
    options.eventsJsonlLines ?? (capsuleDir ? safeReadLines(join(capsuleDir, "events.jsonl")) : []);
  const manifestObj = capsuleDir
    ? (safeReadJson(join(capsuleDir, "manifest.json")) as Record<string, unknown> | null)
    : null;

  const runId =
    typeof stateObj?.["run_id"] === "string"
      ? stateObj["run_id"]
      : typeof manifestObj?.["run_id"] === "string"
        ? manifestObj["run_id"]
        : (capsuleDir?.split("/").pop() ?? "unknown");

  const tasksMap: Record<string, string> = {};
  const tasksList: TaskStateSummary[] = [];
  const leasesList: LeaseSummary[] = [];
  const implementersSet = new Set<string>();

  const rawTasks = stateObj?.["tasks"];
  if (isRecord(rawTasks)) {
    for (const [taskId, rawTask] of Object.entries(rawTasks)) {
      if (!isRecord(rawTask)) continue;
      const status = typeof rawTask["status"] === "string" ? rawTask["status"] : "unknown";
      tasksMap[taskId] = status;
      const label = typeof rawTask["label"] === "string" ? rawTask["label"] : undefined;
      const writeScope = Array.isArray(rawTask["write_scope"])
        ? (rawTask["write_scope"].filter((s) => typeof s === "string") as string[])
        : undefined;

      const leaseObj = isRecord(rawTask["lease"]) ? rawTask["lease"] : null;
      const leaseHolder = typeof leaseObj?.["agent_id"] === "string" ? leaseObj["agent_id"] : null;
      const leaseExpiresAt =
        typeof leaseObj?.["expires_at"] === "string" ? leaseObj["expires_at"] : null;

      if (leaseObj && leaseHolder && status === "leased") {
        leasesList.push({
          task_id: taskId,
          agent_id: leaseHolder,
          role: typeof leaseObj["role"] === "string" ? leaseObj["role"] : "implementer",
          issued_at: typeof leaseObj["issued_at"] === "string" ? leaseObj["issued_at"] : "",
          expires_at: leaseExpiresAt ?? "",
          heartbeat_at:
            typeof leaseObj["heartbeat_at"] === "string" ? leaseObj["heartbeat_at"] : "",
          write_scope: Array.isArray(leaseObj["write_scope"])
            ? (leaseObj["write_scope"].filter((s) => typeof s === "string") as string[])
            : [],
        });
      }

      if (typeof rawTask["original_implementer"] === "string" && rawTask["original_implementer"]) {
        implementersSet.add(rawTask["original_implementer"]);
      }
      if (leaseHolder?.startsWith("implementer")) implementersSet.add(leaseHolder);

      for (const att of Array.isArray(rawTask["attempts"]) ? rawTask["attempts"] : []) {
        if (isRecord(att) && typeof att["agent_id"] === "string") {
          const role = att["role"];
          if (role === "implementer" || att["agent_id"].startsWith("implementer")) {
            implementersSet.add(att["agent_id"]);
          }
        }
      }

      tasksList.push({
        id: taskId,
        status,
        ...(label !== undefined ? { label } : {}),
        ...(writeScope !== undefined ? { write_scope: writeScope } : {}),
        lease_holder: leaseHolder,
        lease_expires_at: leaseExpiresAt,
      });
    }
  }

  if (isRecord(stateObj?.["packets"])) {
    for (const rawPacket of Object.values(stateObj!["packets"] as Record<string, unknown>)) {
      if (
        isRecord(rawPacket) &&
        rawPacket["role"] === "implementer" &&
        typeof rawPacket["agent_id"] === "string"
      ) {
        implementersSet.add(rawPacket["agent_id"]);
      }
    }
  }

  let lastEventTimestamp: string | null = null,
    lastEventSequence: number | null = null;
  for (const line of eventLines) {
    try {
      const p = JSON.parse(line);
      if (isRecord(p)) {
        if (typeof p["timestamp"] === "string") lastEventTimestamp = p["timestamp"];
        if (typeof p["sequence"] === "number") lastEventSequence = p["sequence"];
        if (typeof p["actor"] === "string" && p["actor"].startsWith("implementer"))
          implementersSet.add(p["actor"]);
        if (
          isRecord(p["payload"]) &&
          p["payload"]["role"] === "implementer" &&
          typeof p["payload"]["agent_id"] === "string"
        ) {
          implementersSet.add(p["payload"]["agent_id"]);
        }
      }
    } catch {}
  }

  let runState = "ready";
  const statuses = Object.values(tasksMap);
  if (statuses.length > 0) {
    if (statuses.every((s) => s === "done" || s === "sealed")) runState = "completed";
    else if (statuses.some((s) => s === "failed")) runState = "failed";
    else if (statuses.some((s) => s === "leased" || s === "validating")) runState = "active";
  }

  const distinctImplementers = Array.from(implementersSet).sort();
  const laneCount = tasksList.length;
  const ratio = laneCount > 0 ? distinctImplementers.length / laneCount : 1.0;
  const concurrency: LaneConcurrencyMetric = {
    lane_count: laneCount,
    distinct_implementer_count: distinctImplementers.length,
    distinct_implementers: distinctImplementers,
    ratio: Math.round(ratio * 100) / 100,
  };

  const git = parseGitStatus(repoRoot, gitRunner);
  const completedCount = statuses.filter((s) => s === "done" || s === "sealed").length;
  const unassignedCount = tasksList.filter((t) => t.status === "ready" && !t.lease_holder).length;

  const canonicalMetrics: RatchetMetric[] = [
    {
      name: "implementer_parallelism_ratio",
      value: concurrency.ratio,
      definition:
        "Distinct implementers / task lanes (1.0 asserts zero serial re-use across lanes)",
      passed: concurrency.ratio >= 1.0 || laneCount <= 1,
      direction: "increasing",
    },
    {
      name: "task_completion_rate",
      value: laneCount > 0 ? Math.round((completedCount / laneCount) * 100) / 100 : 1.0,
      definition: "Ratio of completed tasks over total planned tasks",
      passed: laneCount > 0 ? completedCount === laneCount : true,
      direction: "increasing",
    },
    {
      name: "working_tree_cleanliness",
      value: git.dirty_count,
      definition: "Count of uncommitted modified or untracked files in repository worktree",
      passed: git.dirty_count === 0,
      direction: "fixed",
    },
    {
      name: "unassigned_ready_lanes",
      value: unassignedCount,
      definition: "Number of ready tasks waiting without an active lease holder",
      passed: true,
      direction: "decreasing",
    },
    ...(options.customMetrics ?? []),
  ];

  return {
    run_id: runId,
    projected_at: new Date().toISOString(),
    run_state: runState,
    task_states: tasksMap,
    tasks: tasksList,
    lease_holders: leasesList,
    distinct_implementer_identities: distinctImplementers,
    concurrency,
    capsule_event_count: eventLines.length,
    last_event_timestamp: lastEventTimestamp,
    last_event_sequence: lastEventSequence,
    git,
    metrics: canonicalMetrics,
  };
}

export function inspectDirectCapsule(
  capsuleDir: string,
  repoRoot?: string,
  gitRunner?: GitRunner,
): StateProjection {
  return computeStateProjection({
    capsuleDir: resolve(capsuleDir),
    repoRoot: repoRoot ? resolve(repoRoot) : process.cwd(),
    gitRunner,
  });
}
