import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PolicyDiscoveryEngine,
  auditRepoGovernanceCoverage,
  discoverAndCalibrateRepoPolicy,
  type DiscoveredToolchainDetails,
  type GovernanceCoverageReport,
  type GovernanceToolchainDiscoveryResult,
  type RepoGovernanceStatus,
} from "../../../../olt/scripts/src/mind/governance/policy-discovery.ts";
import {
  auditGovernanceReadiness,
  bootstrapRepoGovernance,
  calibrateRepoGovernance,
  scaffoldTailoredRepoPolicy,
  verifyRepoGovernance,
} from "../../../../olt/scripts/src/mind/governance/policy-scaffold.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  computePolicyChecksum,
  detectPolicyDrift,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  validateRepoPolicy,
  type RepoPolicy,
} from "../../../../olt/scripts/src/policy/index.ts";
import {
  policyAuditCommand,
  policyCheckDriftCommand,
  policyGetCommand,
  policyInitCommand,
  policySetCommand,
} from "../../../../olt/scripts/src/cli/commands/policy-ops.ts";

describe("Policy & Repository Auto-Discovery Engine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `policy-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Multi-Ecosystem Toolchain Inspection & Discovery", () => {
    it("detects Bun ecosystem with bun test, TypeScript, ESLint, Prettier", () => {
      writeFileSync(join(testDir, "bun.lock"), "");
      writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext" } }));
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-bun-project",
          scripts: { test: "bun test", lint: "eslint .", typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.0.0", eslint: "^8.0.0", prettier: "^3.0.0" },
        }),
      );
      writeFileSync(join(testDir, "eslint.config.js"), "export default [];");
      writeFileSync(join(testDir, ".prettierrc"), "{}");

      const details: DiscoveredToolchainDetails = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("bun");
      expect(details.packageManager).toBe("bun");
      expect(details.detectedPackageManagers).toContain("bun");
      expect(details.detectedTestRunners).toContain("bun test");
      expect(details.detectedTypecheckers).toContain("tsc");
      expect(details.detectedLinters).toContain("eslint");
      expect(details.detectedFormatters).toContain("prettier");
      expect(details.formatCommand).toBe("bunx prettier --write .");
      expect(details.isTypeScript).toBe(true);
    });

    it("detects PNPM ecosystem with Vitest and Biome", () => {
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
      writeFileSync(join(testDir, "biome.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-pnpm-project",
          devDependencies: { vitest: "^1.0.0", "@biomejs/biome": "^1.5.0" },
        }),
      );

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("node");
      expect(details.packageManager).toBe("pnpm");
      expect(details.detectedPackageManagers).toContain("pnpm");
      expect(details.detectedTestRunners).toContain("vitest");
      expect(details.detectedLinters).toContain("biome");
      expect(details.detectedFormatters).toContain("biome");
      expect(details.formatCommand).toBe("biome format --write .");
    });

    it("detects Yarn ecosystem with Jest and Oxlint", () => {
      writeFileSync(join(testDir, "yarn.lock"), "");
      writeFileSync(join(testDir, ".oxlintrc.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "test-yarn-project",
          devDependencies: { jest: "^29.0.0", oxlint: "^0.2.0" },
        }),
      );

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("node");
      expect(details.packageManager).toBe("yarn");
      expect(details.detectedPackageManagers).toContain("yarn");
      expect(details.detectedTestRunners).toContain("jest");
      expect(details.detectedLinters).toContain("oxlint");
    });

    it("detects Python ecosystem with Poetry, Pytest, Pyright, and Ruff", () => {
      writeFileSync(join(testDir, "poetry.lock"), "");
      writeFileSync(join(testDir, "pyproject.toml"), "[tool.poetry]\nname = 'py-proj'");
      writeFileSync(join(testDir, "ruff.toml"), "");
      writeFileSync(join(testDir, "pyrightconfig.json"), "{}");

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("python");
      expect(details.packageManager).toBe("poetry");
      expect(details.detectedPackageManagers).toContain("poetry");
      expect(details.detectedTestRunners).toContain("pytest");
      expect(details.detectedTypecheckers).toContain("pyright");
      expect(details.detectedLinters).toContain("ruff");
      expect(details.detectedFormatters).toContain("ruff format");
      expect(details.formatCommand).toBe("ruff format .");
    });

    it("detects Python ecosystem with Pipenv, Mypy, and Flake8", () => {
      writeFileSync(join(testDir, "Pipfile"), "");
      writeFileSync(join(testDir, "mypy.ini"), "");
      writeFileSync(join(testDir, ".flake8"), "");
      mkdirSync(join(testDir, "tests"), { recursive: true });

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("python");
      expect(details.packageManager).toBe("pipenv");
      expect(details.detectedPackageManagers).toContain("pipenv");
      expect(details.detectedTestRunners).toContain("pytest");
      expect(details.detectedTypecheckers).toContain("mypy");
      expect(details.detectedLinters).toContain("flake8");
    });

    it("detects Rust ecosystem with Cargo and rustfmt", () => {
      writeFileSync(join(testDir, "Cargo.toml"), "[package]\nname = 'rust-proj'\nversion = '0.1.0'");
      writeFileSync(join(testDir, "rustfmt.toml"), "");

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBe("cargo");
      expect(details.packageManager).toBe("cargo");
      expect(details.detectedPackageManagers).toContain("cargo");
      expect(details.detectedTestRunners).toContain("cargo test");
      expect(details.detectedTypecheckers).toContain("cargo check");
      expect(details.detectedLinters).toContain("clippy");
      expect(details.detectedFormatters).toContain("rustfmt");
      expect(details.formatCommand).toBe("cargo fmt");
    });

    it("detects Go ecosystem with go.mod, go test, go vet, and gofmt", () => {
      writeFileSync(join(testDir, "go.mod"), "module example.com/go-proj\n\ngo 1.22");
      writeFileSync(join(testDir, ".golangci.yml"), "");

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.detectedPackageManagers).toContain("go");
      expect(details.detectedTestRunners).toContain("go test");
      expect(details.detectedTypecheckers).toContain("go vet");
      expect(details.detectedLinters).toContain("golangci-lint");
      expect(details.detectedFormatters).toContain("gofmt");
      expect(details.formatCommand).toBe("gofmt -w .");
    });

    it("detects monorepo workspace configuration via turbo", () => {
      writeFileSync(join(testDir, "turbo.json"), "{}");
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "monorepo-root" }));

      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.isMonorepo).toBe(true);
    });
  });

  describe("Calibration, Scaffolding & Policy Synthesis", () => {
    it("synthesizes calibrated repo policy and saves to .olt/policy.json", () => {
      writeFileSync(join(testDir, "bun.lock"), "");
      writeFileSync(join(testDir, "tsconfig.json"), "{}");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "calibrated-project",
          scripts: { test: "bun test", typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.0.0" },
        }),
      );

      const discovery: GovernanceToolchainDiscoveryResult = discoverAndCalibrateRepoPolicy(testDir);
      expect(discovery.repoRoot).toBe(testDir);
      expect(discovery.calibratedPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
      expect(discovery.calibratedPolicy.ecosystem).toBe("bun");
      expect(discovery.calibratedPolicy.test_runner.default_command).toContain("bun test");
      expect(discovery.calibratedPolicy.allowed_commands.length).toBeGreaterThan(0);

      const policyFilePath = join(testDir, ".olt", "policy.json");
      expect(existsSync(policyFilePath)).toBe(true);

      const loaded = loadRepoPolicy(testDir);
      expect(loaded.ecosystem).toBe("bun");
      expect(loaded.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    });

    it("scaffolds tailored policy with ecosystem override", () => {
      const policy = PolicyDiscoveryEngine.scaffoldTailoredPolicy(testDir, {
        overrideEcosystem: "python",
      });

      expect(policy.ecosystem).toBe("python");
      expect(policy.test_runner.default_command).toContain("pytest");
      expect(existsSync(join(testDir, ".olt", "policy.json"))).toBe(true);
    });

    it("initializes governance directories, policy, backlog, defects, and session grant", () => {
      const runRoot = join(testDir, ".olt", "capsules", "run-1");
      mkdirSync(runRoot, { recursive: true });

      const status: RepoGovernanceStatus = PolicyDiscoveryEngine.initializeGovernance({
        repoRoot: testDir,
        runRoot,
        mindId: "mind-governance-agent",
      });

      expect(status.ready).toBe(true);
      expect(existsSync(status.olt_dir)).toBe(true);
      expect(existsSync(status.policy_path)).toBe(true);
      expect(existsSync(status.backlog_path)).toBe(true);
      expect(existsSync(status.defects_path)).toBe(true);
      expect(existsSync(status.session_path)).toBe(true);

      const sessionRaw = JSON.parse(readFileSync(status.session_path, "utf8")) as Record<string, unknown>;
      expect(sessionRaw.agent_id).toBe("mind-governance-agent");
      expect(sessionRaw.role).toBe("mind");
    });
  });

  describe("Governance Coverage & Readiness Audit", () => {
    it("reports incomplete coverage on fresh uninitialized repo", () => {
      const report: GovernanceCoverageReport = auditRepoGovernanceCoverage(testDir);
      expect(report.policyPresent).toBe(false);
      expect(report.policyValid).toBe(false);
      expect(report.backlogLedgerPresent).toBe(false);
      expect(report.defectsLedgerPresent).toBe(false);
      expect(report.sessionAuthorityPresent).toBe(false);
      expect(report.readyForMindAuditor).toBe(false);
    });

    it("reports ready coverage after bootstrapping governance", () => {
      writeFileSync(join(testDir, "bun.lock"), "");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "audited-project",
          scripts: { test: "bun test", typecheck: "tsc --noEmit", lint: "eslint ." },
          devDependencies: { typescript: "^5.0.0", eslint: "^8.0.0", prettier: "^3.0.0" },
        }),
      );
      writeFileSync(join(testDir, ".prettierrc"), "{}");

      const runRoot = join(testDir, ".olt", "capsules", "run-audit");
      mkdirSync(runRoot, { recursive: true });

      bootstrapRepoGovernance({
        repoRoot: testDir,
        runRoot,
        mindId: "mind-auditor-test",
      });

      const report = auditGovernanceReadiness(testDir);
      expect(report.policyPresent).toBe(true);
      expect(report.policyValid).toBe(true);
      expect(report.ecosystem).toBe("bun");
      expect(report.hasTestRunner).toBe(true);
      expect(report.hasTypecheck).toBe(true);
      expect(report.hasLinter).toBe(true);
      expect(report.hasFormatter).toBe(true);
      expect(report.allowedCommandCount).toBeGreaterThan(0);
      expect(report.backlogLedgerPresent).toBe(true);
      expect(report.defectsLedgerPresent).toBe(true);
      expect(report.sessionAuthorityPresent).toBe(true);
      expect(report.readyForMindAuditor).toBe(true);
    });
  });

  describe("Policy Scaffolding Helpers & Facade Functions", () => {
    it("verifies and calibrates repo governance via helper functions", () => {
      const initialStatus = verifyRepoGovernance(testDir);
      expect(initialStatus.ready).toBe(false);

      const scaffolded = scaffoldTailoredRepoPolicy(testDir);
      expect(scaffolded.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

      const calibrated = calibrateRepoGovernance(testDir);
      expect(calibrated.calibratedPolicy).toBeDefined();
    });

    it("generates canonical and default policy structures", () => {
      const canonical = generateCanonicalDefaultPolicy(testDir, "node");
      expect(canonical.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
      expect(canonical.ecosystem).toBe("node");

      const defaultBun = generateDefaultRepoPolicy(testDir, "bun");
      expect(defaultBun.ecosystem).toBe("bun");
      expect(defaultBun.test_runner.default_command).toContain("bun test");

      const defaultRust = generateDefaultRepoPolicy(testDir, "cargo");
      expect(defaultRust.ecosystem).toBe("cargo");
      expect(defaultRust.test_runner.default_command).toContain("cargo test");
    });
  });

  describe("Policy Drift Detection & Checksum Validation", () => {
    it("computes deterministic policy checksum and detects no drift when identical", () => {
      const policy = generateDefaultRepoPolicy(testDir, "bun");
      saveRepoPolicy(policy, testDir);

      const checksum1 = computePolicyChecksum(testDir);
      const checksum2 = computePolicyChecksum(testDir);
      expect(checksum1).toBe(checksum2);
      expect(typeof checksum1).toBe("string");
      expect(checksum1.length).toBe(64);

      const drift = detectPolicyDrift(checksum1, testDir);
      expect(drift.drifted).toBe(false);
      expect(drift.currentChecksum).toBe(checksum1);
    });

    it("detects drift when policy file is mutated out-of-band", () => {
      const policy = generateDefaultRepoPolicy(testDir, "bun");
      saveRepoPolicy(policy, testDir);
      const originalChecksum = computePolicyChecksum(testDir);

      // Mutate policy out-of-band
      const policyPath = join(testDir, ".olt", "policy.json");
      const mutated: RepoPolicy = {
        ...policy,
        allowed_commands: [...policy.allowed_commands, "bun mutate --test"],
      };
      writeFileSync(policyPath, JSON.stringify(mutated, null, 2), "utf8");

      const drift = detectPolicyDrift(originalChecksum, testDir);
      expect(drift.drifted).toBe(true);
      expect(drift.currentChecksum).not.toBe(originalChecksum);
    });
  });

  describe("CLI Policy Commands", () => {
    it("executes policyInitCommand to scaffold and calibrate", async () => {
      writeFileSync(join(testDir, "bun.lock"), "");
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ name: "cli-policy-init", scripts: { test: "bun test" } }),
      );

      const res = await policyInitCommand({
        repo: testDir,
        calibrate: true,
      });

      expect(res.ok).toBe(true);
      expect(res.ecosystem).toBe("bun");
      expect(typeof res.file_path).toBe("string");
      expect(existsSync(res.file_path as string)).toBe(true);
    });

    it("executes policyGetCommand and policySetCommand to inspect and mutate properties", async () => {
      const policy = generateDefaultRepoPolicy(testDir, "node");
      saveRepoPolicy(policy, testDir);

      // Get property
      const getRes = await policyGetCommand({
        repo: testDir,
        key: "ecosystem",
      });
      expect(getRes.ok).toBe(true);
      expect(getRes.value).toBe("node");

      // Set property
      const setRes = await policySetCommand({
        repo: testDir,
        key: "read_scope_neighborhood_depth",
        value: "4",
      });
      expect(setRes.ok).toBe(true);

      const updated = loadRepoPolicy(testDir);
      expect(updated.read_scope_neighborhood_depth).toBe(4);
    });

    it("executes policyCheckDriftCommand to check policy integrity", async () => {
      const policy = generateDefaultRepoPolicy(testDir, "bun");
      saveRepoPolicy(policy, testDir);
      const checksum = computePolicyChecksum(testDir);

      const res = await policyCheckDriftCommand({
        repo: testDir,
        checksum,
      });
      expect(res.ok).toBe(true);
      expect(res.drifted).toBe(false);
      expect(res.status).toBe("in_sync");
    });

    it("executes policyAuditCommand to check governance readiness", async () => {
      const runRoot = join(testDir, ".olt", "capsules", "run-cli-audit");
      mkdirSync(runRoot, { recursive: true });

      bootstrapRepoGovernance({
        repoRoot: testDir,
        runRoot,
        mindId: "cli-auditor",
      });

      const auditRes = await policyAuditCommand({
        repo: testDir,
      });

      expect(auditRes.ok).toBe(true);
      expect(auditRes.report).toBeDefined();
      expect(auditRes.ready).toBe(true);
    });
  });

  describe("Edge Cases, Negative Tests & Counterfactual Proofs", () => {
    it("gracefully inspects an empty directory without crashing", () => {
      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBeDefined();
      expect(Array.isArray(details.detectedPackageManagers)).toBe(true);
      expect(Array.isArray(details.detectedTestRunners)).toBe(true);
      expect(Array.isArray(details.allowedCommands)).toBe(true);
    });

    it("handles malformed package.json syntax gracefully without crashing", () => {
      writeFileSync(join(testDir, "package.json"), "{ invalid-json: true, unterminated ");
      const details = PolicyDiscoveryEngine.inspect(testDir);
      expect(details.ecosystem).toBeDefined();
    });

    it("detects malformed policy.json during inspection and reports error", () => {
      const oltDir = join(testDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      writeFileSync(join(oltDir, "policy.json"), "{ invalid policy json content ");

      const inspection = inspectRepoPolicy(testDir);
      expect(inspection.status).toBe("invalid_custom");
      expect(inspection.error).toBeDefined();

      const audit = auditRepoGovernanceCoverage(testDir);
      expect(audit.policyPresent).toBe(true);
      expect(audit.policyValid).toBe(false);
      expect(audit.policyError).toBeDefined();
      expect(audit.readyForMindAuditor).toBe(false);
    });

    it("validates policy object structure and rejects unknown keys", () => {
      const invalidPolicy = {
        schema_version: 1,
        forbidden_unknown_field_12345: "should-fail",
      };

      expect(() => validateRepoPolicy(invalidPolicy)).toThrow();
    });

    it("handles missing policy file on loadRepoPolicy by falling back to auto-detected default", () => {
      const policy = loadRepoPolicy(testDir);
      expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
      expect(policy.ecosystem).toBeDefined();
    });

    it("handles corrupted policy file on loadRepoPolicy by throwing structured HarnessError", () => {
      const oltDir = join(testDir, ".olt");
      mkdirSync(oltDir, { recursive: true });
      writeFileSync(join(oltDir, "policy.json"), "NOT_JSON_AT_ALL");

      expect(() => loadRepoPolicy(testDir)).toThrow();
    });

    it("counterfactual: removing defects ledger invalidates readiness for Mind Auditor", () => {
      const runRoot = join(testDir, ".olt", "capsules", "run-counterfactual");
      mkdirSync(runRoot, { recursive: true });

      const status = PolicyDiscoveryEngine.initializeGovernance({
        repoRoot: testDir,
        runRoot,
        mindId: "mind-counterfactual",
      });
      expect(status.ready).toBe(true);

      // Delete defects ledger
      rmSync(status.defects_path, { force: true });

      const audit = auditRepoGovernanceCoverage(testDir);
      expect(audit.defectsLedgerPresent).toBe(false);
      expect(audit.readyForMindAuditor).toBe(false);
    });
  });
});
