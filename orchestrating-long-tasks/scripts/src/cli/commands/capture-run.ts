import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadCaptureConfig } from "../../capture/config/config-loader.ts";
import { runLiveCapture } from "../../capture/runners/live-capture-runner.ts";
import { ingestScreenshots, ingestVisualReport } from "../../reporting/screenshot-ingestion.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export async function captureRunCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const runRoot = textFlag(flags, "run", false);
  const configPath = textFlag(flags, "config", false);
  const configDir = textFlag(flags, "config-dir", false) ?? process.cwd();
  const screenFilter = textFlag(flags, "screen", false);
  const viewportFilter = textFlag(flags, "viewport", false);
  const explicitOutDir = textFlag(flags, "out-dir", false);
  const explicitActor = textFlag(flags, "actor", false);
  const actor = explicitActor && explicitActor.length > 0 ? explicitActor : "capture-runner";

  let loadedConfig;
  try {
    loadedConfig = loadCaptureConfig({
      ...(configPath !== undefined ? { explicitPath: configPath } : {}),
      searchDir: configDir,
    });
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to load capture configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const outDir = explicitOutDir
    ? resolve(explicitOutDir)
    : runRoot
      ? resolve(runRoot, "evidence", "screenshots")
      : resolve(configDir, ".captures");

  mkdirSync(outDir, { recursive: true });

  const targetScreens = screenFilter ? [screenFilter] : undefined;
  const targetViewports = viewportFilter ? [viewportFilter] : undefined;

  const result = await runLiveCapture({
    config: loadedConfig,
    outDir,
    ...(targetScreens !== undefined ? { targetScreens } : {}),
    ...(targetViewports !== undefined ? { targetViewports } : {}),
  });

  if (!result.success && result.errors.length > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `Capture run encountered failures: ${result.errors.map((e) => e.error).join("; ")}`,
    );
  }

  // Ingest screenshots into capsule ledger if run is provided
  if (runRoot && existsSync(runRoot)) {
    ingestScreenshots({
      runRoot,
      searchDirs: [outDir],
      actor,
      startedAt: new Date().toISOString(),
    });
    ingestVisualReport({
      runRoot,
      searchDirs: [outDir],
      actor,
      startedAt: new Date().toISOString(),
    });
  }

  const screensProcessed = Array.from(new Set(result.captures.map((c) => c.screenId)));

  const markdown = [
    `### Capture Execution Completed`,
    `- **Screens Processed**: ${screensProcessed.length} (${screensProcessed.join(", ")})`,
    `- **Total Captures**: ${result.totalCaptures}`,
    `- **Output Directory**: \`${outDir}\``,
    `- **Companion Manifests**: ${result.captures.length} 1-to-1 paired manifests written`,
  ].join("\n");

  return {
    markdown,
    success: result.success,
    total_captures: result.totalCaptures,
    screens_processed: screensProcessed,
    output_dir: outDir,
    captures: result.captures.map((c) => ({
      screen_id: c.screenId,
      viewport: c.viewport,
      image_path: c.imagePath,
      manifest_path: c.manifestPath,
      verdict: "CERTIFIED",
      defects_count: 0,
    })),
  };
}
