import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { saveRepoPolicy, type RepoPolicy } from "../../policy/index.ts";
import { synthesizeCalibratedRepoPolicy } from "../../policy/generator/index.ts";
import { registerSessionGrant } from "../../authority/session/index.ts";
import type { RepoEcosystem } from "../../policy/types/index.ts";
import {
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  scaffoldTailoredPolicy,
  type GovernanceCoverageReport,
  type GovernanceToolchainDiscoveryResult,
} from "./policy-coverage.ts";
import {
  awakenTier0Governance as awakeningAwakenTier0,
  type BootstrapRepoGovernanceOptions,
  type RepoGovernanceStatus,
  type Tier0AwakeningResult,
} from "./tier0-awakening.ts";
import { testToolchainEmpirically, type EmpiricalToolchainReport } from "./empirical-tester.ts";

export type { RepoGovernanceStatus, BootstrapRepoGovernanceOptions };

export function verifyRepoGovernance(repoRoot: string): RepoGovernanceStatus {
  const root = resolve(repoRoot);
  const oltDir = join(root, ".olt");
  const policyPath = join(oltDir, "policy.json");
  const backlogPath = join(oltDir, "backlog.jsonl");
  const defectsPath = join(oltDir, "defects.jsonl");
  const sessionPath = join(root, ".session.json");
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

export function testRepoToolchainEmpirically(repoRoot: string): EmpiricalToolchainReport {
  return testToolchainEmpirically(repoRoot);
}

export function scaffoldTailoredRepoPolicy(
  repoRoot: string,
  options?: { overrideEcosystem?: RepoEcosystem },
): RepoPolicy {
  return scaffoldTailoredPolicy(repoRoot, options);
}

export function awakenTier0Governance(
  options: BootstrapRepoGovernanceOptions & {
    testCommands?: boolean | undefined;
    overrideEcosystem?: RepoEcosystem | undefined;
  },
): Tier0AwakeningResult {
  return awakeningAwakenTier0(options);
}

export function bootstrapRepoGovernance(
  options: BootstrapRepoGovernanceOptions,
): RepoGovernanceStatus {
  const root = resolve(options.repoRoot);
  const oltDir = join(root, ".olt");
  if (!existsSync(oltDir)) {
    mkdirSync(oltDir, { recursive: true });
  }

  const policyPath = join(oltDir, "policy.json");
  if (!existsSync(policyPath)) {
    const calibratedPolicy = synthesizeCalibratedRepoPolicy(root);
    saveRepoPolicy(calibratedPolicy, root);
  }

  const backlogPath = join(oltDir, "backlog.jsonl");
  if (!existsSync(backlogPath)) {
    writeFileSync(backlogPath, "", "utf8");
  }

  const defectsPath = join(oltDir, "defects.jsonl");
  if (!existsSync(defectsPath)) {
    writeFileSync(defectsPath, "", "utf8");
  }

  const sessionPath = join(root, ".session.json");
  if (!existsSync(sessionPath)) {
    const grant = registerSessionGrant({
      agentId: options.mindId,
      role: "mind",
      runRoot: options.runRoot,
      worktreeDir: root,
    });
    writeFileSync(sessionPath, JSON.stringify(grant, null, 2), "utf8");
  }

  return verifyRepoGovernance(root);
}
