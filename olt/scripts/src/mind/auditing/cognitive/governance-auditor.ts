import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectRepoPolicy } from "../../../policy/index.ts";
import { resolveGlobalSessionsDir } from "../../../authority/session/index.ts";

export interface GovernanceAuditResult {
  readonly policyValid: boolean;
  readonly policyError?: string | undefined;
  readonly sessionVerified: boolean;
  readonly eventsProgressionValid: boolean;
  readonly simulatedExecutionDetected: boolean;
  readonly issues: readonly string[];
}

export function auditRepositoryGovernanceHelper(
  repoRoot: string,
  capsuleRunRoot?: string,
  resolveLatestCapsuleFn?: (repo: string) => string | null,
  resolveActiveMindGrantFn?: (repo: string, capsule?: string) => { actor: string } | null,
  resolveLatestPulseTimestampFn?: (repo: string, capsule?: string) => number | null,
): GovernanceAuditResult {
  const issues: string[] = [];

  const policyResult = inspectRepoPolicy(repoRoot);
  const hasPolicyFile =
    existsSync(join(repoRoot, ".olt", "policy.json")) || existsSync(join(repoRoot, "policy.json"));
  const policyValid = policyResult.status === "valid_custom" && hasPolicyFile;
  if (!policyValid) {
    issues.push(`Repository policy invalid or missing: ${policyResult.error ?? "unknown error"}`);
  }

  const activeGrant = resolveActiveMindGrantFn
    ? resolveActiveMindGrantFn(repoRoot, capsuleRunRoot)
    : null;
  let sessionVerified = false;
  if (activeGrant) {
    const globalSessions = resolveGlobalSessionsDir(repoRoot);
    const hasGlobalSession =
      existsSync(globalSessions) && readdirSync(globalSessions).some((f) => f.endsWith(".json"));
    const hasWorkspaceSession =
      existsSync(join(repoRoot, ".session.json")) ||
      existsSync(join(repoRoot, ".olt-identity.json"));
    const targetCapsule =
      capsuleRunRoot ?? (resolveLatestCapsuleFn ? resolveLatestCapsuleFn(repoRoot) : null);
    const hasCapsuleSession = targetCapsule
      ? existsSync(join(targetCapsule, "runtime", "sessions", `${activeGrant.actor}.json`))
      : false;
    sessionVerified = hasGlobalSession || hasWorkspaceSession || hasCapsuleSession;
    if (!sessionVerified) {
      issues.push(
        `Mind agent '${activeGrant.actor}' lacks verified session authority in .session.json or sessions/`,
      );
    }
  } else {
    sessionVerified = false;
  }

  let eventsProgressionValid = true;
  let simulatedExecutionDetected = false;
  const targetCapsule =
    capsuleRunRoot ?? (resolveLatestCapsuleFn ? resolveLatestCapsuleFn(repoRoot) : null);

  if (targetCapsule && existsSync(join(targetCapsule, "events.jsonl"))) {
    try {
      const lines = readFileSync(join(targetCapsule, "events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .filter((l) => l.trim().length > 0);

      if (lines.length === 0) {
        eventsProgressionValid = false;
        issues.push("events.jsonl is empty; no events recorded");
      } else {
        const pulseMs = resolveLatestPulseTimestampFn
          ? resolveLatestPulseTimestampFn(repoRoot, targetCapsule)
          : null;
        if (pulseMs !== null && lines.length <= 1) {
          simulatedExecutionDetected = true;
          eventsProgressionValid = false;
          issues.push(
            "Simulated execution detected: pulse claims ignition but events.jsonl sequence is <= 1",
          );
        }
      }
    } catch (err) {
      eventsProgressionValid = false;
      issues.push(`Failed to read events.jsonl: ${String(err)}`);
    }
  }

  return {
    policyValid,
    ...(policyResult.error ? { policyError: policyResult.error } : {}),
    sessionVerified,
    eventsProgressionValid,
    simulatedExecutionDetected,
    issues,
  };
}

export { auditRepositoryGovernanceHelper as auditRepositoryGovernance };
