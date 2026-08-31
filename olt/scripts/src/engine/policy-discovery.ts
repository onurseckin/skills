import type { AgentGrantRecord } from "../core/contracts/index.ts";
import type { RepoEcosystem, RepoPolicy } from "../policy/types/index.ts";
import {
  inspectToolchainDetails,
  type DiscoveredToolchainDetails,
} from "../mind/governance/toolchain-inspector.ts";
import {
  testCommandEmpirically,
  testToolchainEmpirically,
  testToolchainEmpirically as testRepoToolchainEmpirically,
  type EmpiricalCommandTestResult,
  type EmpiricalToolchainReport,
} from "../mind/governance/empirical-tester.ts";
import {
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  ensureCalibratedRepoPolicy,
  isRepoPolicyCalibrated,
  scaffoldTailoredPolicy,
  type GovernanceCoverageReport,
  type GovernanceToolchainDiscoveryResult,
} from "../mind/governance/policy-coverage.ts";
import {
  awakenTier0Governance,
  createTier0AgentGrants,
  initializeGovernance,
  type BootstrapRepoGovernanceOptions,
  type RepoGovernanceStatus,
  type Tier0AwakeningResult,
} from "../mind/governance/tier0-awakening.ts";

export type {
  EmpiricalCommandTestResult,
  EmpiricalToolchainReport,
  Tier0AwakeningResult,
  DiscoveredToolchainDetails,
  GovernanceToolchainDiscoveryResult,
  GovernanceCoverageReport,
  RepoGovernanceStatus,
  BootstrapRepoGovernanceOptions,
};

export class PolicyDiscoveryEngine {
  public static inspect(repoRoot: string): DiscoveredToolchainDetails {
    return inspectToolchainDetails(repoRoot);
  }

  public static discoverAndCalibrate(repoRoot: string): GovernanceToolchainDiscoveryResult {
    return discoverAndCalibrateRepoPolicy(repoRoot);
  }

  public static auditCoverage(repoRoot: string, capsuleRunRoot?: string): GovernanceCoverageReport {
    return auditRepoGovernanceCoverage(repoRoot, capsuleRunRoot);
  }

  public static scaffoldTailoredPolicy(
    repoRoot: string,
    options?: { overrideEcosystem?: RepoEcosystem },
  ): RepoPolicy {
    return scaffoldTailoredPolicy(repoRoot, options);
  }

  public static initializeGovernance(
    options: BootstrapRepoGovernanceOptions,
  ): RepoGovernanceStatus {
    return initializeGovernance(options);
  }

  public static isPolicyCalibrated(repoRoot: string): boolean {
    return isRepoPolicyCalibrated(repoRoot);
  }

  public static testCommandEmpirically(
    command: string,
    cwd: string,
    timeoutMs = 5000,
  ): EmpiricalCommandTestResult {
    return testCommandEmpirically(command, cwd, timeoutMs);
  }

  public static testToolchainEmpirically(
    repoRoot: string,
    details?: DiscoveredToolchainDetails,
  ): EmpiricalToolchainReport {
    return testToolchainEmpirically(repoRoot, details);
  }

  public static awakenTier0Ecosystem(
    options: BootstrapRepoGovernanceOptions & {
      testCommands?: boolean | undefined;
      overrideEcosystem?: RepoEcosystem | undefined;
    },
  ): Tier0AwakeningResult {
    return awakenTier0Governance(options);
  }

  public static ensurePolicyCalibrated(repoRoot: string): RepoPolicy {
    return ensureCalibratedRepoPolicy(repoRoot);
  }
}

export {
  createTier0AgentGrants,
  discoverAndCalibrateRepoPolicy,
  auditRepoGovernanceCoverage,
  isRepoPolicyCalibrated,
  ensureCalibratedRepoPolicy,
  awakenTier0Governance,
  testRepoToolchainEmpirically,
};
