import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  checkDailyBudget,
  rollDayKeyIfNeeded,
} from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/lifecycle/charter/index.ts";
import { transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { writeLastPulse } from "../../mind/lifecycle/pulse/index.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export function assertMindNotHalted(mindState: Record<string, unknown>): void {
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot pulse. Outcome: halted. Next: human inspection required.`,
    );
  }
}

export function resolveMindPulseGrant(
  state: Record<string, unknown> | JsonObject,
  actor: string,
  host: string,
  nowMs: number,
  actionDesc = "pulse operations",
): AgentGrantRecord {
  const ledger = readAgentLedger(state as unknown as JsonObject);
  const grant = findGrant(ledger, actor);
  if (!grant) {
    if (
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "planner" ||
      actor === "coordinator"
    ) {
      return {
        id: actor,
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host,
        granted_at: new Date(nowMs).toISOString(),
        status: "active",
      };
    }
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds no grant; register it with agent:register first`,
    );
  }
  if (
    grant.role !== "mind" &&
    grant.role !== "orchestrator" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for ${actionDesc}`,
    );
  }
  return grant;
}

export function verifyMindCharterSha(
  repoRoot: string,
  mindState: Record<string, unknown>,
  pinnedManifestSha?: string,
): void {
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "olt/agents/mind.yaml";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots)
    ? charterRecord.repo_roots.filter((r): r is string => typeof r === "string")
    : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);

  if (!existsSync(charterFullPath) || !lstatSync(charterFullPath).isFile()) {
    throw new HarnessError(
      "INVALID_STATE",
      `charter file at '${charterSourceRel}' is missing; pulse is halted. Outcome: halted. Next: restore charter file`,
    );
  }

  try {
    const charterBytes = readFileSync(charterFullPath);
    const charterSha = createHash("sha256").update(charterBytes).digest("hex");
    const pinnedSha =
      (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) ||
      pinnedManifestSha;
    if (charterSha !== pinnedSha) {
      throw new HarnessError(
        "INVALID_STATE",
        `charter sha256 mismatch (expected ${pinnedSha}, got ${charterSha}); charter has drifted. Outcome: halted. Next: inspect charter drift`,
      );
    }
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HarnessError(
      "INVALID_STATE",
      `cannot read charter at '${charterSourceRel}': ${msg}. Outcome: halted.`,
    );
  }
}

export function assertPulseNotOpen(
  openPulse: Record<string, unknown> | null | undefined,
  nowMs: number,
  run: string,
): void {
  if (openPulse !== null && openPulse !== undefined && typeof openPulse === "object") {
    const openPulseId = typeof openPulse.pulse_id === "string" ? openPulse.pulse_id : "unknown";
    const deadlineAt =
      typeof openPulse.deadline_at === "string" ? openPulse.deadline_at : "unknown";
    const deadlineMs = Date.parse(deadlineAt);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      throw new HarnessError(
        "INVALID_STATE",
        `pulse ${openPulseId} is open and past its deadline (${deadlineAt}); reclaim it first with mind:wake --run ${run}`,
      );
    }
    throw new HarnessError(
      "INVALID_STATE",
      `pulse ${openPulseId} is already open (deadline: ${deadlineAt}); query telemetry with mind:pulse or wait for deadline`,
    );
  }
}

export function executeOpenPulseTransaction(params: {
  readonly run: string;
  readonly actor: string;
  readonly host: string;
  readonly driver: string;
  readonly nowMs: number;
  readonly nextCounter: number;
  readonly pulseId: string;
  readonly scheduledIntervalMs: number;
  readonly pulseDeadlineMs: number;
  readonly state: Record<string, unknown>;
}): {
  readonly pulseId: string;
  readonly openedAt: string;
  readonly deadlineAt: string;
  readonly nextWakeAt: string;
  readonly updatedPulsesToday: number;
  readonly updatedWallClockToday: number;
} {
  const openedAt = new Date(params.nowMs).toISOString();
  const deadlineAt = new Date(params.nowMs + params.pulseDeadlineMs).toISOString();
  const nextWakeAt = new Date(params.nowMs + params.scheduledIntervalMs).toISOString();

  let updatedPulsesToday = 1;
  let updatedWallClockToday = 0;

  transact(
    params.run,
    params.actor,
    "mind-pulse-opened",
    {
      pulse_id: params.pulseId,
      opened_at: openedAt,
      deadline_at: deadlineAt,
      host: params.host,
      driver: params.driver,
      cadence: "infinite_autonomous",
      closing_permitted: false,
      invariant: CLOSING_FORBIDDEN_FOR_MIND,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, params.actor)) {
        const autoGrant: AgentGrantRecord = {
          id: params.actor,
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: params.host,
          granted_at: openedAt,
          status: "active",
        };
        writeAgentLedger(working, [...workingLedger, autoGrant]);
      }
      const workingBudget = (working.budget ?? {}) as Record<string, unknown>;
      rollDayKeyIfNeeded(workingBudget, params.nowMs);
      const currentToday =
        typeof workingBudget.pulses_today === "number" ? workingBudget.pulses_today : 0;
      updatedPulsesToday = currentToday + 1;
      workingBudget.pulses_today = updatedPulsesToday;
      updatedWallClockToday =
        typeof workingBudget.wall_clock_ms_today === "number"
          ? workingBudget.wall_clock_ms_today
          : 0;
      working.budget = workingBudget as unknown as JsonObject;

      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      workingPulse.counter = params.nextCounter;
      workingPulse.open = {
        pulse_id: params.pulseId,
        opened_at: openedAt,
        deadline_at: deadlineAt,
        actor: params.actor,
        host: params.host,
        driver: params.driver,
        cadence: "infinite_autonomous",
        closing_permitted: false,
        invariant: CLOSING_FORBIDDEN_FOR_MIND,
      };
      working.pulse = workingPulse as unknown as JsonObject;
    },
  );

  writeLastPulse(params.run, {
    at: openedAt,
    pulse_id: params.pulseId,
    outcome: "active",
    next_wake_at: nextWakeAt,
  });

  return {
    pulseId: params.pulseId,
    openedAt,
    deadlineAt,
    nextWakeAt,
    updatedPulsesToday,
    updatedWallClockToday,
  };
}
