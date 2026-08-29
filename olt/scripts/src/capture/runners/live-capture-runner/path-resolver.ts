import { join, resolve } from "node:path";
import { loadCaptureConfig } from "../../config/config-loader.ts";
import { CANONICAL_VIEWPORTS } from "../../config/default-presets.ts";
import type { CaptureConfig, CaptureScreenTarget, CaptureViewport } from "../../config/types.ts";
import { resolveCapsulesDir } from "../../../core/shared/paths.ts";
import type { CaptureRunOptions } from "../types.ts";

export function resolveCaptureOutputDir(options: CaptureRunOptions, config: CaptureConfig): string {
  if (options.outDir && options.outDir.trim().length > 0) {
    return resolve(options.outDir.trim());
  }
  if (options.capsuleDir && options.capsuleDir.trim().length > 0) {
    return resolve(join(options.capsuleDir.trim(), "captures"));
  }
  if (options.runId && options.runId.trim().length > 0) {
    return resolve(join(resolveCapsulesDir(), options.runId.trim(), "captures"));
  }
  if (config.outputDir && config.outputDir.trim().length > 0) {
    return resolve(config.outputDir.trim());
  }
  return resolve("captures");
}

export function filterScreens(
  screens: readonly CaptureScreenTarget[],
  targetScreens?: readonly string[],
): readonly CaptureScreenTarget[] {
  if (!targetScreens || targetScreens.length === 0) return screens;
  const set = new Set(targetScreens.map((s) => s.toLowerCase()));
  return screens.filter((s) => set.has(s.id.toLowerCase()) || set.has(s.name.toLowerCase()));
}

export function resolveViewportsForScreen(
  screen: CaptureScreenTarget,
  config: CaptureConfig,
  targetViewports?: readonly string[],
): readonly CaptureViewport[] {
  if (targetViewports && targetViewports.length > 0) {
    const results: CaptureViewport[] = [];
    for (const name of targetViewports) {
      const vp = config.viewports[name] ?? CANONICAL_VIEWPORTS[name];
      if (vp) {
        results.push(vp);
      } else {
        results.push({ name, width: 1440, height: 900 });
      }
    }
    return results;
  }

  if (screen.viewports && screen.viewports.length > 0) {
    const results: CaptureViewport[] = [];
    for (const name of screen.viewports) {
      const vp = config.viewports[name] ?? CANONICAL_VIEWPORTS[name];
      if (vp) {
        results.push(vp);
      } else {
        results.push({ name, width: 1440, height: 900 });
      }
    }
    return results;
  }

  // Default to ALL viewports defined in config.viewports, or fallback to all CANONICAL_VIEWPORTS
  const allConfigured = Object.values(config.viewports);
  if (allConfigured.length > 0) {
    return allConfigured;
  }
  return Object.values(CANONICAL_VIEWPORTS);
}
