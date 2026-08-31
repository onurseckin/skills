import { formatCircuitBreakerMarkdown } from "../../telemetry/circuit-breaker-markdown.ts";
import { captureDagSnapshot, persistDagSnapshot } from "../../telemetry/snapshot/index.ts";
import { formatPulseQuotaHeader, renderPulseTelemetryBadges } from "./badges.ts";
import { checkPulseQuotaFreeze, evaluateMindPulseQuota } from "./evaluator.ts";
import type { PulseSupervisoryCadenceOptions, SupervisoryCadenceResult } from "./types.ts";

export const PULSE_WRAP_UP_DIRECTIVES: readonly string[] = [
  "Wrap up current micro-step immediately. Do not claim or start new tasks.",
  "Preserve working tree changes unstaged/stashed safely without destructive actions.",
  "Non-Destructive Invariant: Do NOT kill active subagents (manage_subagents kill forbidden).",
  "State Action: All active subagents transition to IDLE state in memory.",
];

export async function managePulseSupervisoryCadence(
  options: PulseSupervisoryCadenceOptions,
): Promise<SupervisoryCadenceResult> {
  const quotaEval = await evaluateMindPulseQuota({
    runRoot: options.runRoot,
    actor: options.actor,
    host: options.host,
    thresholdPercentage: options.thresholdPercentage,
    forceProbe: options.forceProbe,
    cachedReport: options.cachedReport,
  });

  const shouldFreeze = checkPulseQuotaFreeze(quotaEval);
  const badges = renderPulseTelemetryBadges(quotaEval);

  let nextScheduledIntervalMs = options.baseIntervalMs;
  let nextWakeAt = new Date(Date.now() + nextScheduledIntervalMs).toISOString();
  let bannerMarkdown = "";
  let snapshotCaptured = false;
  let snapshotPath: string | undefined;
  const wrapUpDirectives: string[] = [];

  if (shouldFreeze) {
    wrapUpDirectives.push(...PULSE_WRAP_UP_DIRECTIVES);

    if (quotaEval.circuitBreakerEvaluation) {
      bannerMarkdown = formatCircuitBreakerMarkdown(quotaEval.circuitBreakerEvaluation, false);
    } else {
      bannerMarkdown = formatPulseQuotaHeader(quotaEval);
    }

    if (quotaEval.autoWakeSchedule) {
      nextScheduledIntervalMs = quotaEval.autoWakeSchedule.durationSeconds * 1000;
      nextWakeAt = quotaEval.autoWakeSchedule.targetWakeupIso;
    } else {
      nextScheduledIntervalMs = Math.max(options.baseIntervalMs, 60_000);
      nextWakeAt = new Date(Date.now() + nextScheduledIntervalMs).toISOString();
    }

    if (options.captureSnapshotOnFreeze !== false) {
      try {
        const repoRoot =
          typeof options.repoRoot === "string" && options.repoRoot.length > 0
            ? options.repoRoot
            : process.cwd();

        let resetTime = nextWakeAt;
        if (
          quotaEval.autoWakeSchedule &&
          typeof quotaEval.autoWakeSchedule.targetWakeupIso === "string"
        ) {
          resetTime = quotaEval.autoWakeSchedule.targetWakeupIso;
        }

        const snapshot = await captureDagSnapshot({
          runRoot: options.runRoot,
          repositoryRoot: repoRoot,
          lowestQuotaObserved: quotaEval.lowestRemainingQuota,
          constrainedModels: [...quotaEval.constrainedModels],
          resetTime,
        });
        snapshotPath = persistDagSnapshot(snapshot);
        snapshotCaptured = true;
      } catch {
        snapshotCaptured = false;
      }
    }
  } else {
    bannerMarkdown = formatPulseQuotaHeader(quotaEval);
    nextScheduledIntervalMs = options.baseIntervalMs;
    nextWakeAt = new Date(Date.now() + nextScheduledIntervalMs).toISOString();
  }

  return {
    shouldFreeze,
    nextScheduledIntervalMs,
    nextWakeAt,
    quotaEvaluation: quotaEval,
    badges,
    bannerMarkdown,
    wrapUpDirectives,
    snapshotCaptured,
    snapshotPath,
  };
}
