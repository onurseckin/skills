import { purgeOrphanedScratch, scanRootHygiene } from "../../health/hygiene/index.ts";
import type { RepositoryHygieneFinding, RepositoryHygieneResult } from "./types.ts";

export interface RepositoryHygieneOptions {
  readonly repoRoot?: string | undefined;
  readonly fix?: boolean | undefined;
}

export { purgeOrphanedScratch };

export function checkRepositoryHygiene(
  options: RepositoryHygieneOptions = {},
): RepositoryHygieneResult {
  const res = scanRootHygiene({ repoRoot: options.repoRoot, fix: options.fix });
  const violations: RepositoryHygieneFinding[] = res.violations.map((v) => ({
    path: v.path,
    violationType: (v.violationType === "LOOSE_EXECUTABLE" ||
    v.violationType === "TEST_ARTIFACT_IN_SCRIPTS" ||
    v.violationType === "MISPLACED_FILE"
      ? "UNCONFINED_SCRATCH_SCRIPT"
      : v.violationType) as RepositoryHygieneFinding["violationType"],
    severity: v.severity === "WARNING" ? "WARN" : "ERROR",
    message: v.message,
  }));
  const scrubbedFiles = res.quarantinedFiles.filter((q) => q.success).map((q) => q.relativePath);
  return {
    passed: res.passed,
    violations,
    scrubbedFiles,
  };
}
