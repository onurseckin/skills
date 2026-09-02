import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PolicyDiscoveryEngine,
  auditRepoGovernanceCoverage,
  awakenTier0Governance,
  createTier0AgentGrants,
  discoverAndCalibrateRepoPolicy,
  ensureCalibratedRepoPolicy,
  initializeGovernance,
  inspectToolchainDetails,
  isRepoPolicyCalibrated,
  scaffoldTailoredPolicy,
  testCommandEmpirically,
  testRepoToolchainEmpirically,
  testToolchainEmpirically,
} from "../../../olt/scripts/src/mind/governance/policy-discovery.ts";

describe("PolicyDiscoveryEngine & Governance Policy Discovery Suite", () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "policy-discovery-test-"));
    runDir = join(tempDir, ".runs", "run-1");
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-package",
        scripts: { test: "bun test", lint: "biome check", check: "tsc --noEmit" },
      }),
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("instantiates PolicyDiscoveryEngine and inspects toolchain details", () => {
    const engine = new PolicyDiscoveryEngine();
    expect(engine).toBeInstanceOf(PolicyDiscoveryEngine);

    const details = PolicyDiscoveryEngine.inspect(tempDir);
    expect(details.detectedPackageManagers).toBeDefined();
    expect(details.isMonorepo).toBe(false);

    const direct = inspectToolchainDetails(tempDir);
    expect(direct.detectedPackageManagers).toBeDefined();
    expect(direct.detectedTestRunners).toContain("bun test");
  });

  it("discovers, calibrates, and verifies policy calibration", () => {
    expect(PolicyDiscoveryEngine.isPolicyCalibrated(tempDir)).toBe(false);
    expect(isRepoPolicyCalibrated(tempDir)).toBe(false);

    const discovery = PolicyDiscoveryEngine.discoverAndCalibrate(tempDir);
    expect(discovery.repoRoot).toBe(tempDir);
    expect(discovery.calibratedPolicy).toBeDefined();
    expect(discovery.calibratedPolicy.schema_version).toBe(1);
    expect(PolicyDiscoveryEngine.isPolicyCalibrated(tempDir)).toBe(true);

    const directDiscovery = discoverAndCalibrateRepoPolicy(tempDir);
    expect(directDiscovery.calibratedPolicy.schema_version).toBe(1);
  });

  it("audits governance coverage with and without capsuleRunRoot", () => {
    const reportWithoutCapsule = PolicyDiscoveryEngine.auditCoverage(tempDir);
    expect(reportWithoutCapsule.repoRoot).toBe(tempDir);
    expect(typeof reportWithoutCapsule.readyForMindAuditor).toBe("boolean");

    const capsuleDir = join(tempDir, ".olt", "capsules", "run-1");
    mkdirSync(capsuleDir, { recursive: true });
    const reportWithCapsule = auditRepoGovernanceCoverage(tempDir, capsuleDir);
    expect(reportWithCapsule.repoRoot).toBe(tempDir);
  });

  it("scaffolds tailored policy with and without options", () => {
    const policyDefault = PolicyDiscoveryEngine.scaffoldTailoredPolicy(tempDir);
    expect(policyDefault.schema_version).toBe(1);
    expect(policyDefault.agents).toBeDefined();

    const policyOverride = scaffoldTailoredPolicy(tempDir, { overrideEcosystem: "bun" });
    expect(policyOverride.schema_version).toBe(1);
    expect(policyOverride.ecosystem).toBe("bun");
  });

  it("initializes governance and creates tier 0 agent grants", () => {
    const status = PolicyDiscoveryEngine.initializeGovernance({
      repoRoot: tempDir,
      runRoot: runDir,
      mindId: "mind-test-init",
    });
    expect(status.ready).toBe(true);
    expect(status.olt_dir).toBe(join(tempDir, ".olt"));
    expect(status.policy_path).toBe(join(tempDir, ".olt", "policy.json"));

    const grants = createTier0AgentGrants("mind-test-init");
    expect(grants.length).toBe(3);

    const directStatus = initializeGovernance({
      repoRoot: tempDir,
      runRoot: runDir,
      mindId: "mind-test-direct",
    });
    expect(directStatus.ready).toBe(true);
  });

  it("runs empirical command testing with default and explicit timeouts", () => {
    const defaultRes = PolicyDiscoveryEngine.testCommandEmpirically("echo test-default", tempDir);
    expect(defaultRes.command).toBe("echo test-default");
    expect(defaultRes.available).toBe(true);

    const explicitRes = testCommandEmpirically("echo test-explicit", tempDir, 4000);
    expect(explicitRes.available).toBe(true);
  });

  it("runs empirical toolchain testing with and without provided details", () => {
    const report1 = PolicyDiscoveryEngine.testToolchainEmpirically(tempDir);
    expect(report1.repoRoot).toBe(tempDir);
    expect(Array.isArray(report1.verifiedCommands)).toBe(true);

    const details = PolicyDiscoveryEngine.inspect(tempDir);
    const report2 = testToolchainEmpirically(tempDir, details);
    expect(report2.repoRoot).toBe(tempDir);

    const report3 = testRepoToolchainEmpirically(tempDir, details);
    expect(report3.repoRoot).toBe(tempDir);
  });

  it("awakens tier 0 governance ecosystem and ensures policy calibrated", () => {
    const awakening = PolicyDiscoveryEngine.awakenTier0Ecosystem({
      repoRoot: tempDir,
      runRoot: runDir,
      mindId: "mind-test-awaken",
      testCommands: false,
      overrideEcosystem: "bun",
    });
    expect(awakening.repoRoot).toBe(tempDir);
    expect(awakening.policy).toBeDefined();

    const policy = PolicyDiscoveryEngine.ensurePolicyCalibrated(tempDir);
    expect(policy.schema_version).toBe(1);

    const directPolicy = ensureCalibratedRepoPolicy(tempDir);
    expect(directPolicy.schema_version).toBe(1);

    const directAwakening = awakenTier0Governance({
      repoRoot: tempDir,
      runRoot: runDir,
      mindId: "mind-test-direct-awaken",
    });
    expect(directAwakening.repoRoot).toBe(tempDir);
  });
});
