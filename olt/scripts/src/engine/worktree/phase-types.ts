export const CONVENTIONAL_COMMIT_TYPES: ReadonlySet<string> = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert",
  "hotfix",
  "security",
  "deps",
  "migration",
]);

export interface UpstreamPushPolicy {
  mode: "never" | "always" | "on-verified" | "atomic-phase";
  remote?: string | undefined;
  branch?: string | undefined;
  requireCleanBranch?: boolean | undefined;
  dryRun?: boolean | undefined;
  forceWithLease?: boolean | undefined;
}

export interface PhaseCommitConfig {
  taskId: string;
  scope?: string | undefined;
  commitType: string;
  description: string;
  body?: string | undefined;
  isBreaking?: boolean | undefined;
  breakingChangeDescription?: string | undefined;
  issuesClosed?: readonly string[] | undefined;
  writeScope: readonly string[];
  maxChangedLines?: number | undefined;
  requirePassingGates?: boolean | undefined;
  upstreamPushPolicy?: UpstreamPushPolicy | undefined;
}

export interface ConventionalCommitMessage {
  type: string;
  scope?: string | undefined;
  isBreaking: boolean;
  description: string;
  body?: string | undefined;
  breakingChangeDescription?: string | undefined;
  issuesClosed?: readonly string[] | undefined;
  raw: string;
}

export interface PhaseGateResult {
  gateId: string;
  passed: boolean;
  error?: string | undefined;
}

export interface PhaseVerificationResult {
  verified: boolean;
  preconditionsMet: boolean;
  gateResults: readonly PhaseGateResult[];
  writeScopeClean: boolean;
  unscopedModifiedPaths: readonly string[];
  issues: readonly string[];
  verifiedAt: string;
}

export interface PhaseCommitPayload {
  taskId: string;
  commitMessage: ConventionalCommitMessage;
  formattedMessage: string;
  writeScope: readonly string[];
  stageArgs: readonly string[];
  verification: PhaseVerificationResult;
  pushPolicy: UpstreamPushPolicy;
  timestamp: string;
}

export interface FormatConventionalCommitInput {
  type: string;
  scope?: string | undefined;
  description: string;
  body?: string | undefined;
  isBreaking?: boolean | undefined;
  breakingChangeDescription?: string | undefined;
  issuesClosed?: readonly string[] | undefined;
}

export interface CommitValidationResult {
  valid: boolean;
  errors: readonly string[];
  parsed?: ConventionalCommitMessage | undefined;
}

export interface PushEvaluationResult {
  shouldPush: boolean;
  reason: string;
  remote: string;
  branch?: string | undefined;
}
