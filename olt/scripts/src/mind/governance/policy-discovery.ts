import type { RepoEcosystem, RepoPolicy } from "../../policy/types/index.ts";
import { inspectToolchainDetails, type DiscoveredToolchainDetails } from "./toolchain-inspector.ts";
import {
  testCommandEmpirically,
  testToolchainEmpirically,
  type EmpiricalCommandTestResult,
  type EmpiricalToolchainReport,
} from "./empirical-tester.ts";
import {
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  ensureCalibratedRepoPolicy,
  isRepoPolicyCalibrated,
  scaffoldTailoredPolicy,
  type GovernanceCoverageReport,
  type GovernanceToolchainDiscoveryResult,
} from "./policy-coverage.ts";
import {
  awakenTier0Governance,
  createTier0AgentGrants,
  initializeGovernance,
  type BootstrapRepoGovernanceOptions,
  type RepoGovernanceStatus,
  type Tier0AwakeningResult,
} from "./tier0-awakening.ts";

export type {
  DiscoveredToolchainDetails,
  EmpiricalCommandTestResult,
  EmpiricalToolchainReport,
  GovernanceCoverageReport,
  GovernanceToolchainDiscoveryResult,
  RepoGovernanceStatus,
  BootstrapRepoGovernanceOptions,
  Tier0AwakeningResult,
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
    timeoutMs = 2500,
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
  inspectToolchainDetails,
  testCommandEmpirically,
  testToolchainEmpirically,
  testToolchainEmpirically as testRepoToolchainEmpirically,
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  ensureCalibratedRepoPolicy,
  isRepoPolicyCalibrated,
  scaffoldTailoredPolicy,
  awakenTier0Governance,
  createTier0AgentGrants,
  initializeGovernance,
};
