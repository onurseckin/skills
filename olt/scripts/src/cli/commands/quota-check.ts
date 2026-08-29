import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import {
  QuotaCircuitBreaker,
  formatCircuitBreakerMarkdown,
} from "../../telemetry/circuit-breaker.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export async function quotaCheckCommand(
  flags: Flags,
  _context?: CommandContext,
  _remainder?: readonly string[],
  env?: CollectorEnvironment,
): Promise<Record<string, unknown>> {
  const platformFilter = textFlag(flags, "platform", false);
  const rawThreshold = textFlag(flags, "threshold", false);
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : 10.0;
  const activeAgentsCount = integerFlag(flags, "active-agents", { required: false }) ?? 0;
  const jsonOutput = boolFlag(flags, "json");
  const detailed = boolFlag(flags, "detailed");

  let collectors = createDefaultCollectors(env);
  if (platformFilter) {
    collectors = collectors.filter(
      (c) => c.platformId.toLowerCase() === platformFilter.toLowerCase(),
    );
  }

  const engine = new TelemetryNormalizationEngine(collectors);
  const report = await engine.probeAll();

  const breaker = new QuotaCircuitBreaker();
  const evaluation = breaker.evaluate(report, {
    thresholdPercentage: isNaN(threshold) ? 10.0 : threshold,
    activeAgentsCount,
  });

  const markdown = formatCircuitBreakerMarkdown(evaluation, detailed);

  let finalMarkdown = markdown;
  if (evaluation.isTriggered) {
    finalMarkdown +=
      "\n\n**Recommendation:** Quota circuit breaker is triggered. You should initiate a DAG freeze:\n`bun harness.ts quota:freeze`\nThis will suspend agent operations and schedule an auto-wake resume.";
  }

  return {
    markdown: finalMarkdown,
    status: evaluation.status,
    isTriggered: evaluation.isTriggered,
    thresholdPercentage: evaluation.thresholdPercentage,
    lowestRemainingQuota: evaluation.lowestRemainingQuota,
    constrainedModels: evaluation.constrainedModels,
    wrapUpDirectives: evaluation.wrapUpDirectives,
    autoWakeSchedule: evaluation.autoWakeSchedule,
    summary: evaluation.summary,
    report,
    json: jsonOutput,
  };
}
