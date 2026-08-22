import { existsSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { formatDuration } from "../../mind/brief.ts";
import { writeLastPulse } from "../../mind/last-pulse.ts";
import { enforceInfiniteMindCadence } from "../../mind/recycler.ts";
import {
  calculateNextWakeInterval,
  calculatePulseValue,
  isPulseOutcome,
  isTerminalOutcome,
  parseDuration,
  PULSE_OUTCOMES,
  type PulseOutcome,
} from "../../mind/value.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindPulseCloseResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly pulse_id: string;
  readonly outcome: PulseOutcome;
  readonly value: number;
  readonly armed_interval_ms: number | null;
  readonly arm_mechanism: string | null;
  readonly next_wake_at: string | null;
  readonly zero_value_streak: number;
  readonly next_instruction: string;
  readonly cadence: "infinite_autonomous";
  readonly non_terminating: true;
  readonly [key: string]: unknown;
}

export interface MindPulseCloseBriefParams {
  readonly pulseId: string;
  readonly outcome: string;
  readonly value: number;
  readonly nextWakeAt: string | null;
  readonly armedIntervalMs: number | null;
  readonly armMechanism: string | null;
  readonly runRoot?: string | undefined;
  readonly nextInstruction?: string | undefined;
  readonly nextCandidateId?: string | undefined;
}

export function formatMindPulseCloseBrief(params: MindPulseCloseBriefParams): string {
  const nextCommand =
    params.nextInstruction ??
    (params.nextCandidateId && params.runRoot
      ? `bun harness.ts mind:admit --run ${params.runRoot} --candidate ${params.nextCandidateId}`
      : params.runRoot
        ? `bun harness.ts mind:wake --run ${params.runRoot}`
        : `bun harness.ts mind:wake`);

  const lines = [
    `### Mind Pulse Closed: ${params.pulseId}`,
    `- **Outcome**: ${params.outcome}`,
    `- **Value**: ${params.value}`,
    params.nextWakeAt
      ? `- **Next Wake**: \`${params.nextWakeAt}\`${
          params.armedIntervalMs !== null && params.armedIntervalMs > 0
            ? ` (in ${formatDuration(params.armedIntervalMs)})`
            : ""
        }`
      : `- **Next Wake**: none (terminal)`,
    params.armMechanism ? `- **Arm Mechanism**: ${params.armMechanism}` : undefined,
    `- **Cadence**: infinite autonomous loop active (prohibits agent-driven termination or process exit)`,
    `- **Next Instruction**: \`${nextCommand}\``,
  ].filter((l): l is string => l !== undefined);

  return enforceLineLimit(lines.join("\n"), 20);
}

export async function mindPulseCloseCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MindPulseCloseResult> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const pulseFlag = textFlag(flags, "pulse", false) ?? textFlag(flags, "pulse-id", false);
  if (!pulseFlag) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--pulse is required: specify the pulse id to close",
    );
  }
  const pulseId = pulseFlag;

  const outcomeRaw = textFlag(flags, "outcome")!;
  if (!isPulseOutcome(outcomeRaw)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid outcome '${outcomeRaw}'; must be one of: ${PULSE_OUTCOMES.join(", ")}`,
    );
  }
  const outcome: PulseOutcome = outcomeRaw;

  const arm = textFlag(flags, "arm", false);
  const armMechanism = textFlag(flags, "arm-mechanism", false);
  const terminalReason =
    textFlag(flags, "terminal-reason", false) ?? textFlag(flags, "reason", false);
  const witness = textFlag(flags, "witness", false);
  const signal = textFlag(flags, "signal", false);
  const now = textFlag(flags, "now", false);

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }

  const loaded = loadRun(run, false);
  const state = loaded.state;
  const pulse = (state.pulse ?? {}) as Record<string, unknown>;
  const open = pulse.open as Record<string, unknown> | null | undefined;

  // 1. Refuse if no pulse is open
  if (
    open === null ||
    open === undefined ||
    typeof open !== "object" ||
    typeof open.pulse_id !== "string"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      "no active pulse is currently open; open a pulse with 'bun harness.ts mind:pulse-open --run <run> ...' before closing",
    );
  }

  // 2. Refuse if actor does not match open pulse actor
  if (typeof open.actor === "string" && actor !== open.actor) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `actor '${actor}' does not match open pulse actor '${open.actor}'`,
    );
  }

  // 3. Refuse if pulse id does not match open pulse id
  if (pulseId !== open.pulse_id) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `pulse id '${pulseId}' does not match open pulse id '${open.pulse_id}'`,
    );
  }

  // 4. Arming rail enforcement: must have arm or terminal reason unless terminal outcome
  const isTerminal = isTerminalOutcome(outcome);
  if (!isTerminal && !arm && !terminalReason) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "a pulse may not close without either an armed successor (--arm <duration>) or a recorded terminal reason (--terminal-reason <reason>). To close without arming a successor, record --outcome unarmed or provide --terminal-reason.",
    );
  }

  // 5. Value calculation per PLAN.md §11.2
  let witnessValid = false;
  if (witness) {
    const cmdPath = join(run, "commands", `${witness}.json`);
    const cmdRawPath = join(run, "commands", witness);
    witnessValid = existsSync(cmdPath) || existsSync(cmdRawPath);
  }

  const pulseValue = calculatePulseValue({});

  // 6. Interval & arm calculation
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const baseIntervalMs =
    typeof budget.base_interval_ms === "number" ? budget.base_interval_ms : 900_000;
  const maxIntervalMs =
    typeof budget.max_interval_ms === "number" ? budget.max_interval_ms : 14_400_000;
  const maxPauseIntervalMs =
    typeof budget.max_pause_interval_ms === "number" ? budget.max_pause_interval_ms : 1_800_000;

  const last = (pulse.last ?? {}) as Record<string, unknown>;
  const previousStreak = typeof last.zero_value_streak === "number" ? last.zero_value_streak : 0;
  const previousIntervalMs =
    typeof last.armed_interval_ms === "number" ? last.armed_interval_ms : undefined;

  let armedIntervalMs: number | null = null;
  let nextWakeAt: string | null = null;
  let effectiveArmMech: string | null = armMechanism ?? null;

  if (isTerminal || (terminalReason && !arm)) {
    armedIntervalMs = null;
    nextWakeAt = null;
    effectiveArmMech = null;
  } else if (arm) {
    armedIntervalMs = parseDuration(arm);
    nextWakeAt = new Date(nowMs + armedIntervalMs).toISOString();
    if (!effectiveArmMech) effectiveArmMech = "command-flag";
  } else {
    const intervalResult = calculateNextWakeInterval({
      baseIntervalMs,
      maxIntervalMs,
      maxPauseIntervalMs,
      previousIntervalMs,
      zeroValueStreak: previousStreak,
      value: pulseValue,
      outcome,
      signal,
    });
    armedIntervalMs = intervalResult.intervalMs;
    nextWakeAt = armedIntervalMs !== null ? new Date(nowMs + armedIntervalMs).toISOString() : null;
    if (!effectiveArmMech && armedIntervalMs !== null) effectiveArmMech = "autonomous-rail";
  }

  const zeroValueStreak = pulseValue > 0 ? 0 : previousStreak + 1;

  // 7. Transact event and state mutation
  transact(
    run,
    actor,
    "mind-pulse-closed",
    {
      pulse_id: pulseId,
      outcome,
      value: pulseValue,
      armed_interval_ms: armedIntervalMs,
      arm_mechanism: effectiveArmMech,
      next_wake_at: nextWakeAt,
      signal: signal ?? null,
      reason: terminalReason ?? null,
      witness: witnessValid && typeof witness === "string" ? witness : null,
    },
    (working) => {
      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;

      workingPulse.open = null;
      delete (workingPulse as Record<string, unknown>).open;

      workingPulse.last = {
        ...workingLast,
        pulse_id: pulseId,
        opened_at:
          typeof open.opened_at === "string" ? open.opened_at : new Date(nowMs).toISOString(),
        closed_at: new Date(nowMs).toISOString(),
        outcome,
        value: pulseValue,
        armed_interval_ms: armedIntervalMs,
        armed_at: new Date(nowMs).toISOString(),
        arm_mechanism: effectiveArmMech,
        next_wake_at: nextWakeAt,
        zero_value_streak: zeroValueStreak,
        consecutive_crashes: 0,
        signal: signal ?? null,
        terminal_reason: terminalReason ?? null,
      };
      working.pulse = workingPulse as unknown as JsonObject;

      if (outcome === "halted") {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.halted = true;
        workingMind.halt_reason = terminalReason ?? "pulse halted";
        working.mind = workingMind as unknown as JsonObject;
      }
    },
  );

  // 8. Write last_pulse.json atomically outside the chain
  writeLastPulse(run, {
    at: new Date(nowMs).toISOString(),
    pulse_id: pulseId,
    outcome,
    next_wake_at: nextWakeAt,
  });

  // Master Heartbeat & Continuous Autonomous Cadence Guarantee:
  // Disallow any terminal state from breaking the infinite autonomous execution loop.
  enforceInfiniteMindCadence({
    runRoot: run,
    actor,
    isTerminal,
    nextWakeAt,
  });

  // Check for candidate discovery / admission progression
  let nextCandidateId: string | undefined;
  const candidatesList: Record<string, unknown>[] = [];
  if (Array.isArray(state.candidates)) {
    candidatesList.push(...(state.candidates as Record<string, unknown>[]));
  }
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (Array.isArray(mindState.candidates)) {
    for (const c of mindState.candidates as Record<string, unknown>[]) {
      if (!candidatesList.some((existing) => existing.id === c.id)) {
        candidatesList.push(c);
      }
    }
  }
  const openOrAdmittedCandidate = candidatesList.find(
    (c) => c.status === "admitted" || c.status === "opened" || c.status === "open",
  );
  if (openOrAdmittedCandidate && typeof openOrAdmittedCandidate.id === "string") {
    nextCandidateId = openOrAdmittedCandidate.id;
  }

  const nextInstruction = nextCandidateId
    ? `bun harness.ts mind:admit --run ${run} --candidate ${nextCandidateId}`
    : `bun harness.ts mind:wake --run ${run}`;

  const markdown = formatMindPulseCloseBrief({
    pulseId,
    outcome,
    value: pulseValue,
    nextWakeAt,
    armedIntervalMs,
    armMechanism: effectiveArmMech,
    runRoot: run,
    nextInstruction,
    nextCandidateId,
  });

  return {
    markdown,
    run_root: run,
    pulse_id: pulseId,
    outcome,
    value: pulseValue,
    armed_interval_ms: armedIntervalMs,
    arm_mechanism: effectiveArmMech,
    next_wake_at: nextWakeAt,
    zero_value_streak: zeroValueStreak,
    next_instruction: nextInstruction,
    cadence: "infinite_autonomous",
    non_terminating: true,
  };
}
