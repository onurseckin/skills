import { HarnessError } from "../../core/errors/index.ts";
import { buildInclusiveStageArgs, isPathInWriteScope } from "./zero-destructive-policy.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  type UpstreamPushPolicy,
  type PhaseCommitConfig,
  type ConventionalCommitMessage,
  type PhaseGateResult,
  type PhaseVerificationResult,
  type PhaseCommitPayload,
  type FormatConventionalCommitInput,
  type CommitValidationResult,
  type PushEvaluationResult,
} from "./phase-types.ts";
import {
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
  assertConventionalCommitCompliance,
} from "./conventional-commit.ts";

export {
  buildInclusiveStageArgs,
  isPathInWriteScope,
  CONVENTIONAL_COMMIT_TYPES,
  type UpstreamPushPolicy,
  type PhaseCommitConfig,
  type ConventionalCommitMessage,
  type PhaseGateResult,
  type PhaseVerificationResult,
  type PhaseCommitPayload,
  type FormatConventionalCommitInput,
  type CommitValidationResult,
  type PushEvaluationResult,
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
  assertConventionalCommitCompliance,
};

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
  if (
    options !== undefined &&
    options.modifiedPaths !== undefined &&
    options.modifiedPaths.length > 0 &&
    config.writeScope !== undefined
  ) {
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

  const gateResults =
    options !== undefined && options.gateResults !== undefined ? options.gateResults : [];
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

  const pushPolicy: UpstreamPushPolicy =
    config.upstreamPushPolicy !== undefined
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
  const remote =
    typeof policy.remote === "string" && policy.remote.length > 0 ? policy.remote : "origin";
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
