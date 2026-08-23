import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/harness-error.ts";
import {
  synthesizeCompanionManifest,
  type CompanionManifestV2,
  type ValidationContext,
} from "../../capture/validator/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export function evaluateManifestFile(filePath: string): CompanionManifestV2 {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new HarnessError("INVALID_ARGUMENT", `Manifest file does not exist: ${resolved}`);
  }
  let loaded: unknown;
  try {
    const raw = readFileSync(resolved, "utf-8");
    loaded = JSON.parse(raw);
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to parse manifest JSON at ${resolved}: ${String(error)}`,
    );
  }

  if (typeof loaded !== "object" || loaded === null) {
    throw new HarnessError("INVALID_ARGUMENT", `Invalid manifest structure at ${resolved}`);
  }

  const manifestObj = loaded as Record<string, unknown>;
  const screenId = typeof manifestObj.screenId === "string" ? manifestObj.screenId : "unknown";
  const viewport = typeof manifestObj.viewport === "string" ? manifestObj.viewport : "desktop";
  let elements = Array.isArray(manifestObj.elements) ? manifestObj.elements : [];
  if (
    elements.length === 0 &&
    typeof manifestObj.physics === "object" &&
    manifestObj.physics !== null
  ) {
    const phys = manifestObj.physics as Record<string, unknown>;
    if (Array.isArray(phys.elements)) {
      elements = phys.elements;
    }
  }

  const context: ValidationContext = {
    screenId,
    viewport,
    elements: elements as ValidationContext["elements"],
  };

  return synthesizeCompanionManifest(context);
}

export function findManifestsInDir(dirPath: string): string[] {
  const resolved = resolve(dirPath);
  if (!existsSync(resolved)) return [];
  const found: string[] = [];

  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(resolved, ent.name);
      if (ent.isFile() && ent.name.endsWith(".manifest.json")) {
        found.push(full);
      } else if (ent.isDirectory() && !ent.name.startsWith(".")) {
        found.push(...findManifestsInDir(full));
      }
    }
  } catch {}

  return found;
}

export async function captureEvalCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const manifestPath = textFlag(flags, "manifest", false);
  const manifestDir = textFlag(flags, "manifest-dir", false);
  const strict = Boolean(flags.strict);

  if (!manifestPath && !manifestDir) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Either --manifest <path> or --manifest-dir <dir> must be provided",
    );
  }

  const manifestPaths: string[] = [];
  if (manifestPath) {
    manifestPaths.push(resolve(manifestPath));
  }
  if (manifestDir) {
    manifestPaths.push(...findManifestsInDir(manifestDir));
  }

  if (manifestPaths.length === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `No .manifest.json companion files found in specified path(s)`,
    );
  }

  const evaluations: CompanionManifestV2[] = [];
  let totalDefectsCount = 0;

  for (const path of manifestPaths) {
    const evalResult = evaluateManifestFile(path);
    evaluations.push(evalResult);
    totalDefectsCount += evalResult.totalDefects;
  }

  const certifiedCount = evaluations.filter((e) => e.verdict === "CERTIFIED").length;
  const defectsCount = evaluations.filter((e) => e.verdict === "DEFECTS_FOUND").length;

  const markdown = [
    `### 4-Pillar Validation Certification Results`,
    `- **Manifests Evaluated**: ${evaluations.length}`,
    `- **Certified (0 Defects)**: ${certifiedCount}`,
    `- **Defects Found**: ${defectsCount} (${totalDefectsCount} total defects)`,
    `- **Binary Verdict**: ${totalDefectsCount === 0 ? "✅ CERTIFIED" : "❌ DEFECTS_FOUND"}`,
  ].join("\n");

  if (strict && totalDefectsCount > 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `Strict certification failed: ${totalDefectsCount} defects found across ${defectsCount} screen manifests`,
      evaluations.flatMap((e) =>
        e.allDefects.map((d) => `[${d.pillar}:${d.category}] ${d.message}`),
      ),
      3,
      "Address flagged defects or run remediation generator before re-evaluating",
    );
  }

  return {
    markdown,
    verdict: totalDefectsCount === 0 ? "CERTIFIED" : "DEFECTS_FOUND",
    total_manifests: evaluations.length,
    certified_manifests: certifiedCount,
    defects_manifests: defectsCount,
    total_defects: totalDefectsCount,
    evaluations: evaluations.map((e) => ({
      screen_id: e.screenId,
      viewport: e.viewport,
      verdict: e.verdict,
      total_defects: e.totalDefects,
      critical_count: e.criticalCount,
      serious_count: e.seriousCount,
      moderate_count: e.moderateCount,
      minor_count: e.minorCount,
      criteria: e.criteria,
      ...(e.cognitiveAnalysis ? { cognitive_analysis: e.cognitiveAnalysis } : {}),
      remediations: e.remediationSummary,
    })),
  };
}
