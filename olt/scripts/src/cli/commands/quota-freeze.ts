import {
  captureDagSnapshot,
  persistDagSnapshot,
  formatDagSnapshotMarkdown,
} from "../../telemetry/dag-snapshot.ts";
import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import { QuotaCircuitBreaker } from "../../telemetry/circuit-breaker.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { loadRun } from "../../engine/store/load.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export async function quotaFreezeCommand(
  flags: Flags,
  _context?: CommandContext,
  _remainder?: readonly string[],
  env?: CollectorEnvironment,
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const loaded = loadRun(run, false);
  const repo = findRepoRoot(loaded.runRoot);
  const requestedRepo = textFlag(flags, "repo", false);
  if (requestedRepo !== undefined && findRepoRoot(requestedRepo) !== repo) {
    throw new HarnessError(
      "PATH_SAFETY",
      "quota:freeze --repo must resolve to the verified run repository",
    );
  }
  const rawThreshold = textFlag(flags, "threshold", false);
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : 5.0;
  const activeAgentsCount = integerFlag(flags, "active-agents", { required: false }) ?? 0;
  const force = boolFlag(flags, "force");
  const jsonOutput = boolFlag(flags, "json");
  const detailed = boolFlag(flags, "detailed");

  const collectors = createDefaultCollectors(env);
  const engine = new TelemetryNormalizationEngine(collectors);
  const report = await engine.probeAll();

  const breaker = new QuotaCircuitBreaker();
  const evaluation = breaker.evaluate(report, {
    thresholdPercentage: isNaN(threshold) ? 5.0 : threshold,
    activeAgentsCount,
  });

  if (!evaluation.isTriggered && !force) {
    return {
      status: "healthy",
      message: "Quota is healthy. Use --force to freeze anyway.",
      json: jsonOutput,
      isTriggered: evaluation.isTriggered,
      markdown: "Quota is healthy. Freeze skipped. Use `--force` to freeze anyway.",
    };
  }

  const snapshot = await captureDagSnapshot({
    runRoot: loaded.runRoot,
    repositoryRoot: repo,
    lowestQuotaObserved: evaluation.lowestRemainingQuota,
    constrainedModels: evaluation.constrainedModels.map((m) => m.modelName),
    resetTime: evaluation.autoWakeSchedule?.targetWakeupIso ?? new Date().toISOString(),
  });
  persistDagSnapshot(snapshot);

  const markdown = formatDagSnapshotMarkdown(snapshot, evaluation, detailed);

  return {
    status: "frozen",
    snapshot,
    evaluation,
    json: jsonOutput,
    markdown,
  };
}
