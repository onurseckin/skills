import { resumeDagSnapshot, formatDagResumeMarkdown } from "../../telemetry/dag-snapshot.ts";
import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import { QuotaCircuitBreaker } from "../../telemetry/circuit-breaker.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export async function quotaResumeCommand(
  flags: Flags,
  _context?: CommandContext,
  _remainder?: readonly string[],
  env?: CollectorEnvironment,
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const run = textFlag(flags, "run", false);
  const snapshotPath = textFlag(flags, "snapshot", false);
  const rawThreshold = textFlag(flags, "threshold", false);
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : 5.0;
  const force = boolFlag(flags, "force");
  const jsonOutput = boolFlag(flags, "json");
  const detailed = boolFlag(flags, "detailed");

  if (!force) {
    const collectors = createDefaultCollectors(env);
    const engine = new TelemetryNormalizationEngine(collectors);
    const report = await engine.probeAll();

    const breaker = new QuotaCircuitBreaker();
    const evaluation = breaker.evaluate(report, {
      thresholdPercentage: isNaN(threshold) ? 5.0 : threshold,
      activeAgentsCount: 0,
    });

    if (evaluation.isTriggered) {
      return {
        status: "constrained",
        message: "Quota is still constrained. Use --force to resume anyway.",
        json: jsonOutput,
        isTriggered: evaluation.isTriggered,
        markdown: "Quota is still constrained. Resume skipped. Use `--force` to resume anyway.",
      };
    }
  }

  const snapshot = await resumeDagSnapshot({ repoRoot: repo, customPath: snapshotPath });
  const markdown = formatDagResumeMarkdown(snapshot, detailed);

  return {
    status: "resumed",
    snapshot,
    json: jsonOutput,
    markdown,
  };
}
