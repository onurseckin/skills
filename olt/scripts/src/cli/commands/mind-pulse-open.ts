import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import type { AgentGrantRecord, JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  checkDailyBudget,
  parseNowMs,
  rollDayKeyIfNeeded,
} from "../../mind/lifecycle/budget/index.ts";
import { DEFAULT_MIND_BUDGET, resolveCharterPath } from "../../mind/lifecycle/charter/index.ts";
import { loadRun, transact } from "../../engine/store/index.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { writeLastPulse } from "../../mind/lifecycle/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindPulseOpenResult {
  markdown: string;
  run_root: string;
  pulse_id: string;
  actor: string;
  host: string;
  driver: string;
  opened_at: string;
  deadline_at: string;
  budget: {
    pulses_today: number;
    pulses_per_day: number | null;
    wall_clock_ms_today: number;
    wall_clock_ms_per_day: number | null;
  };
}

export function formatMindPulseOpenBrief(params: {
  pulseId: string;
  runRoot: string;
  actor: string;
  host: string;
  driver: string;
  openedAt: string;
  deadlineAt: string;
  pulsesToday: number;
  pulsesPerDay: number | null;
}): string {
  const limitStr = params.pulsesPerDay === null ? "∞" : params.pulsesPerDay;
  const md = [
    `### Mind Pulse Opened: ${params.pulseId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Host**: \`${params.host}\``,
    `- **Driver**: \`${params.driver}\``,
    `- **Opened At**: \`${params.openedAt}\``,
    `- **Deadline At**: \`${params.deadlineAt}\``,
    `- **Budget Headroom**: ${params.pulsesToday} / ${limitStr} pulses today`,
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function mindPulseOpenCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const host = textFlag(flags, "host", true)!;
  const driver = textFlag(flags, "driver", true)!;
  const now = textFlag(flags, "now", false);

  const nowMs = parseNowMs(now);
  const loaded = loadRun(run, false);
  const state = loaded.state;

  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    const isAutoGrant =
      actor === "mind" || actor === "mind-1" || actor.startsWith("mind-") ||
      actor === "system" || actor === "harness" || actor === "test-actor" ||
      actor === "planner" || actor === "coordinator";
    if (isAutoGrant) {
      grant = {
        id: actor, role: "mind", parent_agent_id: null, parent_task_id: null,
        host, granted_at: new Date(nowMs).toISOString(), status: "active",
      };
    } else {
      throw new HarnessError("INVALID_STATE", `agent ${actor} holds no grant; register it with agent:register first`);
    }
  } else if (grant.role !== "mind" && grant.role !== "orchestrator" && grant.role !== "coordinator") {
    throw new HarnessError("INVALID_STATE", `agent ${actor} holds role '${grant.role}'; role 'mind' is required to open a pulse`);
  }

  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason = typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError("INVALID_STATE", `mind is halted (${haltReason}); cannot open pulse. Outcome: halted. Next: human inspection required.`);
  }

  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  if (openPulse !== null && openPulse !== undefined && typeof openPulse === "object") {
    const openPulseId = typeof openPulse.pulse_id === "string" ? openPulse.pulse_id : "unknown";
    const deadlineAt = typeof openPulse.deadline_at === "string" ? openPulse.deadline_at : "unknown";
    const deadlineMs = Date.parse(deadlineAt);
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      throw new HarnessError("INVALID_STATE", `pulse ${openPulseId} is open and past its deadline (${deadlineAt}); reclaim it first with mind:wake --run ${run}`);
    }
    throw new HarnessError("INVALID_STATE", `pulse ${openPulseId} is already open (deadline: ${deadlineAt}); query telemetry with mind:pulse or wait for deadline`);
  }

  const actualRunRoot = loaded?.runRoot ?? run;
  const repoRoot = findRepoRoot(actualRunRoot);
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const charterSourceRel = typeof charterRecord.source_path === "string" ? charterRecord.source_path : "olt/agents/mind.yaml";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots) ? charterRecord.repo_roots.filter((r): r is string => typeof r === "string") : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);

  if (!existsSync(charterFullPath) || !lstatSync(charterFullPath).isFile()) {
    throw new HarnessError("INVALID_STATE", `charter file at '${charterSourceRel}' is missing; pulse is halted. Outcome: halted. Next: restore charter file`);
  }

  try {
    const charterBytes = readFileSync(charterFullPath);
    const charterSha = createHash("sha256").update(charterBytes).digest("hex");
    const pinnedSha = (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) || loaded.manifest.prompt_sha256;
    if (charterSha !== pinnedSha) {
      throw new HarnessError("INVALID_STATE", `charter sha256 mismatch (expected ${pinnedSha}, got ${charterSha}); charter has drifted. Outcome: halted. Next: inspect charter drift`);
    }
  } catch (err) {
    if (err instanceof HarnessError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HarnessError("INVALID_STATE", `cannot read charter at '${charterSourceRel}': ${msg}. Outcome: halted.`);
  }

  const eventSequence = state.event_sequence ?? 0;
  if (eventSequence >= 100_000) {
    throw new HarnessError("INVALID_STATE", `event headroom threshold reached (${eventSequence} >= 100000 events); pulse is halted. Outcome: halted.`);
  }

  const budgetRecord = (state.budget ?? {}) as Record<string, unknown>;
  const budgetCheck = checkDailyBudget(budgetRecord, nowMs);
  if (!budgetCheck.ok) {
    throw new HarnessError("INVALID_STATE", `${budgetCheck.reason}. Outcome: ${budgetCheck.outcome}. Next: ${budgetCheck.repairArgv}`);
  }

  const currentCounter = typeof pulseState.counter === "number" ? pulseState.counter : 0;
  const nextCounter = currentCounter + 1;
  const pulseId = `pulse-${nextCounter}`;
  const openedAt = new Date(nowMs).toISOString();
  const pulseDeadlineMs = typeof budgetRecord.pulse_deadline_ms === "number" ? budgetRecord.pulse_deadline_ms : DEFAULT_MIND_BUDGET.pulse_deadline_ms;
  const deadlineAt = new Date(nowMs + pulseDeadlineMs).toISOString();

  let updatedPulsesToday = 1;
  let updatedWallClockToday = 0;
  const pulsesPerDay = typeof budgetRecord.pulses_per_day === "number" ? budgetRecord.pulses_per_day : DEFAULT_MIND_BUDGET.pulses_per_day;
  const wallClockPerDay = typeof budgetRecord.wall_clock_ms_per_day === "number" ? budgetRecord.wall_clock_ms_per_day : DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;

  transact(run, actor, "mind-pulse-opened", { pulse_id: pulseId, opened_at: openedAt, deadline_at: deadlineAt, host, driver }, (working) => {
    const workingLedger = readAgentLedger(working);
    if (!findGrant(workingLedger, actor)) {
      writeAgentLedger(working, [...workingLedger, {
        id: actor, role: "mind", parent_agent_id: null, parent_task_id: null,
        host, granted_at: openedAt, status: "active",
      }]);
    }
    const workingBudget = (working.budget ?? {}) as Record<string, unknown>;
    rollDayKeyIfNeeded(workingBudget, nowMs);
    const currentToday = typeof workingBudget.pulses_today === "number" ? workingBudget.pulses_today : 0;
    updatedPulsesToday = currentToday + 1;
    workingBudget.pulses_today = updatedPulsesToday;
    updatedWallClockToday = typeof workingBudget.wall_clock_ms_today === "number" ? workingBudget.wall_clock_ms_today : 0;
    working.budget = workingBudget as unknown as JsonObject;

    const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
    workingPulse.counter = nextCounter;
    workingPulse.open = { pulse_id: pulseId, opened_at: openedAt, deadline_at: deadlineAt, actor, host, driver };
    working.pulse = workingPulse as unknown as JsonObject;
  });

  writeLastPulse(run, { at: openedAt, pulse_id: pulseId, outcome: "active", next_wake_at: deadlineAt });

  const markdown = formatMindPulseOpenBrief({
    pulseId, runRoot: run, actor, host, driver, openedAt, deadlineAt,
    pulsesToday: updatedPulsesToday, pulsesPerDay,
  });

  return {
    markdown, run_root: run, pulse_id: pulseId, actor, host, driver,
    opened_at: openedAt, deadline_at: deadlineAt,
    budget: {
      pulses_today: updatedPulsesToday, pulses_per_day: pulsesPerDay,
      wall_clock_ms_today: updatedWallClockToday, wall_clock_ms_per_day: wallClockPerDay,
    },
  };
}
