import { isAbsolute, normalize, relative, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export const UNIFIED_EVIDENCE_DIRECTORY = "evidence";
export const UNIFIED_SCREENSHOTS_DIRECTORY = "evidence/screenshots";
export const UNIFIED_MANIFESTS_DIRECTORY = "evidence/manifests";
export const UNIFIED_BROWSER_RUNS_DIRECTORY = "evidence/browser-runs";

export type EvidenceCategory = "screenshots" | "manifests" | "browser-runs" | "reports" | "general";

/**
 * Checks if a relative path is stored strictly within the unified evidence hierarchy (evidence/ or evidence/screenshots/).
 */
export function isUnifiedEvidenceRelativePath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const normalized = normalize(path.trim()).replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    return false;
  }
  return (
    normalized === UNIFIED_EVIDENCE_DIRECTORY ||
    normalized.startsWith(`${UNIFIED_EVIDENCE_DIRECTORY}/`)
  );
}

/**
 * Checks if an absolute or relative path resides strictly inside a run's .capsules/<run>/evidence/ directory.
 */
export function isUnifiedEvidencePath(path: string, runRoot?: string): boolean {
  if (!path || typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!isAbsolute(trimmed)) {
    return isUnifiedEvidenceRelativePath(trimmed);
  }

  if (!runRoot) {
    const normalized = normalize(trimmed).replace(/\\/g, "/");
    return normalized.includes("/.capsules/") && normalized.includes("/evidence/");
  }

  const resolvedRunRoot = resolve(runRoot);
  const resolvedEvidenceDir = resolve(resolvedRunRoot, UNIFIED_EVIDENCE_DIRECTORY);
  const resolvedPath = resolve(trimmed);

  const rel = relative(resolvedEvidenceDir, resolvedPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Asserts that the given evidence path conforms to the unified evidence location.
 * Throws HarnessError('PATH_SAFETY') if the path is invalid.
 */
export function assertUnifiedEvidencePath(path: string, runRoot?: string): void {
  if (!isUnifiedEvidencePath(path, runRoot)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Validator evidence path "${path}" violates unified storage policy: all validator artifacts must reside under .capsules/<run>/evidence/ (e.g. evidence/ or evidence/screenshots/)`,
    );
  }
}

/**
 * Formats a canonical relative evidence path for a given filename and category.
 */
export function formatUnifiedEvidencePath(
  filename: string,
  category: EvidenceCategory = "general",
): string {
  const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  switch (category) {
    case "screenshots":
      return `${UNIFIED_SCREENSHOTS_DIRECTORY}/${cleanName}`;
    case "manifests":
      return `${UNIFIED_MANIFESTS_DIRECTORY}/${cleanName}`;
    case "browser-runs":
      return `${UNIFIED_BROWSER_RUNS_DIRECTORY}/${cleanName}`;
    case "reports":
    case "general":
    default:
      return `${UNIFIED_EVIDENCE_DIRECTORY}/${cleanName}`;
  }
}
