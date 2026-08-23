import { HarnessError } from "../errors/harness-error.ts";
import {
  buildInclusiveStageArgs,
  isPathInWriteScope,
} from "./zero-destructive-policy.ts";

export { buildInclusiveStageArgs, isPathInWriteScope };

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

export function formatConventionalCommit(input: FormatConventionalCommitInput): string {
  const type = input.type.trim().toLowerCase();
  if (!CONVENTIONAL_COMMIT_TYPES.has(type)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid commit type '${input.type}'. Must be one of: ${Array.from(CONVENTIONAL_COMMIT_TYPES).join(", ")}`,
    );
  }
  const desc = input.description.trim();
  if (desc === "") {
    throw new HarnessError("INVALID_ARGUMENT", "Commit description cannot be empty");
  }

  const scope = input.scope !== undefined ? input.scope.trim().toLowerCase() : undefined;
  const breakingMark = input.isBreaking ? "!" : "";
  const headerPrefix = typeof scope === "string" && scope.length > 0 ? `${type}(${scope})${breakingMark}: ` : `${type}${breakingMark}: `;
  const header = `${headerPrefix}${desc}`;

  const sections: string[] = [header];

  if (input.body !== undefined && input.body.trim() !== "") {
    sections.push(input.body.trim());
  }

  if (input.breakingChangeDescription !== undefined && input.breakingChangeDescription.trim() !== "") {
    sections.push(`BREAKING CHANGE: ${input.breakingChangeDescription.trim()}`);
  }

  if (input.issuesClosed !== undefined && input.issuesClosed.length > 0) {
    const issues = input.issuesClosed
      .map((i) => i.trim())
      .filter((i) => i.length > 0);
    if (issues.length > 0) {
      sections.push(`Closes: ${issues.join(", ")}`);
    }
  }

  return sections.join("\n\n");
}

export function formatConventionalCommitMessage(input: FormatConventionalCommitInput): string {
  return formatConventionalCommit(input);
}

export function validatePhaseCommitMessage(message: string): CommitValidationResult {
  const errors: string[] = [];
  if (typeof message !== "string" || message.trim() === "") {
    return { valid: false, errors: ["Commit message cannot be empty"] };
  }

  const lines = message.split(/\r?\n/);
  const firstLine = lines[0];
  const header = typeof firstLine === "string" ? firstLine.trim() : "";

  const headerRegex = /^([a-zA-Z0-9_-]+)(?:\(([a-zA-Z0-9_/-]+)\))?(!)?:\s+(.+)$/u;
  const match = headerRegex.exec(header);

  if (!match) {
    errors.push(
      `Commit header '${header}' does not conform to Conventional Commits format '<type>(<scope>): <description>' or '<type>: <description>'`,
    );
    return { valid: false, errors };
  }

  const type = match[1]!.toLowerCase();
  const scope = match[2] ? match[2].toLowerCase() : undefined;
  let isBreaking = match[3] === "!";
  const description = match[4]!.trim();

  if (!CONVENTIONAL_COMMIT_TYPES.has(type)) {
    errors.push(
      `Commit type '${type}' is not recognized. Must be one of: ${Array.from(CONVENTIONAL_COMMIT_TYPES).join(", ")}`,
    );
  }

  if (description === "") {
    errors.push("Commit header description cannot be empty");
  }

  if (lines.length > 1 && lines[1]!.trim() !== "") {
    errors.push("Header must be separated from body by an empty line");
  }

  let breakingChangeDescription: string | undefined;
  const issuesClosed: string[] = [];
  const bodyParagraphs: string[] = [];

  let currentParagraph: string[] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      if (currentParagraph.length > 0) {
        processParagraph(currentParagraph.join("\n"));
        currentParagraph = [];
      }
    } else {
      currentParagraph.push(line);
    }
  }
  if (currentParagraph.length > 0) {
    processParagraph(currentParagraph.join("\n"));
  }

  function processParagraph(para: string): void {
    const trimmed = para.trim();
    if (/^BREAKING[\s-]CHANGE:\s+/u.test(trimmed)) {
      isBreaking = true;
      breakingChangeDescription = trimmed.replace(/^BREAKING[\s-]CHANGE:\s+/u, "").trim();
    } else if (/^(?:Closes|Fixes|Resolves|Refs):\s+/iu.test(trimmed)) {
      const issueText = trimmed.replace(/^(?:Closes|Fixes|Resolves|Refs):\s+/iu, "").trim();
      const ids = issueText.split(/[,;\s]+/u).map((s) => s.trim()).filter((s) => s.length > 0);
      issuesClosed.push(...ids);
    } else {
      bodyParagraphs.push(trimmed);
    }
  }

  const body = bodyParagraphs.length > 0 ? bodyParagraphs.join("\n\n") : undefined;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const parsed: ConventionalCommitMessage = {
    type,
    ...(scope ? { scope } : {}),
    isBreaking,
    description,
    ...(body ? { body } : {}),
    ...(breakingChangeDescription ? { breakingChangeDescription } : {}),
    ...(issuesClosed.length > 0 ? { issuesClosed } : {}),
    raw: message,
  };

  return {
    valid: true,
    errors: [],
    parsed,
  };
}

export function assertConventionalCommitCompliance(
  message: string | ConventionalCommitMessage,
): void {
  const raw = typeof message === "string" ? message : message.raw;
  const result = validatePhaseCommitMessage(raw);
  if (!result.valid) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Conventional commit compliance violation: ${result.errors.join("; ")}`,
      result.errors.map((error) => ({ error })),
      3,
      "Ensure commit message follows conventional commit format (e.g. feat(domain): description).",
    );
  }
}

export interface VerifyPhasePreconditionsOptions {
  modifiedPaths?: readonly string[] | undefined;
  gateResults?: readonly PhaseGateResult[] | undefined;
  now?: Date | undefined;
}

export function verifyPhasePreconditions(
  config: PhaseCommitConfig,
  options?: VerifyPhasePreconditionsOptions,
): PhaseVerificationResult {
  const issues: string[] = [];
  const now = options !== undefined && options.now !== undefined ? options.now : new Date();
  const timestamp = now.toISOString();

  if (typeof config.taskId !== "string" || config.taskId.trim() === "") {
    issues.push("Task ID cannot be empty");
  }

  if (config.writeScope === undefined || config.writeScope.length === 0) {
    issues.push(`Task '${config.taskId}' has empty writeScope`);
  }

  try {
    const formatted = formatConventionalCommit({
      type: config.commitType,
      scope: config.scope,
      description: config.description,
      body: config.body,
      isBreaking: config.isBreaking,
      breakingChangeDescription: config.breakingChangeDescription,
      issuesClosed: config.issuesClosed,
    });
    const commitCheck = validatePhaseCommitMessage(formatted);
    if (!commitCheck.valid) {
      issues.push(...commitCheck.errors);
    }
  } catch (err: unknown) {
    if (err instanceof HarnessError) {
      issues.push(err.message);
    } else {
      issues.push(String(err));
    }
  }

  let writeScopeClean = true;
  const unscopedModifiedPaths: string[] = [];
  if (options !== undefined && options.modifiedPaths !== undefined && options.modifiedPaths.length > 0 && config.writeScope !== undefined) {
    for (const path of options.modifiedPaths) {
      if (!isPathInWriteScope(path, config.writeScope)) {
        unscopedModifiedPaths.push(path);
      }
    }
    if (unscopedModifiedPaths.length > 0) {
      writeScopeClean = false;
      issues.push(
        `Modified paths outside assigned write scope: ${unscopedModifiedPaths.join(", ")}`,
      );
    }
  }

  const gateResults = options !== undefined && options.gateResults !== undefined ? options.gateResults : [];
  let gatesPassed = true;
  if (config.requirePassingGates) {
    if (gateResults.length === 0) {
      gatesPassed = false;
      issues.push("requirePassingGates is enabled but no gate results were supplied");
    } else {
      const failedGates = gateResults.filter((g) => !g.passed);
      if (failedGates.length > 0) {
        gatesPassed = false;
        issues.push(
          `Failing gates detected: ${failedGates.map((g) => `${g.gateId}${g.error ? ` (${g.error})` : ""}`).join(", ")}`,
        );
      }
    }
  }

  const preconditionsMet = issues.length === 0 && writeScopeClean && gatesPassed;

  return {
    verified: preconditionsMet,
    preconditionsMet,
    gateResults,
    writeScopeClean,
    unscopedModifiedPaths,
    issues,
    verifiedAt: timestamp,
  };
}

export interface CreatePhaseCommitPayloadOptions {
  modifiedPaths?: readonly string[] | undefined;
  gateResults?: readonly PhaseGateResult[] | undefined;
  now?: Date | undefined;
  strict?: boolean | undefined;
}

export function createPhaseCommitPayload(
  config: PhaseCommitConfig,
  options?: CreatePhaseCommitPayloadOptions,
): PhaseCommitPayload {
  const now = options !== undefined && options.now !== undefined ? options.now : new Date();
  const timestamp = now.toISOString();
  const verification = verifyPhasePreconditions(config, options);

  if (options !== undefined && options.strict && !verification.verified) {
    throw new HarnessError(
      "INTEGRITY",
      `Phase commit preconditions failed: ${verification.issues.join("; ")}`,
      verification.issues.map((i) => ({ issue: i })),
      3,
      "Resolve write scope violations or failing gates before creating phase commit.",
    );
  }

  const formattedMessage = formatConventionalCommit({
    type: config.commitType,
    scope: config.scope,
    description: config.description,
    body: config.body,
    isBreaking: config.isBreaking,
    breakingChangeDescription: config.breakingChangeDescription,
    issuesClosed: config.issuesClosed,
  });

  const parsedMessage = validatePhaseCommitMessage(formattedMessage);
  if (!parsedMessage.parsed) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to parse formatted conventional commit message: ${parsedMessage.errors.join("; ")}`,
      parsedMessage.errors.map((e) => ({ error: e })),
    );
  }

  const pushPolicy: UpstreamPushPolicy = config.upstreamPushPolicy !== undefined
    ? config.upstreamPushPolicy
    : {
        mode: "on-verified",
        remote: "origin",
        requireCleanBranch: true,
      };

  const stageArgs = buildInclusiveStageArgs(config.writeScope);

  return {
    taskId: config.taskId,
    commitMessage: parsedMessage.parsed,
    formattedMessage,
    writeScope: [...config.writeScope],
    stageArgs,
    verification,
    pushPolicy,
    timestamp,
  };
}

export function evaluateUpstreamPushPolicy(
  policy: UpstreamPushPolicy,
  verification: PhaseVerificationResult,
): PushEvaluationResult {
  const remote = typeof policy.remote === "string" && policy.remote.length > 0 ? policy.remote : "origin";
  const branch = policy.branch;

  switch (policy.mode) {
    case "never":
      return {
        shouldPush: false,
        reason: "Upstream push policy is set to 'never'",
        remote,
        ...(branch ? { branch } : {}),
      };
    case "always":
      return {
        shouldPush: true,
        reason: "Upstream push policy is set to 'always'",
        remote,
        ...(branch ? { branch } : {}),
      };
    case "on-verified":
      if (verification.verified) {
        return {
          shouldPush: true,
          reason: "Phase verification passed; pushing under 'on-verified' policy",
          remote,
          ...(branch ? { branch } : {}),
        };
      }
      return {
        shouldPush: false,
        reason: `Phase verification failed (${verification.issues.join("; ")}); skipping push`,
        remote,
        ...(branch ? { branch } : {}),
      };
    case "atomic-phase":
      if (verification.verified && verification.writeScopeClean) {
        return {
          shouldPush: true,
          reason: "Atomic phase verification satisfied and scope clean",
          remote,
          ...(branch ? { branch } : {}),
        };
      }
      return {
        shouldPush: false,
        reason: "Atomic phase criteria not satisfied; push prevented",
        remote,
        ...(branch ? { branch } : {}),
      };
    default:
      return {
        shouldPush: false,
        reason: "Unknown push policy mode",
        remote,
        ...(branch ? { branch } : {}),
      };
  }
}
