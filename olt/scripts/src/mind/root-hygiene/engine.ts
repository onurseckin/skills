import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { quarantineViolations } from "./quarantine.ts";
import { scanRootHygiene } from "./scanner.ts";
import type {
  QuarantinedFileRecord,
  RootHygieneFinding,
  RootHygieneOptions,
  RootHygieneScanResult,
} from "./types.ts";

export function assertCleanRootHygiene(options: RootHygieneOptions = {}): void {
  const result = scanRootHygiene(options);
  if (!result.passed) {
    const summary = result.violations
      .map((v) => `[${v.scope}] ${v.violationType}: ${v.relativePath}`)
      .join(", ");
    throw new HarnessError(
      "PATH_SAFETY",
      `[ROOT_HYGIENE_VIOLATION] Hygiene violations detected: ${summary}`,
    );
  }
}

export class RootHygieneEngine {
  public constructor(private readonly options: RootHygieneOptions = {}) {}
  public scan(overrides?: RootHygieneOptions): RootHygieneScanResult {
    return scanRootHygiene({ ...this.options, ...overrides });
  }
  public quarantine(
    violations: readonly RootHygieneFinding[],
    qDir?: string,
  ): QuarantinedFileRecord[] {
    return quarantineViolations(
      resolve(this.options.repoRoot ?? process.cwd()),
      violations,
      qDir ?? this.options.quarantineDir,
    );
  }
  public assertClean(overrides?: RootHygieneOptions): void {
    assertCleanRootHygiene({ ...this.options, ...overrides });
  }
  public static scan(options?: RootHygieneOptions): RootHygieneScanResult {
    return scanRootHygiene(options);
  }
  public static quarantine(
    repoRoot: string,
    violations: readonly RootHygieneFinding[],
    targetQuarantineDir?: string,
  ): QuarantinedFileRecord[] {
    return quarantineViolations(repoRoot, violations, targetQuarantineDir);
  }
  public static assertClean(options?: RootHygieneOptions): void {
    assertCleanRootHygiene(options);
  }
}
