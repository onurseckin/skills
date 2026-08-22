import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentGrantRecord } from "../../contracts/agents.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun, recoverProjection, transact, verifyIntegrity } from "../../store/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { abandonAttempt } from "../../workflow/lease/abandon.ts";
import { isAttemptOpen } from "../../workflow/lease/attempt-state.ts";
import { releaseAgentGrant } from "../../workflow/agents/grants.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { readWorktreeLedger } from "../../workflow/worktree/ledger.ts";
import { reclaimOrphanedWorktrees, recordReclaim } from "../../workflow/worktree/reclaim.ts";
import {
  systemClock,
  type Clock,
  type TaskRecord,
  type WorkflowState,
} from "../../workflow/types.ts";
import { runSupervisionTick } from "../../orchestrator/supervision-tick.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { installedRuntimeFreshness } from "../../installer/runtime-freshness.ts";
import { validateSkillSource } from "../../installer/source-validation.ts";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { resolveCharterPath } from "../charter.ts";
import { writeLastPulse } from "../last-pulse.ts";

export interface RescueLaneOptions {
  readonly actor?: string;
  readonly now?: number | Date | string;
  readonly home?: string;
  readonly grantIdleSeconds?: number;
  readonly graceSeconds?: number;
  readonly targetRunRoots?: readonly string[];
  readonly runtimeFreshnessOverride?: {
    readonly drifted: boolean;
    readonly referenceRuntimeVersion: string;
  };
  readonly clock?: Clock;
}

export interface Rung0Result {
  readonly charterDrifted: boolean;
  readonly runtimeDrifted: boolean;
  readonly integrityRepaired: boolean;
  readonly integrityFailed: boolean;
  readonly readRaceRetried: boolean;
  readonly halted: boolean;
  readonly haltReason?: string;
}

export interface Rung1Result {
  readonly liveRunsChecked: number;
  readonly supervisionTicksRun: number;
  readonly skippedDueToActiveCoordinator: readonly string[];
  readonly reclaimedLeasesCount: number;
  readonly escalatedTasksCount: number;
}

export interface Rung2Result {
  readonly abandonedAttempts: readonly {
    readonly runId: string;
    readonly taskId: string;
    readonly agentId?: string;
  }[];
  readonly orphanEvidenceEscalated: readonly {
    readonly runId: string;
    readonly evidenceCount: number;
  }[];
  readonly worktreesReclaimed: readonly {
    readonly runId: string;
    readonly worktreeIds: readonly string[];
  }[];
}

export interface Rung3Result {
  readonly deadAgentsReleased: readonly {
    readonly runId: string;
    readonly agentId: string;
    readonly role: string;
    readonly idleSeconds: number;
  }[];
}

export interface Rung4Result {
  readonly deadPulseReclaimed: boolean;
  readonly reclaimedPulseId?: string;
  readonly consecutiveCrashes: number;
  readonly halted: boolean;
  readonly haltReason?: string;
}

export interface Rung5Result {
  readonly gapExceeded: boolean;
  readonly gapMs?: number;
  readonly armedIntervalMs?: number;
  readonly driverLatenessMs?: number;
  readonly notified: boolean;
}

export interface RescueLaneResult {
  readonly outcome: "rescued" | "halted" | "quiescent";
  readonly rungs: {
    readonly rung0: Rung0Result;
    readonly rung1: Rung1Result;
    readonly rung2: Rung2Result;
    readonly rung3: Rung3Result;
    readonly rung4: Rung4Result;
    readonly rung5: Rung5Result;
  };
  readonly halted: boolean;
  readonly haltReason?: string;
  readonly actionsTaken: readonly string[];
  readonly escalations: readonly string[];
  readonly summary: string;
}

function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function findLiveRunRoots(capsulesDir: string, mindRunRoot: string): string[] {
  const currentBasename = basename(mindRunRoot);
  if (!existsSync(capsulesDir) || !lstatSync(capsulesDir).isDirectory()) {
    return [];
  }
  const entries = readdirSync(capsulesDir, { withFileTypes: true });
  const liveRoots: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (
      entry.name === currentBasename ||
      entry.name.startsWith("mind-") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const runPath = join(capsulesDir, entry.name);
    try {
      const loaded = loadRun(runPath, false);
      const completion = loaded.state.completion_result as { status?: string } | undefined;
      if (completion?.status === "complete") continue;
      liveRoots.push(runPath);
    } catch {
      // ignore unreadable run
    }
  }

  return liveRoots;
}

/**
 * Executes the RESCUE lane across all 6 rungs defined in PLAN.md §9.2.
 *
 * Rung 0: charter/runtime drift -> HALT + escalate; INTEGRITY with READ_RACE -> retry once; other INTEGRITY -> doctor -> doctor:repair -> escalate.
 * Rung 1: live runs -> take supervision tick only if no live coordinator grant (single-writer rule).
 * Rung 2: open attempt with agent gone -> task:abandon; orphan evidence -> escalate; abandoned worktrees -> worktree:reclaim.
 * Rung 3: active grant with no event -> agent:release --reason presumed_dead.
 * Rung 4: pulse open past deadline -> close crashed; 3 consecutive crashes -> HALT.
 * Rung 5: GAP > 3x armed interval -> record and notify.
 */
export async function executeRescueLane(
  mindRunRoot: string,
  options: RescueLaneOptions = {},
): Promise<RescueLaneResult> {
  const nowMs = parseNowMs(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const clock: Clock = options.clock ?? { now: () => new Date(nowMs) };

  const loadedMind = loadRun(mindRunRoot, false);
  const repoRoot = dirname(dirname(loadedMind.runRoot));
  const capsulesDir = dirname(loadedMind.runRoot);

  const actor =
    options.actor ??
    (typeof loadedMind.state.mind === "object" &&
    loadedMind.state.mind !== null &&
    typeof (loadedMind.state.mind as Record<string, unknown>).actor === "string"
      ? ((loadedMind.state.mind as Record<string, unknown>).actor as string)
      : "mind-1");

  const grantIdleSeconds = options.grantIdleSeconds ?? 1800;
  const graceSeconds = options.graceSeconds ?? 30;

  const actionsTaken: string[] = [];
  const escalations: string[] = [];

  // =========================================================================
  // RUNG 0: Charter / Runtime / Integrity Drift
  // =========================================================================
  let charterDrifted = false;
  let runtimeDrifted = false;
  let integrityRepaired = false;
  let integrityFailed = false;
  let readRaceRetried = false;
  let rung0Halted = false;
  let rung0HaltReason: string | undefined;

  const mindState = (loadedMind.state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "docs/mind/CHARTER.md";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots)
    ? charterRecord.repo_roots.filter((r): r is string => typeof r === "string")
    : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);

  let charterStatus: "ok" | "DRIFTED" | "missing" = "missing";
  let charterSha: string | null = null;

  if (existsSync(charterFullPath) && lstatSync(charterFullPath).isFile()) {
    try {
      const fileBytes = readFileSync(charterFullPath);
      charterSha = createHash("sha256").update(fileBytes).digest("hex");
      const pinnedDigest =
        (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) ||
        loadedMind.manifest.prompt_sha256;
      if (charterSha === pinnedDigest) {
        charterStatus = "ok";
      } else {
        charterStatus = "DRIFTED";
      }
    } catch {
      charterStatus = "missing";
    }
  }

  if (charterStatus !== "ok") {
    charterDrifted = true;
    rung0Halted = true;
    rung0HaltReason =
      charterStatus === "DRIFTED" ? "charter drifted from pinned digest" : "charter file missing";
    actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
    escalations.push(rung0HaltReason);

    transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
      const workingMind = (working.mind ?? {}) as Record<string, unknown>;
      workingMind.halted = true;
      workingMind.halt_reason = rung0HaltReason;
      working.mind = workingMind as unknown as JsonObject;

      const workingEscalations = Array.isArray(working.escalations) ? [...working.escalations] : [];
      workingEscalations.push({
        id: `esc-charter-${nowMs}`,
        reason: charterStatus === "DRIFTED" ? "charter_drift" : "charter_missing",
        detail: rung0HaltReason ?? "",
        escalated_at: nowIso,
        resolved_at: null,
      } as unknown as JsonObject);
      working.escalations = workingEscalations as unknown as JsonObject[];
    });
  }

  // Runtime freshness check
  if (!rung0Halted) {
    let runtimeStatus: "ok" | "drifted" | "unknown" = "ok";
    if (options.runtimeFreshnessOverride !== undefined) {
      if (options.runtimeFreshnessOverride.drifted) {
        runtimeStatus = "drifted";
      }
    } else {
      try {
        const scriptsRoot = resolve(import.meta.dirname, "..", "..");
        const validated = await validateSkillSource(resolve(scriptsRoot, ".."));
        const freshness = await installedRuntimeFreshness(validated, options.home);
        if (freshness.drifted) {
          runtimeStatus = "drifted";
        }
      } catch {
        runtimeStatus = "unknown";
      }
    }

    if (runtimeStatus === "drifted") {
      runtimeDrifted = true;
      rung0Halted = true;
      rung0HaltReason = "runtime drifted";
      actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
      escalations.push(rung0HaltReason);

      transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.halted = true;
        workingMind.halt_reason = rung0HaltReason;
        working.mind = workingMind as unknown as JsonObject;

        const workingEscalations = Array.isArray(working.escalations)
          ? [...working.escalations]
          : [];
        workingEscalations.push({
          id: `esc-runtime-${nowMs}`,
          reason: "runtime_drift",
          detail: rung0HaltReason ?? "",
          escalated_at: nowIso,
          resolved_at: null,
        } as unknown as JsonObject);
        working.escalations = workingEscalations as unknown as JsonObject[];
      });
    }
  }

  // Integrity checks
  if (!rung0Halted) {
    let integrityIssues = verifyIntegrity(mindRunRoot);
    if (integrityIssues.length > 0) {
      const allReadRace = integrityIssues.every((issue) => issue.subcode === "READ_RACE");
      if (allReadRace) {
        readRaceRetried = true;
        // Retry once per PLAN.md §9.2 Rung 0
        integrityIssues = verifyIntegrity(mindRunRoot);
      }

      if (integrityIssues.length > 0) {
        // Run doctor and doctor:repair
        await runDoctor(mindRunRoot);
        try {
          recoverProjection(mindRunRoot, actor);
          integrityRepaired = true;
          actionsTaken.push("Rung 0: repaired mind capsule state projection via doctor:repair");
        } catch {
          integrityRepaired = false;
        }

        const remainingIssues = verifyIntegrity(mindRunRoot);
        if (remainingIssues.length > 0) {
          integrityFailed = true;
          rung0Halted = true;
          rung0HaltReason = `mind capsule integrity unrepairable: ${remainingIssues.map((i) => i.code).join(", ")}`;
          actionsTaken.push(`Rung 0: HALT triggered due to ${rung0HaltReason}`);
          escalations.push(rung0HaltReason);

          transact(mindRunRoot, actor, "mind-halted", { reason: rung0HaltReason }, (working) => {
            const workingMind = (working.mind ?? {}) as Record<string, unknown>;
            workingMind.halted = true;
            workingMind.halt_reason = rung0HaltReason;
            working.mind = workingMind as unknown as JsonObject;

            const workingEscalations = Array.isArray(working.escalations)
              ? [...working.escalations]
              : [];
            workingEscalations.push({
              id: `esc-integrity-${nowMs}`,
              reason: "integrity_failed",
              detail: rung0HaltReason ?? "",
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            working.escalations = workingEscalations as unknown as JsonObject[];
          });
        }
      }
    }
  }

  const rung0: Rung0Result = {
    charterDrifted,
    runtimeDrifted,
    integrityRepaired,
    integrityFailed,
    readRaceRetried,
    halted: rung0Halted,
    ...(rung0HaltReason !== undefined ? { haltReason: rung0HaltReason } : {}),
  };

  if (rung0Halted) {
    return {
      outcome: "halted",
      rungs: {
        rung0,
        rung1: {
          liveRunsChecked: 0,
          supervisionTicksRun: 0,
          skippedDueToActiveCoordinator: [],
          reclaimedLeasesCount: 0,
          escalatedTasksCount: 0,
        },
        rung2: {
          abandonedAttempts: [],
          orphanEvidenceEscalated: [],
          worktreesReclaimed: [],
        },
        rung3: {
          deadAgentsReleased: [],
        },
        rung4: {
          deadPulseReclaimed: false,
          consecutiveCrashes: 0,
          halted: false,
        },
        rung5: {
          gapExceeded: false,
          notified: false,
        },
      },
      halted: true,
      ...(rung0HaltReason !== undefined ? { haltReason: rung0HaltReason } : {}),
      actionsTaken,
      escalations,
      summary: `RESCUE halted at Rung 0: ${rung0HaltReason}`,
    };
  }

  // Determine target live runs
  const liveRunRoots =
    options.targetRunRoots !== undefined && options.targetRunRoots.length > 0
      ? [...options.targetRunRoots]
      : findLiveRunRoots(capsulesDir, mindRunRoot);

  // =========================================================================
  // RUNG 1: Supervision Tick with Single-Writer Rule
  // =========================================================================
  let supervisionTicksRun = 0;
  const skippedDueToActiveCoordinator: string[] = [];
  let reclaimedLeasesCount = 0;
  let escalatedTasksCount = 0;

  for (const runPath of liveRunRoots) {
    try {
      const loadedRun = loadRun(runPath, false);
      const ledger = readAgentLedger(loadedRun.state);
      const hasActiveCoordinator = ledger.some(
        (grant) =>
          grant.status === "active" &&
          (grant.role === "coordinator" || grant.role === "orchestrator"),
      );

      if (hasActiveCoordinator) {
        skippedDueToActiveCoordinator.push(runPath);
        actionsTaken.push(
          `Rung 1: skipped supervision tick for ${basename(runPath)} (active coordinator grant holds single writer lease)`,
        );
      } else {
        const tickResult = runSupervisionTick(workflowPort(runPath), actor, {
          recoveryEnabled: true,
          graceSeconds,
          clock,
        });
        supervisionTicksRun++;
        reclaimedLeasesCount += tickResult.reclaimed.length;
        escalatedTasksCount += tickResult.escalatedNow.length;

        if (tickResult.reclaimed.length > 0) {
          actionsTaken.push(
            `Rung 1: reclaimed ${tickResult.reclaimed.length} dead lease(s) in ${basename(runPath)}`,
          );
        }
        if (tickResult.escalatedNow.length > 0) {
          actionsTaken.push(
            `Rung 1: escalated ${tickResult.escalatedNow.length} deterministically dead task(s) in ${basename(runPath)}`,
          );
        }
      }
    } catch {
      // ignore individual run tick failure
    }
  }

  const rung1: Rung1Result = {
    liveRunsChecked: liveRunRoots.length,
    supervisionTicksRun,
    skippedDueToActiveCoordinator,
    reclaimedLeasesCount,
    escalatedTasksCount,
  };

  // =========================================================================
  // RUNG 2: Residue the Tick Cannot Fix
  // =========================================================================
  const abandonedAttempts: { runId: string; taskId: string; agentId?: string }[] = [];
  const orphanEvidenceEscalated: { runId: string; evidenceCount: number }[] = [];
  const worktreesReclaimed: { runId: string; worktreeIds: readonly string[] }[] = [];

  for (const runPath of liveRunRoots) {
    const runId = basename(runPath);
    try {
      const loadedRun = loadRun(runPath, false);
      const state = loadedRun.state as unknown as WorkflowState;
      const agents = readAgentLedger(state);

      // 1. Open attempts whose agent is gone
      const tasks = Object.values(state.tasks ?? {});
      for (const task of tasks) {
        const taskRecord = task as TaskRecord;
        const attempts = taskRecord.attempts ?? [];
        const lastAttempt = attempts.at(-1);
        if (lastAttempt && isAttemptOpen(lastAttempt)) {
          const rawAgentId = lastAttempt.agent_id ?? taskRecord.lease?.agent_id;
          const attemptAgentId = typeof rawAgentId === "string" ? rawAgentId : undefined;
          const agentGrant = agents.find((a) => a.id === attemptAgentId);
          const isAgentGone =
            !agentGrant ||
            agentGrant.status === "released" ||
            (taskRecord.lease === undefined && attemptAgentId !== undefined);

          if (isAgentGone) {
            abandonAttempt(
              workflowPort(runPath),
              taskRecord.id,
              actor,
              `agent ${attemptAgentId ?? "unknown"} gone or unresponsive`,
              clock,
            );
            abandonedAttempts.push({
              runId,
              taskId: taskRecord.id,
              ...(attemptAgentId !== undefined ? { agentId: attemptAgentId } : {}),
            });
            actionsTaken.push(
              `Rung 2: abandoned attempt on task ${taskRecord.id} in ${runId} (agent ${attemptAgentId ?? "unknown"} gone)`,
            );
          }
        }
      }

      // 2. Orphan evidence escalation
      const orphanEv = (state.orphan_evidence ?? []) as readonly Record<string, unknown>[];
      if (orphanEv.length > 0) {
        orphanEvidenceEscalated.push({
          runId,
          evidenceCount: orphanEv.length,
        });
        const reason = `orphan evidence (${orphanEv.length} items) in run ${runId} needs coordinator disposal`;
        escalations.push(reason);
        actionsTaken.push(`Rung 2: escalated orphan evidence in ${runId}`);

        transact(
          runPath,
          actor,
          "orphan-evidence-escalated",
          {
            run_id: runId,
            orphan_count: orphanEv.length,
            reason,
          },
          (draft) => {
            const workingState = draft as unknown as WorkflowState;
            const currentEscalations = Array.isArray(workingState.escalations)
              ? [...workingState.escalations]
              : [];
            currentEscalations.push({
              id: `esc-orphan-${nowMs}`,
              reason: "orphan_evidence_needs_disposal",
              detail: reason,
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            workingState.escalations = currentEscalations as unknown as JsonObject[];
          },
        );
      }

      // 3. Abandoned worktree reclaim
      const wtLedger = readWorktreeLedger(state);
      if (wtLedger) {
        const runRepoRoot = resolve(runPath, "..", "..");
        const harnessConfig = getHarnessConfig(runRepoRoot, runPath);
        if (harnessConfig.worktree_isolation) {
          const outcome = reclaimOrphanedWorktrees({
            repoRoot: runRepoRoot,
            ledger: wtLedger,
          });
          const completionResult = state.completion_result;
          const sealed =
            typeof completionResult === "object" &&
            completionResult !== null &&
            !Array.isArray(completionResult) &&
            completionResult.status === "complete";

          if (outcome.reclaimed_worktree_ids.length > 0) {
            if (!sealed) {
              recordReclaim(runPath, actor, outcome);
            }
            worktreesReclaimed.push({
              runId,
              worktreeIds: outcome.reclaimed_worktree_ids,
            });
            actionsTaken.push(
              `Rung 2: reclaimed ${outcome.reclaimed_worktree_ids.length} abandoned worktree(s) in ${runId}`,
            );
          }
        }
      }
    } catch {
      // ignore individual run residue errors
    }
  }

  const rung2: Rung2Result = {
    abandonedAttempts,
    orphanEvidenceEscalated,
    worktreesReclaimed,
  };

  // =========================================================================
  // RUNG 3: Dead Tier-1 / Tier-2 Agents
  // =========================================================================
  const deadAgentsReleased: {
    runId: string;
    agentId: string;
    role: string;
    idleSeconds: number;
  }[] = [];

  const runsToCheckForAgents = [...liveRunRoots, mindRunRoot];

  for (const runPath of runsToCheckForAgents) {
    const runId = basename(runPath);
    try {
      const loadedRun = loadRun(runPath, false);
      const ledger = readAgentLedger(loadedRun.state);
      const activeGrants = ledger.filter((g) => g.status === "active");

      for (const grant of activeGrants) {
        // Find events attributable to this agent
        const attributableEvents = loadedRun.events.filter(
          (e) =>
            e.actor === grant.id ||
            (typeof e.payload === "object" &&
              e.payload !== null &&
              ((e.payload as Record<string, unknown>).agent_id === grant.id ||
                (e.payload as Record<string, unknown>).validator_id === grant.id ||
                (e.payload as Record<string, unknown>).critic_id === grant.id)),
        );

        let latestActivityMs: number;
        if (attributableEvents.length > 0) {
          const timestamps = attributableEvents
            .map((e) => Date.parse(e.timestamp))
            .filter((t) => Number.isFinite(t));
          latestActivityMs =
            timestamps.length > 0 ? Math.max(...timestamps) : Date.parse(grant.granted_at);
        } else {
          latestActivityMs = Date.parse(grant.granted_at);
        }

        const idleSeconds = Math.max(0, Math.floor((nowMs - latestActivityMs) / 1000));
        if (idleSeconds > grantIdleSeconds) {
          releaseAgentGrant({
            runRoot: runPath,
            agentId: grant.id,
            actor,
            reason: "presumed_dead",
            now: new Date(nowMs),
          });
          deadAgentsReleased.push({
            runId,
            agentId: grant.id,
            role: grant.role,
            idleSeconds,
          });
          actionsTaken.push(
            `Rung 3: released dead ${grant.role} agent ${grant.id} in ${runId} (idle for ${idleSeconds}s > ${grantIdleSeconds}s)`,
          );
        }
      }
    } catch {
      // ignore
    }
  }

  const rung3: Rung3Result = {
    deadAgentsReleased,
  };

  // =========================================================================
  // RUNG 4: Dead Pulse Reclaim
  // =========================================================================
  let deadPulseReclaimed = false;
  let reclaimedPulseId: string | undefined;
  let consecutiveCrashes = 0;
  let rung4Halted = false;
  let rung4HaltReason: string | undefined;

  const currentMind = loadRun(mindRunRoot, false);
  const pulseRecord = (currentMind.state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseRecord.open as Record<string, unknown> | null | undefined;
  const lastPulse = (pulseRecord.last ?? {}) as Record<string, unknown>;

  consecutiveCrashes =
    lastPulse.outcome === "crashed" && typeof lastPulse.consecutive_crashes === "number"
      ? lastPulse.consecutive_crashes
      : 0;

  if (
    openPulse !== null &&
    openPulse !== undefined &&
    typeof openPulse === "object" &&
    typeof openPulse.pulse_id === "string" &&
    typeof openPulse.deadline_at === "string"
  ) {
    const deadlineMs = Date.parse(openPulse.deadline_at);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      deadPulseReclaimed = true;
      reclaimedPulseId = openPulse.pulse_id;
      const deadlinePassedByMs = Math.max(0, nowMs - deadlineMs);
      consecutiveCrashes += 1;

      actionsTaken.push(
        `Rung 4: reclaimed dead pulse ${openPulse.pulse_id} (deadline passed by ${Math.round(deadlinePassedByMs / 1000)}s; consecutive crashes: ${consecutiveCrashes})`,
      );

      if (consecutiveCrashes >= 3) {
        rung4Halted = true;
        rung4HaltReason = "consecutive pulse crashes threshold exceeded";
        actionsTaken.push(`Rung 4: HALT triggered due to ${rung4HaltReason}`);
        escalations.push(rung4HaltReason);
      }

      transact(
        mindRunRoot,
        actor,
        "mind-pulse-reclaimed",
        {
          pulse_id: openPulse.pulse_id,
          deadline_passed_by_ms: deadlinePassedByMs,
          consecutive_crash_count: consecutiveCrashes,
        },
        (working) => {
          const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
          const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;
          workingPulse.open = null;

          workingPulse.last = {
            ...workingLast,
            pulse_id: openPulse.pulse_id,
            closed_at: nowIso,
            outcome: "crashed",
            value: 0,
            armed_interval_ms: workingLast.armed_interval_ms ?? 900_000,
            armed_at: nowIso,
            arm_mechanism: "crash-recovery",
            zero_value_streak: ((workingLast.zero_value_streak as number) ?? 0) + 1,
            consecutive_crashes: consecutiveCrashes,
          };
          working.pulse = workingPulse as unknown as JsonObject;

          if (rung4Halted) {
            const workingMind = (working.mind ?? {}) as Record<string, unknown>;
            workingMind.halted = true;
            workingMind.halt_reason = rung4HaltReason;
            working.mind = workingMind as unknown as JsonObject;

            const workingEscalations = Array.isArray(working.escalations)
              ? [...working.escalations]
              : [];
            workingEscalations.push({
              id: `esc-crashes-${nowMs}`,
              reason: "consecutive_pulse_crashes",
              detail: rung4HaltReason ?? "",
              escalated_at: nowIso,
              resolved_at: null,
            } as unknown as JsonObject);
            working.escalations = workingEscalations as unknown as JsonObject[];
          }
        },
      );

      try {
        writeLastPulse(mindRunRoot, {
          at: nowIso,
          pulse_id: openPulse.pulse_id,
          outcome: "crashed",
          next_wake_at: null,
        });
      } catch {
        // best effort write outside chain
      }
    }
  }

  const rung4: Rung4Result = {
    deadPulseReclaimed: reclaimedPulseId !== undefined,
    ...(reclaimedPulseId !== undefined ? { reclaimedPulseId } : {}),
    consecutiveCrashes,
    halted: rung4Halted,
    ...(rung4HaltReason !== undefined ? { haltReason: rung4HaltReason } : {}),
  };

  if (rung4Halted) {
    return {
      outcome: "halted",
      rungs: {
        rung0,
        rung1,
        rung2,
        rung3,
        rung4,
        rung5: {
          gapExceeded: false,
          notified: false,
        },
      },
      halted: true,
      ...(rung4HaltReason !== undefined ? { haltReason: rung4HaltReason } : {}),
      actionsTaken,
      escalations,
      summary: `RESCUE halted at Rung 4: ${rung4HaltReason}`,
    };
  }

  // =========================================================================
  // RUNG 5: Dead Driver / GAP Detection
  // =========================================================================
  let gapExceeded = false;
  let gapMs: number | undefined;
  let armedIntervalMs: number | undefined;
  let driverLatenessMs: number | undefined;
  let gapNotified = false;

  if (lastPulse) {
    const closedAtMs = lastPulse.closed_at ? Date.parse(lastPulse.closed_at as string) : NaN;
    const startedAtMs = lastPulse.started_at ? Date.parse(lastPulse.started_at as string) : NaN;
    const referencePulseMs = Number.isFinite(closedAtMs)
      ? closedAtMs
      : Number.isFinite(startedAtMs)
        ? startedAtMs
        : NaN;

    if (Number.isFinite(referencePulseMs)) {
      gapMs = Math.max(0, nowMs - referencePulseMs);
      armedIntervalMs = (lastPulse.armed_interval_ms as number) ?? 900_000; // default 15m
      const allowedGapMs = armedIntervalMs * 2; // 2x interval per PLAN §1.5 / §11.1

      if (gapMs > allowedGapMs) {
        gapExceeded = true;
        driverLatenessMs = gapMs - armedIntervalMs;
        const msg = `GAP: Mind driver inactive for ${Math.round(gapMs / 1000)}s (armed interval: ${Math.round(armedIntervalMs / 1000)}s, factor: ${(gapMs / armedIntervalMs).toFixed(1)}x)`;
        actionsTaken.push(`Rung 5: ${msg}`);
        escalations.push(msg);
        gapNotified = true;

        transact(
          mindRunRoot,
          actor,
          "mind-driver-gap-observed",
          {
            gap_ms: gapMs,
            armed_interval_ms: armedIntervalMs,
            driver_lateness_ms: driverLatenessMs,
            factor: gapMs / armedIntervalMs,
          },
          (working) => {
            const observations = Array.isArray(working.observations)
              ? [...working.observations]
              : [];
            observations.push({
              id: `obs-gap-${nowMs}`,
              source: "driver-gap",
              count: 1,
              observed_at: nowIso,
              evidence_class: "harness_observed",
              detail: {
                gap_ms: gapMs,
                armed_interval_ms: armedIntervalMs,
                driver_lateness_ms: driverLatenessMs,
              },
            } as unknown as JsonObject);
            working.observations = observations as unknown as JsonObject[];
          },
        );
      }
    }
  }

  const rung5: Rung5Result = {
    gapExceeded,
    ...(gapMs !== undefined ? { gapMs } : {}),
    ...(armedIntervalMs !== undefined ? { armedIntervalMs } : {}),
    ...(driverLatenessMs !== undefined ? { driverLatenessMs } : {}),
    notified: gapNotified,
  };

  const hasAction = actionsTaken.length > 0;
  const outcome = hasAction ? "rescued" : "quiescent";

  const summary = hasAction
    ? `RESCUE executed successfully (${actionsTaken.length} action(s) taken)`
    : "RESCUE checked all 6 rungs; no recovery actions needed (quiescent)";

  return {
    outcome,
    rungs: {
      rung0,
      rung1,
      rung2,
      rung3,
      rung4,
      rung5,
    },
    halted: false,
    actionsTaken,
    escalations,
    summary,
  };
}
