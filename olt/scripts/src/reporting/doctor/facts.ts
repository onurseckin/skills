import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifyIntegrity, verifyCapsuleDeep } from "../../engine/store/index.ts";
import { MINIMUM_BUN_VERSION } from "../../core/config/contracts.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import type { IntegrityIssue } from "../../core/contracts/index.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";

export type DoctorIssueSeverity = "critical" | "cosmetic";

const COSMETIC_ISSUE_CODES: ReadonlySet<string> = new Set([
  "LAYOUT_UNDECLARED",
  "capsule_root",
  "capsules_dir",
]);

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function ignoredByGit(
  runRoot: string,
  command: RepositoryGitCommand = repositoryGit,
): boolean | null {
  let repository: string;
  try {
    repository = findRepoRoot(runRoot);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "PATH_SAFETY") return null;
    throw error;
  }
  if (!existsSync(join(repository, ".git"))) return null;
  try {
    return command(repository, ["check-ignore", "--quiet", runRoot], 1024, [0, 1]).status === 0;
  } catch {
    return null;
  }
}

export function classifyIssueSeverity(issue: string): DoctorIssueSeverity {
  const code = issue.split(":", 1)[0];
  if (code !== undefined && COSMETIC_ISSUE_CODES.has(code)) return "cosmetic";
  if (
    issue.startsWith("[INFO]") ||
    issue.startsWith("[WARN]") ||
    issue.includes("[minor]") ||
    issue.includes("[warning]") ||
    issue.includes("not gitignored")
  ) {
    return "cosmetic";
  }
  return "critical";
}

export interface DoctorIssueTiering {
  readonly criticalIssues: readonly string[];
  readonly cosmeticIssues: readonly string[];
  readonly healthy: boolean;
}

export function tierDoctorIssues(issues: readonly string[]): DoctorIssueTiering {
  const criticalIssues = issues.filter((issue) => classifyIssueSeverity(issue) === "critical");
  const cosmeticIssues = issues.filter((issue) => classifyIssueSeverity(issue) === "cosmetic");
  return { criticalIssues, cosmeticIssues, healthy: criticalIssues.length === 0 };
}

export interface CapsuleDoctorFacts {
  readonly integrityIssues: readonly IntegrityIssue[];
  readonly criticalIntegrityIssues: readonly IntegrityIssue[];
  readonly gitignored: boolean | null;
  readonly bunSupported: boolean;
  readonly issues: readonly string[];
  readonly criticalIssues: readonly string[];
  readonly cosmeticIssues: readonly string[];
  readonly healthy: boolean;
}

export function computeCapsuleDoctorFacts(
  runRoot: string,
  gitCommand: RepositoryGitCommand = repositoryGit,
): CapsuleDoctorFacts {
  const integrityIssues = [...verifyIntegrity(runRoot), ...verifyCapsuleDeep(runRoot)];
  const criticalIntegrityIssues = integrityIssues.filter(
    (issue) => classifyIssueSeverity(`${issue.code}: ${issue.message}`) === "critical",
  );
  const gitignored = ignoredByGit(runRoot, gitCommand);
  const bunSupported = versionAtLeast(Bun.version, MINIMUM_BUN_VERSION);
  const issues = [
    ...integrityIssues.map(({ code, message }) => `${code}: ${message}`),
    ...(gitignored === false ? ["run capsule is not gitignored"] : []),
    ...(bunSupported ? [] : [`Bun ${Bun.version} is below ${MINIMUM_BUN_VERSION}`]),
  ];
  const tiering = tierDoctorIssues(issues);
  return { integrityIssues, criticalIntegrityIssues, gitignored, bunSupported, issues, ...tiering };
}
