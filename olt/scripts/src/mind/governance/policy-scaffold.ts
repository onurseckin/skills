import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveRepoPolicy, type RepoPolicy } from "../../policy/index.ts";
import { synthesizeCalibratedRepoPolicy } from "../../policy/generator/index.ts";
import { registerSessionGrant } from "../../authority/session/grants.ts";
import {
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  type GovernanceCoverageReport,
  type GovernanceToolchainDiscoveryResult,
} from "./policy-discovery.ts";
import { PolicyDiscoveryEngine } from "../../engine/policy-discovery.ts";

export interface RepoGovernanceStatus {
  readonly olt_dir: string;
  readonly policy_path: string;
  readonly backlog_path: string;
  readonly defects_path: string;
  readonly session_path: string;
  readonly ready: boolean;
}

export interface BootstrapRepoGovernanceOptions {
  readonly repoRoot: string;
  readonly runRoot: string;
  readonly mindId: string;
}

export function verifyRepoGovernance(repoRoot: string): RepoGovernanceStatus {
  const oltDir = join(repoRoot, ".olt");
  const policyPath = join(oltDir, "policy.json");
  const backlogPath = join(oltDir, "backlog.jsonl");
  const defectsPath = join(oltDir, "defects.jsonl");
  const sessionPath = join(repoRoot, ".session.json");
  const ready =
    existsSync(oltDir) &&
    existsSync(policyPath) &&
    existsSync(backlogPath) &&
    existsSync(defectsPath) &&
    existsSync(sessionPath);
  return {
    olt_dir: oltDir,
    policy_path: policyPath,
    backlog_path: backlogPath,
    defects_path: defectsPath,
    session_path: sessionPath,
    ready,
  };
}

export function calibrateRepoGovernance(repoRoot: string): GovernanceToolchainDiscoveryResult {
  return discoverAndCalibrateRepoPolicy(repoRoot);
}

export function auditGovernanceReadiness(
  repoRoot: string,
  capsuleRunRoot?: string,
): GovernanceCoverageReport {
  return auditRepoGovernanceCoverage(repoRoot, capsuleRunRoot);
}

export function scaffoldTailoredRepoPolicy(repoRoot: string): RepoPolicy {
  return PolicyDiscoveryEngine.scaffoldTailoredPolicy(repoRoot);
}

export function bootstrapRepoGovernance(
  options: BootstrapRepoGovernanceOptions,
): RepoGovernanceStatus {
  const oltDir = join(options.repoRoot, ".olt");
  if (!existsSync(oltDir)) {
    mkdirSync(oltDir, { recursive: true });
  }

  const policyPath = join(oltDir, "policy.json");
  if (!existsSync(policyPath)) {
    const calibratedPolicy = synthesizeCalibratedRepoPolicy(options.repoRoot);
    saveRepoPolicy(calibratedPolicy, options.repoRoot);
  }

  const backlogPath = join(oltDir, "backlog.jsonl");
  if (!existsSync(backlogPath)) {
    writeFileSync(backlogPath, "", "utf8");
  }

  const defectsPath = join(oltDir, "defects.jsonl");
  if (!existsSync(defectsPath)) {
    writeFileSync(defectsPath, "", "utf8");
  }

  const sessionPath = join(options.repoRoot, ".session.json");
  if (!existsSync(sessionPath)) {
    const grant = registerSessionGrant({
      agentId: options.mindId,
      role: "mind",
      runRoot: options.runRoot,
      worktreeDir: options.repoRoot,
    });
    writeFileSync(sessionPath, JSON.stringify(grant, null, 2), "utf8");
  }

  return verifyRepoGovernance(options.repoRoot);
}
