/**
 * Auto-Wake Sentinel: calculates host timer wakeup schedules with clock skew protection,
 * safety buffers, and anti-thundering-herd jitter.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

import {
  AUTO_WAKE_PROMPT,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_MAX_JITTER_SECONDS,
  DEFAULT_SAFE_WINDOW_SECONDS,
  type QuotaEvaluationVerdict,
  type SentinelOptions,
  type SentinelWakeSchedule,
} from "./types.ts";

const MAX_STALE_SKEW_SECONDS = 300; // 5 minutes

function resolveNowMs(now?: number | Date | string): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string") {
    const parsed = new Date(now).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof now === "number" && Number.isFinite(now)) return now;
  return Date.now();
}

/**
 * Parses reset time into absolute epoch milliseconds.
 */
export function parseResetTimeMs(resetTime: string, nowMs: number): number | undefined {
  const trimmed = resetTime.trim();
  if (!trimmed) return undefined;

  // Numeric string (epoch seconds or ms, or relative delay)
  const num = Number(trimmed);
  if (Number.isFinite(num) && !Number.isNaN(num)) {
    if (num > 1e11) {
      // Milliseconds epoch
      return num;
    }
    if (num > 1e8) {
      // Seconds epoch
      return num * 1000;
    }
    // Small number treated as relative delta in seconds (e.g. retry-after: 3600)
    return nowMs + num * 1000;
  }

  // ISO or RFC date string
  const dateParsed = new Date(trimmed).getTime();
  if (!Number.isNaN(dateParsed)) {
    return dateParsed;
  }

  return undefined;
}

/**
 * Computes the one-shot auto-wake sentinel schedule.
 */
export function computeAutoWakeSentinel(
  verdict: QuotaEvaluationVerdict,
  options?: SentinelOptions,
): SentinelWakeSchedule {
  const nowMs = resolveNowMs(options?.now);
  const bufferSec = options?.bufferSeconds ?? DEFAULT_AUTO_WAKE_BUFFER_SECONDS;
  const safeWindowSec = options?.safeWindowSeconds ?? DEFAULT_SAFE_WINDOW_SECONDS;
  const maxJitterSec = options?.maxJitterSeconds ?? DEFAULT_MAX_JITTER_SECONDS;
  const activeAgentsCount = options?.activeAgentsCount ?? 0;

  const rawResetTime = verdict.resetTime ?? verdict.constrainedModel?.resetTime;
  let baseDurationSec: number;
  let fallbackUsed = false;

  if (rawResetTime) {
    const targetResetMs = parseResetTimeMs(rawResetTime, nowMs);

    if (targetResetMs !== undefined) {
      if (targetResetMs <= nowMs) {
        // Timestamp is in the past: evaluate clock skew vs severe staleness
        const pastDelaySec = Math.floor((nowMs - targetResetMs) / 1000);
        if (pastDelaySec <= MAX_STALE_SKEW_SECONDS) {
          // Near-term clock skew: schedule for bufferSec (60s) to allow host quota window to refresh
          baseDurationSec = bufferSec;
        } else {
          // Severely stale (>5m): broken/stale header, fall back to safe window
          baseDurationSec = safeWindowSec + bufferSec;
          fallbackUsed = true;
        }
      } else {
        // Valid future reset timestamp
        const diffSeconds = Math.ceil((targetResetMs + bufferSec * 1000 - nowMs) / 1000);
        baseDurationSec = Math.max(bufferSec, diffSeconds);
      }
    } else {
      // Unparseable reset time
      baseDurationSec = safeWindowSec + bufferSec;
      fallbackUsed = true;
    }
  } else {
    // Absent reset time
    baseDurationSec = safeWindowSec + bufferSec;
    fallbackUsed = true;
  }

  // Jitter calculation
  let jitterSeconds = 0;
  const shouldApplyJitter =
    (options?.enableJitter === true ||
      options?.jitter === true ||
      options?.jitterFactor !== undefined ||
      options?.jitterSeed !== undefined ||
      options?.jitterSeconds !== undefined) &&
    options?.disableJitter !== true;

  if (shouldApplyJitter) {
    if (options?.jitterSeconds !== undefined) {
      jitterSeconds = Math.max(0, Math.min(maxJitterSec, options.jitterSeconds));
    } else {
      const factor = options?.jitterFactor ?? 0.15;
      const randomVal =
        options?.jitterSeed !== undefined ? (Math.sin(options.jitterSeed) + 1) / 2 : Math.random();
      const rawJitter = Math.floor(randomVal * (baseDurationSec * factor + 5));
      const agentOffset =
        options?.agentIndex !== undefined
          ? (options.agentIndex % Math.max(1, activeAgentsCount)) * 5
          : 0;
      const combined = rawJitter + agentOffset;
      jitterSeconds = Math.max(0, Math.min(maxJitterSec, combined));
    }
  }

  const finalDurationSec = baseDurationSec + jitterSeconds;
  const targetWakeupIso = new Date(nowMs + finalDurationSec * 1000).toISOString();

  return {
    type: "one_shot_timer",
    durationSeconds: finalDurationSec,
    targetWakeupIso,
    prompt: AUTO_WAKE_PROMPT,
    timerCondition: "never",
    activeAgentsCount: activeAgentsCount > 0 ? activeAgentsCount : undefined,
    jitterSeconds: jitterSeconds > 0 ? jitterSeconds : undefined,
    fallbackUsed: fallbackUsed ? true : undefined,
  };
}
