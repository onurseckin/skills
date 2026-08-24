import { TelemetryNormalizationEngine } from "../../telemetry/engine.ts";
import {
  createDefaultCollectors,
  type CollectorEnvironment,
} from "../../telemetry/collectors/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export async function usageReportCommand(
  flags: Flags,
  _context?: CommandContext,
  _remainder?: readonly string[],
  env?: CollectorEnvironment,
): Promise<Record<string, unknown>> {
  const platformFilter = textFlag(flags, "platform", false);
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
  const markdown = engine.formatAsciiReport(report, detailed);

  return {
    markdown,
    report,
    summary: report.summary,
    timestamp: report.timestamp,
    json: jsonOutput,
  };
}
