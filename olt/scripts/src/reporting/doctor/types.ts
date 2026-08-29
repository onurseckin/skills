export type DoctorSeverity = "ERROR" | "WARN" | "INFO";

export interface DoctorDiagnosticFinding {
  readonly code: string;
  readonly severity: DoctorSeverity;
  readonly message: string;
  readonly engine: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface DoctorCheckEngineResult {
  readonly engine: string;
  readonly passed: boolean;
  readonly findings: readonly DoctorDiagnosticFinding[];
}

export interface DoctorAutoHealResult {
  readonly autoHealed: readonly string[];
  readonly recoveredLeases: readonly string[];
  readonly projectionRecovered: boolean;
  readonly quarantinedFragments: readonly string[];
  readonly danglingLocksCleared: readonly string[];
  readonly migratedLedgers: readonly string[];
  readonly gitIndexHealed: boolean;
  readonly gitArtifactsStaged: readonly string[];
}

export interface AutoHealOptions {
  readonly actor?: string | undefined;
  readonly graceSeconds?: number | undefined;
  readonly repoRoot?: string | undefined;
  readonly nonInteractive?: boolean | undefined;
}

export interface RepositoryHygieneFinding {
  readonly path: string;
  readonly violationType:
    | "UNAPPROVED_ROOT_FILE"
    | "UNAPPROVED_ROOT_DIR"
    | "STATIC_PACKAGE_RUNTIME_POLLUTION"
    | "UNCONFINED_SCRATCH_SCRIPT";
  readonly severity: "ERROR" | "WARN";
  readonly message: string;
}

export interface RepositoryHygieneResult {
  readonly passed: boolean;
  readonly violations: readonly RepositoryHygieneFinding[];
  readonly scrubbedFiles: readonly string[];
}

export interface AstPurityFinding {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly violationType:
    | "EXPLICIT_ANY"
    | "ANY_TYPE_ASSERTION"
    | "COMPILER_SUPPRESSION_DIRECTIVE"
    | "BANNED_GLOBAL_SYMBOL";
  readonly nodeText: string;
  readonly message: string;
}

export interface GitIndexIntegrityReport {
  readonly healthy: boolean;
  readonly staleIndexLockPresent: boolean;
  readonly staleIndexLockPath?: string | undefined;
  readonly deadLockPid?: number | undefined;
  readonly uncommittedArtifacts: readonly string[];
  readonly stashCorrupted: boolean;
  readonly findings: readonly DoctorDiagnosticFinding[];
}

export interface CounterfactualCheckRecord {
  readonly checkId: string;
  readonly name: string;
  readonly targetPath: string;
  readonly passed: boolean;
  readonly falsified: boolean;
  readonly mutation?: unknown;
}

export interface AntiMockMutationCheckOptions {
  readonly testFiles?: readonly string[] | undefined;
  readonly sourceFiles?: readonly string[] | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly targetPaths?: readonly string[] | undefined;
  readonly fileContents?: Readonly<Record<string, string>> | undefined;
  readonly repoRoot?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly counterfactualRecords?: readonly CounterfactualCheckRecord[] | undefined;
}
