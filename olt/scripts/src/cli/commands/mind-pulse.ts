import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import { checkDailyBudget, parseNowMs } from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/lifecycle/charter/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger } from "../../workflow/agents/ledger.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { resolveHostProviderLoose } from "../../core/config/host-canon.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import { verifyMilestoneEvidence } from "../../mind/evidence/index.ts";
import {
  computeMindCognitiveTelemetry,
  type MindCognitiveTelemetry,
  type MindPulseActiveAgentCoordinate,
  type MindPulseWaveLaneInfo,
  type MindPulseWorkSpanMetrics,
} from "./mind-pulse-metrics.ts";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  type MindPulseResult,
  type MindPulseTelemetryBudget,
} from "./mind-pulse-state.ts";
import {
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
} from "./mind-pulse-formatter.ts";
import { handleOpenPulseTelemetry } from "./mind-pulse-telemetry.ts";
import { executeOpenPulseTransaction } from "./mind-pulse-opener.ts";

export {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
};
export type {
  MindCognitiveTelemetry,
  MindPulseActiveAgentCoordinate,
  MindPulseResult,
  MindPulseTelemetryBudget,
  MindPulseWaveLaneInfo,
  MindPulseWorkSpanMetrics,
};

export async function mindPulseCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MindPulseResult> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", false) ?? "mind-1";
  const host = resolveHostProviderLoose(textFlag(flags, "host", false));
  const driver = textFlag(flags, "driver", false) ?? "perpetual-loop";
  const arm = textFlag(flags, "arm", false);
  const now = textFlag(flags, "now", false);

  const nowMs = parseNowMs(now);
  const loaded = loadRun(run, false);
  const state = loaded.state;

  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot pulse. Outcome: halted. Next: human inspection required.`,
    );
  }

  const actualRunRoot = loaded?.runRoot ?? run;
  const evidenceVerification = verifyMilestoneEvidence(actualRunRoot, "pulse");
  if (!evidenceVerification.hashChain.valid) {
    throw new HarnessError(
      "INVALID_STATE",
      `milestone evidence verification failed: ${evidenceVerification.hashChain.error}. Outcome: halted. Next: repair capsule events with doctor:repair`,
    );
  }

  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    const isAutoGrant =
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "planner" ||
      actor === "coordinator";
    if (isAutoGrant) {
      grant = {
        id: actor,
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host,
        granted_at: new Date(nowMs).toISOString(),
        status: "active",
      };
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `agent ${actor} holds no grant; register it with agent:register first`,
      );
    }
  } else if (
    grant.role !== "mind" &&
    grant.role !== "orchestrator" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for pulse operations`,
    );
  }

  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  const budgetRecord = (state.budget ?? mindState.budget ?? {}) as Record<string, unknown>;
  const baseIntervalMs =
    typeof budgetRecord.base_interval_ms === "number" ? budgetRecord.base_interval_ms : 900_000;
  const pulsesPerDay =
    typeof budgetRecord.pulses_per_day === "number"
      ? budgetRecord.pulses_per_day
      : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockPerDay =
    typeof budgetRecord.wall_clock_ms_per_day === "number"
      ? budgetRecord.wall_clock_ms_per_day
      : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

  if (openPulse !== null && openPulse !== undefined && typeof openPulse === "object") {
    return handleOpenPulseTelemetry({
      run,
      actor,
      host,
      driver,
      arm,
      nowMs,
      state,
      openPulse,
      pulseState,
      budgetRecord,
      baseIntervalMs,
      pulsesPerDay,
      wallClockPerDay,
      loadedRunRoot: loaded?.runRoot,
    });
  }

  const repoRoot = findRepoRoot(actualRunRoot);
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
      loaded.manifest.prompt_sha256;
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

  const eventSequence = state.event_sequence ?? 0;
  if (eventSequence >= 100_000) {
    throw new HarnessError(
      "INVALID_STATE",
      `event headroom threshold reached (${eventSequence} >= 100000 events); pulse is halted. Outcome: halted.`,
    );
  }

  const budgetCheck = checkDailyBudget(budgetRecord, nowMs);
  if (!budgetCheck.ok) {
    throw new HarnessError(
      "INVALID_STATE",
      `${budgetCheck.reason}. Outcome: ${budgetCheck.outcome}. Next: ${budgetCheck.repairArgv}`,
    );
  }

  const currentCounter = typeof pulseState.counter === "number" ? pulseState.counter : 0;

  return executeOpenPulseTransaction({
    run,
    actor,
    host,
    driver,
    arm,
    nowMs,
    state,
    budgetRecord,
    baseIntervalMs,
    pulsesPerDay,
    wallClockPerDay,
    currentCounter,
    repoRoot,
    evidenceVerification,
  });
}
