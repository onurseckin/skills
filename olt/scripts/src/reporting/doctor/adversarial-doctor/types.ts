export type MutationKind =
  | "syntax_error"
  | "assertion_flip"
  | "return_override"
  | "empty_file"
  | "exception_injection"
  | "custom";

export interface CounterfactualMutation {
  readonly id: string;
  readonly filePath: string;
  readonly mutationKind: MutationKind;
  readonly originalContent: string;
  readonly mutatedContent: string;
  readonly appliedAt: string;
  readonly description: string;
}

export interface MutateScopeResult {
  readonly mutation: CounterfactualMutation;
  readonly revert: () => void;
}

export interface MutationOptions {
  readonly kind?: MutationKind;
  readonly customMutator?: (content: string) => string;
  readonly description?: string;
  readonly now?: string | number | Date;
  readonly allowedRoots?: readonly string[];
}

export interface AdversarialCheckResult {
  readonly checkId: string;
  readonly name: string;
  readonly targetPath: string;
  readonly passed: boolean;
  readonly falsified: boolean;
  readonly baselinePassed: boolean;
  readonly mutation?: CounterfactualMutation | undefined;
  readonly output?: string | undefined;
  readonly exitCode?: number | null | undefined;
  readonly durationMs?: number | undefined;
  readonly message?: string | undefined;
  readonly error?: string | undefined;
}

export type HealthCheckCategory =
  | "bun_version"
  | "capsule_root"
  | "evidence_location"
  | "tier_confinement"
  | "integrity"
  | "git_status"
  | "adversarial_falsifiability"
  | "custom";

export type HealthCheckStatus = "pass" | "fail" | "warn";

export interface HarnessHealthCheck {
  readonly name: string;
  readonly category: HealthCheckCategory;
  readonly status: HealthCheckStatus;
  readonly passed: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly remediation?: string | undefined;
}

export interface DoctorCertificationReport {
  readonly certified: boolean;
  readonly runRoot: string;
  readonly certifiedAt: string;
  readonly bunVersion: string;
  readonly bunSupported: boolean;
  readonly healthChecks: readonly HarnessHealthCheck[];
  readonly adversarialChecks: readonly AdversarialCheckResult[];
  readonly totalChecks: number;
  readonly passedChecks: number;
  readonly failedChecks: number;
  readonly criticalIssues: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: string;
  readonly markdown: string;
}

export interface AdversarialCheckOptions {
  readonly checkName?: string;
  readonly mutationKind?: MutationKind;
  readonly customMutator?: (content: string) => string;
  readonly timeoutMs?: number;
  readonly allowedRoots?: readonly string[];
  readonly testRunner?: (
    filePath: string,
  ) =>
    | Promise<{ success: boolean; output?: string; exitCode?: number }>
    | { success: boolean; output?: string; exitCode?: number };
  readonly testCommand?: readonly string[];
  readonly cwd?: string;
}

export interface DoctorDiagnosticOptions {
  readonly runRoot?: string;
  readonly state?: Record<string, unknown> | null;
  readonly repoRoot?: string;
  readonly checkTierConfinement?: boolean;
  readonly checkCapsuleRoot?: boolean;
  readonly checkUnifiedEvidence?: boolean;
  readonly checkBunVersion?: boolean;
  readonly checkIntegrity?: boolean;
  readonly minimumBunVersion?: string;
  readonly customChecks?: readonly (() => HarnessHealthCheck | Promise<HarnessHealthCheck>)[];
}

export interface DoctorCertificationOptions extends DoctorDiagnosticOptions {
  readonly writeScope?: readonly string[];
  readonly adversarialTestRunner?: (
    filePath: string,
  ) =>
    | Promise<{ success: boolean; output?: string; exitCode?: number }>
    | { success: boolean; output?: string; exitCode?: number };
  readonly runAdversarialChecks?: boolean;
  readonly mutationKind?: MutationKind;
  readonly now?: string | number | Date;
}
