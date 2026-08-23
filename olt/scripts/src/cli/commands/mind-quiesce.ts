import { basename, dirname } from "node:path";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { formatDuration } from "../../mind/brief.ts";
import {
  buildQuiescentDigest,
  calculateQuiescentInterval,
  computeQuiescentStreak,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  shouldTriggerQuiescentDigest,
  validateQuiescentScan,
  type QuiescentDigest,
  type QuiescentSourceObservation,
} from "../../mind/quiesce.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { findGrant, readAgentLedger } from "../../workflow/agents/ledger.ts";
import { findRepoRoot } from "../../shared/paths.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindQuiesceResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly actor: string;
  readonly quiescent_streak: number;
  readonly previous_streak: number;
  readonly base_interval_ms: number;
  readonly max_interval_ms: number;
  readonly armed_interval_ms: number;
  readonly digest_triggered: boolean;
  readonly digest?: QuiescentDigest | undefined;
  readonly sources: readonly QuiescentSourceObservation[];
  readonly observed_at: string;
  readonly [key: string]: unknown;
}

export function formatMindQuiesceBrief(params: {
  readonly runRoot: string;
  readonly actor: string;
  readonly quiescentStreak: number;
  readonly previousStreak: number;
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly armedIntervalMs: number;
  readonly digestTriggered: boolean;
  readonly observedAt: string;
}): string {
  const lines = [
    `### Mind Quiesced (Streak ${params.quiescentStreak})`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Quiescent Streak**: ${params.quiescentStreak} (previous: ${params.previousStreak})`,
    `- **Next Armed Interval**: \`${formatDuration(params.armedIntervalMs)}\` (base: ${formatDuration(params.baseIntervalMs)}, max: ${formatDuration(params.maxIntervalMs)})`,
    `- **Digest Triggered**: ${params.digestTriggered ? "yes (8th consecutive quiescent pulse)" : "no"}`,
    `- **Sources Verified Clean**: 10 of 10 (all count == 0 with recorded command evidence)`,
    `- **Observed At**: \`${params.observedAt}\``,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export async function mindQuiesceCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<MindQuiesceResult> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const sourceInputs = listFlag(flags, "source", true)!;
  const now = textFlag(flags, "now", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);

  if (!sourceInputs || sourceInputs.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--source is required: provide scan results as <source>:<command-id>:<count> for all 10 discovery sources",
    );
  }

  const nowMs = now ? Date.parse(now) : Date.now();
  if (now && !Number.isFinite(nowMs)) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid --now timestamp: ${now}`);
  }
  const nowIso = new Date(nowMs).toISOString();

  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  const grant = findGrant(ledger, actor);
  if (!grant) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds no grant; register it with agent:register first`,
    );
  }
  if (grant.role !== "mind") {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for mind:quiesce`,
    );
  }

  // 2. Refuse if fewer than 10 sources are provided
  if (sourceInputs.length < 10) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `quiescence requires all 10 discovery sources to be scanned; received ${sourceInputs.length} source(s)`,
    );
  }

  // 3. Validate all 10 sources observed with count == 0 and valid recorded command evidence
  const repoRoot = findRepoRoot(loaded.runRoot);
  const validation = validateQuiescentScan(sourceInputs, {
    runRoot: loaded.runRoot,
    repoRoot,
    capsulesDir,
  });

  if (!validation.ok) {
    throw new HarnessError("INVALID_ARGUMENT", validation.error ?? "quiescence validation failed");
  }

  // 4. Compute quiescent streak count
  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const previousStreak =
    typeof pulseState.quiescent_streak === "number" ? pulseState.quiescent_streak : 0;
  const newStreak = computeQuiescentStreak(previousStreak);

  // 5. Apply 1.5x interval multiplier capped at max_interval
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const baseIntervalMs =
    typeof budget.base_interval_ms === "number"
      ? budget.base_interval_ms
      : DEFAULT_BASE_INTERVAL_MS;
  const maxIntervalMs =
    typeof budget.max_interval_ms === "number" ? budget.max_interval_ms : DEFAULT_MAX_INTERVAL_MS;
  const armedIntervalMs = calculateQuiescentInterval(baseIntervalMs, maxIntervalMs, newStreak);

  // 6. Trigger digest at 8th consecutive quiescent pulse per PLAN.md §7.5 / PHASE-3.md §3.5
  const triggerDigest = shouldTriggerQuiescentDigest(newStreak);
  let digest: QuiescentDigest | undefined = undefined;
  if (triggerDigest) {
    digest = buildQuiescentDigest({
      streak: newStreak,
      sources: validation.observations,
      runId: basename(loaded.runRoot),
      generatedAt: nowIso,
    });
  }

  // 7. Transact mind-quiesced and update state.pulse.quiescent_streak
  transact(
    run,
    actor,
    "mind-quiesced",
    {
      quiescent_streak: newStreak,
      previous_streak: previousStreak,
      sources: validation.observations.map((obs) => ({
        source: obs.source,
        command_id: obs.commandId,
        count: obs.count,
        evidence_class: obs.evidenceClass,
      })),
      base_interval_ms: baseIntervalMs,
      max_interval_ms: maxIntervalMs,
      armed_interval_ms: armedIntervalMs,
      digest_triggered: triggerDigest,
      digest_markdown: digest ? digest.markdown : null,
      observed_at: nowIso,
    },
    (working) => {
      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      workingPulse.quiescent_streak = newStreak;
      working.pulse = workingPulse as unknown as JsonObject;
    },
  );

  const markdown = formatMindQuiesceBrief({
    runRoot: run,
    actor,
    quiescentStreak: newStreak,
    previousStreak,
    baseIntervalMs,
    maxIntervalMs,
    armedIntervalMs,
    digestTriggered: triggerDigest,
    observedAt: nowIso,
  });

  return {
    markdown,
    run_root: run,
    actor,
    quiescent_streak: newStreak,
    previous_streak: previousStreak,
    base_interval_ms: baseIntervalMs,
    max_interval_ms: maxIntervalMs,
    armed_interval_ms: armedIntervalMs,
    digest_triggered: triggerDigest,
    digest,
    sources: validation.observations,
    observed_at: nowIso,
  };
}
