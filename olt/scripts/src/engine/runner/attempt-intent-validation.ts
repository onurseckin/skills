import { existsSync } from "node:fs";
import type { CommandAttemptStartedRecord } from "../../contracts/commands.ts";
import { readCanonicalObject, sha256Bytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { cleanupDispositionIssues } from "./attempt-cleanup-disposition.ts";
import {
  readProcessIdentity,
  sameProcessIdentity,
  type ProcessIdentity,
} from "./process-identity.ts";

const SHA256 = /^[0-9a-f]{64}$/u;

export type AttemptProcessProof = "absent" | "live" | "reused" | "unknown";

export function ownershipTokenDigest(token: string): string {
  return sha256Bytes(new TextEncoder().encode(token));
}

export function retainedActivityTimes(
  activityPath: string,
  commandId: string,
  attempt: number,
  startedAt: string,
): { heartbeatAt: string | null; lastOutputAt: string | null } {
  if (!existsSync(activityPath)) return { heartbeatAt: null, lastOutputAt: null };
  const activity = readCanonicalObject(activityPath, "interrupted command activity", {
    maxBytes: 1024 * 1024,
    maxDepth: 16,
  });
  const previouslyObserved =
    activity.status === "failed" ? activity.last_observed_heartbeat_at : undefined;
  if (
    activity.schema !== "harness.command-activity" ||
    activity.version !== 1 ||
    activity.command_id !== commandId ||
    activity.attempt !== attempt ||
    activity.started_at !== startedAt ||
    !["completed", "failed", "running"].includes(String(activity.status)) ||
    typeof activity.heartbeat_at !== "string" ||
    !Number.isFinite(Date.parse(activity.heartbeat_at)) ||
    (previouslyObserved !== undefined &&
      previouslyObserved !== null &&
      (typeof previouslyObserved !== "string" ||
        !Number.isFinite(Date.parse(previouslyObserved)))) ||
    (activity.last_output_at !== null &&
      (typeof activity.last_output_at !== "string" ||
        !Number.isFinite(Date.parse(activity.last_output_at))))
  )
    throw new HarnessError("INTEGRITY", "interrupted command activity is invalid");
  return {
    heartbeatAt: (previouslyObserved === undefined ? activity.heartbeat_at : previouslyObserved) as
      | string
      | null,
    lastOutputAt: activity.last_output_at as string | null,
  };
}

export function probeAttemptProcess(expected: ProcessIdentity): AttemptProcessProof {
  const current = readProcessIdentity(expected.pid);
  if (current) return sameProcessIdentity(expected, current) ? "live" : "reused";
  try {
    process.kill(expected.pid, 0);
    return "unknown";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "absent" : "unknown";
  }
}

export function attemptStartedIssues(
  value: unknown,
  commandId: string,
  attempt: number,
  ownershipToken: string | undefined,
  expectedVerificationPublicKey: string,
): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return ["attempt started marker is invalid"];
  const record = value as Partial<CommandAttemptStartedRecord>;
  const issues: string[] = [];
  if (record.schema !== "harness.command-attempt-started" || record.version !== 1)
    issues.push("attempt started marker schema is invalid");
  if (record.command_id !== commandId || record.attempt !== attempt || record.status !== "running")
    issues.push("attempt started marker identity is invalid");
  if (typeof record.started_at !== "string" || !Number.isFinite(Date.parse(record.started_at)))
    issues.push("attempt started marker timestamp is invalid");
  if (
    typeof record.ownership_token_sha256 !== "string" ||
    !SHA256.test(record.ownership_token_sha256)
  )
    issues.push("attempt started ownership digest is invalid");
  if (
    ownershipToken !== undefined &&
    record.ownership_token_sha256 !== ownershipTokenDigest(ownershipToken)
  )
    issues.push("attempt started ownership digest does not match command intent");
  const root = record.root_pid_identity;
  if (
    root !== null &&
    (typeof root !== "object" ||
      !Number.isSafeInteger(root.pid) ||
      root.pid <= 1 ||
      !Number.isSafeInteger(root.parent) ||
      root.parent <= 0 ||
      !Number.isSafeInteger(root.group) ||
      root.group <= 0 ||
      typeof root.birth !== "string" ||
      !root.birth)
  )
    issues.push("attempt root process identity is invalid");
  issues.push(...cleanupDispositionIssues(record, expectedVerificationPublicKey));
  return issues;
}
