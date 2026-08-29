import { HarnessError } from "../../../core/errors/index.ts";
import type { FeedbackResolutionProof } from "./types.ts";
export function validateFeedbackResolutionProof(
  proof: unknown,
  options: {
    readonly requireCommitSha?: boolean | undefined;
    readonly requireTestPath?: boolean | undefined;
  } = {},
): FeedbackResolutionProof {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof must be an object");
  }

  const p = proof as Record<string, unknown>;
  const taskId = typeof p["task_id"] === "string" ? p["task_id"].trim() : "";
  if (!taskId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires non-empty task_id",
    );
  }

  const resolvedAt =
    typeof p["resolved_at"] === "string" && p["resolved_at"].trim() ? p["resolved_at"].trim() : "";
  if (!resolvedAt) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires non-empty resolved_at",
    );
  }

  const parsedDate = Date.parse(resolvedAt);
  if (!Number.isFinite(parsedDate)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Feedback resolution proof resolved_at '${resolvedAt}' is not a valid ISO date timestamp`,
    );
  }

  const testPath =
    typeof p["test_path"] === "string" && p["test_path"].trim()
      ? p["test_path"].trim()
      : p["test_path"] === null
        ? null
        : undefined;
  if ("test_path" in p && p["test_path"] !== undefined && testPath === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid test_path");
  }

  if (options.requireTestPath && (!testPath || testPath.length < 3)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires valid test_path when requireTestPath is enabled",
    );
  }

  const testAssertion =
    typeof p["test_assertion"] === "string" && p["test_assertion"].trim()
      ? p["test_assertion"].trim()
      : p["test_assertion"] === null
        ? null
        : undefined;
  if ("test_assertion" in p && p["test_assertion"] !== undefined && testAssertion === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid test_assertion",
    );
  }

  let assertions: number | string | readonly string[] | null | undefined = undefined;
  if (typeof p["assertions"] === "number" || typeof p["assertions"] === "string") {
    assertions = p["assertions"];
  } else if (Array.isArray(p["assertions"])) {
    assertions = p["assertions"].map((a) => String(a));
  } else if (p["assertions"] === null) {
    assertions = null;
  } else if ("assertions" in p && p["assertions"] !== undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid assertions");
  }

  let runtimeMs: number | string | null | undefined = undefined;
  if (typeof p["runtime_ms"] === "number" || typeof p["runtime_ms"] === "string") {
    runtimeMs = p["runtime_ms"];
  } else if (typeof p["runtime"] === "number" || typeof p["runtime"] === "string") {
    runtimeMs = p["runtime"] as number | string;
  } else if (p["runtime_ms"] === null || p["runtime"] === null) {
    runtimeMs = null;
  } else if (
    ("runtime_ms" in p && p["runtime_ms"] !== undefined) ||
    ("runtime" in p && p["runtime"] !== undefined)
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid runtime_ms");
  }

  const commitSha =
    typeof p["commit_sha"] === "string" && p["commit_sha"].trim()
      ? p["commit_sha"].trim()
      : p["commit_sha"] === null
        ? null
        : undefined;
  if ("commit_sha" in p && p["commit_sha"] !== undefined && commitSha === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid commit_sha");
  }

  if (options.requireCommitSha && (!commitSha || commitSha.length < 7)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires valid commit_sha (>= 7 chars) when requireCommitSha is enabled",
    );
  }

  const proofSummary =
    typeof p["proof_summary"] === "string" && p["proof_summary"].trim()
      ? p["proof_summary"].trim()
      : p["proof_summary"] === null
        ? null
        : undefined;
  if ("proof_summary" in p && p["proof_summary"] !== undefined && proofSummary === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid proof_summary",
    );
  }

  const verifiedBy =
    typeof p["verified_by"] === "string" && p["verified_by"].trim()
      ? p["verified_by"].trim()
      : p["verified_by"] === null
        ? null
        : undefined;
  if ("verified_by" in p && p["verified_by"] !== undefined && verifiedBy === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid verified_by");
  }

  const remediationNotes =
    typeof p["remediation_notes"] === "string" && p["remediation_notes"].trim()
      ? p["remediation_notes"].trim()
      : p["remediation_notes"] === null
        ? null
        : undefined;
  if (
    "remediation_notes" in p &&
    p["remediation_notes"] !== undefined &&
    remediationNotes === undefined
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid remediation_notes",
    );
  }

  const metadata =
    typeof p["metadata"] === "object" && p["metadata"] !== null && !Array.isArray(p["metadata"])
      ? (p["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;
  if ("metadata" in p && p["metadata"] !== undefined && metadata === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid metadata");
  }

  return {
    task_id: taskId,
    resolved_at: resolvedAt,
    ...(testPath !== undefined ? { test_path: testPath } : {}),
    ...(testAssertion !== undefined ? { test_assertion: testAssertion } : {}),
    ...(assertions !== undefined ? { assertions } : {}),
    ...(runtimeMs !== undefined ? { runtime_ms: runtimeMs } : {}),
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(proofSummary !== undefined ? { proof_summary: proofSummary } : {}),
    ...(verifiedBy !== undefined ? { verified_by: verifiedBy } : {}),
    ...(remediationNotes !== undefined ? { remediation_notes: remediationNotes } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
