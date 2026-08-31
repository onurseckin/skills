import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSkillHomeRepo } from "../core/shared/paths.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_LIFECYCLE_HOOKS_CONFIG,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
} from "../policy/index.ts";
import {
  buildDefaultAgents,
  buildDefaultDocker,
  discoverToolchain,
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
  type DiscoveredToolchain,
  type ToolchainAnalysis,
} from "../policy/generator/index.ts";
import type {
  PackageManager,
  RepoEcosystem,
  RepoPolicy,
  TestRunnerPolicy,
} from "../policy/types/index.ts";
import { registerSessionGrant } from "../authority/session/grants.ts";

export interface DiscoveredToolchainDetails {
  readonly ecosystem: RepoEcosystem;
  readonly packageManager?: PackageManager | undefined;
  readonly testRunner: TestRunnerPolicy;
  readonly typecheckCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly formatCommand?: string | undefined;
  readonly detectedFormatters: readonly string[];
  readonly detectedLinters: readonly string[];
  readonly detectedTypecheckers: readonly string[];
  readonly detectedTestRunners: readonly string[];
  readonly detectedPackageManagers: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
  readonly isMonorepo: boolean;
  readonly isTypeScript: boolean;
}

export interface GovernanceToolchainDiscoveryResult {
  readonly repoRoot: string;
  readonly toolchain: DiscoveredToolchain;
  readonly analysis: ToolchainAnalysis;
  readonly calibratedPolicy: RepoPolicy;
  readonly details?: DiscoveredToolchainDetails | undefined;
}

export interface GovernanceCoverageReport {
  readonly repoRoot: string;
  readonly policyPresent: boolean;
  readonly policyValid: boolean;
  readonly policyError?: string | undefined;
  readonly ecosystem: string;
  readonly hasTestRunner: boolean;
  readonly hasTypecheck: boolean;
  readonly hasLinter: boolean;
  readonly hasFormatter?: boolean | undefined;
  readonly allowedCommandCount: number;
  readonly sessionAuthorityPresent: boolean;
  readonly backlogLedgerPresent: boolean;
  readonly defectsLedgerPresent: boolean;
  readonly readyForMindAuditor: boolean;
}

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

export class PolicyDiscoveryEngine {
  public static inspect(repoRoot: string): DiscoveredToolchainDetails {
    const root = resolve(repoRoot);
    const discovered = discoverToolchain(root);

    const detectedPackageManagers: string[] = [];
    const detectedTestRunners: string[] = [];
    const detectedTypecheckers: string[] = [];
    const detectedLinters: string[] = [];
    const detectedFormatters: string[] = [];

    // 1. Package Manager Detection
    if (
      existsSync(join(root, "bun.lock")) ||
      existsSync(join(root, "bun.lockb")) ||
      existsSync(join(root, "bunfig.toml"))
    ) {
      detectedPackageManagers.push("bun");
    }
    if (existsSync(join(root, "pnpm-lock.yaml")) || existsSync(join(root, "pnpm-workspace.yaml"))) {
      detectedPackageManagers.push("pnpm");
    }
    if (existsSync(join(root, "yarn.lock")) || existsSync(join(root, ".yarnrc.yml"))) {
      detectedPackageManagers.push("yarn");
    }
    if (existsSync(join(root, "package-lock.json"))) {
      detectedPackageManagers.push("npm");
    }
    if (existsSync(join(root, "Cargo.toml")) || existsSync(join(root, "Cargo.lock"))) {
      detectedPackageManagers.push("cargo");
    }
    if (existsSync(join(root, "poetry.lock"))) {
      detectedPackageManagers.push("poetry");
    }
    if (existsSync(join(root, "Pipfile")) || existsSync(join(root, "Pipfile.lock"))) {
      detectedPackageManagers.push("pipenv");
    }
    if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "setup.py"))) {
      detectedPackageManagers.push("pip");
    }
    if (existsSync(join(root, "go.mod")) || existsSync(join(root, "go.sum"))) {
      detectedPackageManagers.push("go");
    }

    // Read package.json if present
    let pkgDeps: Record<string, string> = {};
    let pkgDevDeps: Record<string, string> = {};
    let pkgScripts: Record<string, string> = {};
    const pkgJsonPath = join(root, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
        if (raw.dependencies && typeof raw.dependencies === "object") {
          pkgDeps = raw.dependencies as Record<string, string>;
        }
        if (raw.devDependencies && typeof raw.devDependencies === "object") {
          pkgDevDeps = raw.devDependencies as Record<string, string>;
        }
        if (raw.scripts && typeof raw.scripts === "object") {
          pkgScripts = raw.scripts as Record<string, string>;
        }
      } catch {}
    }

    const hasDep = (name: string): boolean => Boolean(pkgDeps[name] || pkgDevDeps[name]);

    // 2. Test Runner Detection
    if (detectedPackageManagers.includes("bun") || pkgScripts["test"]?.includes("bun test")) {
      detectedTestRunners.push("bun test");
    }
    if (
      hasDep("vitest") ||
      existsSync(join(root, "vitest.config.ts")) ||
      existsSync(join(root, "vitest.config.js"))
    ) {
      detectedTestRunners.push("vitest");
    }
    if (
      hasDep("jest") ||
      existsSync(join(root, "jest.config.js")) ||
      existsSync(join(root, "jest.config.ts"))
    ) {
      detectedTestRunners.push("jest");
    }
    if (
      existsSync(join(root, "pytest.ini")) ||
      existsSync(join(root, "tests")) ||
      existsSync(join(root, "test")) ||
      existsSync(join(root, "pyproject.toml"))
    ) {
      if (detectedPackageManagers.some((pm) => ["poetry", "pipenv", "pip"].includes(pm))) {
        detectedTestRunners.push("pytest");
      }
    }
    if (existsSync(join(root, "Cargo.toml"))) {
      detectedTestRunners.push("cargo test");
    }
    if (existsSync(join(root, "go.mod"))) {
      detectedTestRunners.push("go test");
    }

    // 3. Typechecker Detection
    if (existsSync(join(root, "tsconfig.json")) || hasDep("typescript")) {
      detectedTypecheckers.push("tsc");
    }
    if (existsSync(join(root, "pyrightconfig.json"))) {
      detectedTypecheckers.push("pyright");
    }
    if (existsSync(join(root, "mypy.ini")) || existsSync(join(root, ".mypy.ini"))) {
      detectedTypecheckers.push("mypy");
    }
    if (existsSync(join(root, "Cargo.toml"))) {
      detectedTypecheckers.push("cargo check");
    }
    if (existsSync(join(root, "go.mod"))) {
      detectedTypecheckers.push("go vet");
    }

    // 4. Linter Detection
    if (
      hasDep("eslint") ||
      existsSync(join(root, "eslint.config.js")) ||
      existsSync(join(root, "eslint.config.mjs")) ||
      existsSync(join(root, "eslint.config.ts")) ||
      existsSync(join(root, ".eslintrc.json")) ||
      existsSync(join(root, ".eslintrc.js"))
    ) {
      detectedLinters.push("eslint");
    }
    if (
      hasDep("oxlint") ||
      existsSync(join(root, ".oxlintrc.json")) ||
      existsSync(join(root, "oxlint.json"))
    ) {
      detectedLinters.push("oxlint");
    }
    if (
      hasDep("@biomejs/biome") ||
      hasDep("biome") ||
      existsSync(join(root, "biome.json")) ||
      existsSync(join(root, "biome.jsonc"))
    ) {
      detectedLinters.push("biome");
    }
    if (existsSync(join(root, "ruff.toml")) || existsSync(join(root, ".ruff.toml"))) {
      detectedLinters.push("ruff");
    }
    if (existsSync(join(root, "Cargo.toml"))) {
      detectedLinters.push("clippy");
    }
    if (existsSync(join(root, ".golangci.yml")) || existsSync(join(root, ".golangci.yaml"))) {
      detectedLinters.push("golangci-lint");
    }
    if (existsSync(join(root, ".flake8"))) {
      detectedLinters.push("flake8");
    }

    // 5. Formatter Detection
    if (
      hasDep("prettier") ||
      existsSync(join(root, ".prettierrc")) ||
      existsSync(join(root, ".prettierrc.json")) ||
      existsSync(join(root, ".prettierrc.js")) ||
      existsSync(join(root, "prettier.config.js")) ||
      existsSync(join(root, "prettier.config.mjs"))
    ) {
      detectedFormatters.push("prettier");
    }
    if (
      hasDep("@biomejs/biome") ||
      hasDep("biome") ||
      existsSync(join(root, "biome.json")) ||
      existsSync(join(root, "biome.jsonc"))
    ) {
      detectedFormatters.push("biome");
    }
    if (existsSync(join(root, "ruff.toml")) || existsSync(join(root, ".ruff.toml"))) {
      detectedFormatters.push("ruff format");
    }
    if (existsSync(join(root, "rustfmt.toml")) || existsSync(join(root, ".rustfmt.toml"))) {
      detectedFormatters.push("rustfmt");
    }
    if (existsSync(join(root, "go.mod"))) {
      detectedFormatters.push("gofmt");
    }

    let formatCommand: string | undefined;
    if (detectedFormatters.includes("biome")) {
      formatCommand = "biome format --write .";
    } else if (detectedFormatters.includes("prettier")) {
      const pm = discovered.packageManager ?? "npm";
      formatCommand =
        pm === "bun"
          ? "bunx prettier --write ."
          : pm === "pnpm"
            ? "pnpm exec prettier --write ."
            : "npx prettier --write .";
    } else if (detectedFormatters.includes("ruff format")) {
      formatCommand = "ruff format .";
    } else if (detectedFormatters.includes("rustfmt")) {
      formatCommand = "cargo fmt";
    } else if (detectedFormatters.includes("gofmt")) {
      formatCommand = "gofmt -w .";
    }

    const isMonorepo = Boolean(discovered.isMonorepo);
    const isTypeScript = Boolean(discovered.isTypeScript);

    return {
      ecosystem: discovered.ecosystem,
      packageManager: discovered.packageManager,
      testRunner: discovered.testRunner,
      typecheckCommand: discovered.typecheckCommand,
      lintCommand: discovered.lintCommand,
      formatCommand,
      detectedFormatters,
      detectedLinters,
      detectedTypecheckers,
      detectedTestRunners,
      detectedPackageManagers,
      allowedCommands: discovered.allowedCommands,
      forbiddenCommands: discovered.forbiddenCommands,
      isMonorepo,
      isTypeScript,
    };
  }

  public static discoverAndCalibrate(repoRoot: string): GovernanceToolchainDiscoveryResult {
    const root = resolve(repoRoot);
    const toolchain = discoverToolchain(root);
    const analysis = scanRepositoryToolchain(root);
    const details = PolicyDiscoveryEngine.inspect(root);
    const synthesized = synthesizeCalibratedRepoPolicy(root);
    saveRepoPolicy(synthesized, root);

    return {
      repoRoot: root,
      toolchain,
      analysis,
      calibratedPolicy: synthesized,
      details,
    };
  }

  public static auditCoverage(
    repoRoot: string,
    _capsuleRunRoot?: string,
  ): GovernanceCoverageReport {
    const root = resolve(repoRoot);
    const oltDir = join(root, ".olt");
    const policyFile = join(oltDir, "policy.json");
    const backlogFile = join(oltDir, "backlog.jsonl");
    const defectsFile = join(oltDir, "defects.jsonl");
    const sessionFile = join(root, ".session.json");

    const policyPresent = existsSync(policyFile);
    const backlogLedgerPresent = existsSync(backlogFile);
    const defectsLedgerPresent = existsSync(defectsFile);
    const sessionAuthorityPresent = existsSync(sessionFile);

    const policyInspection = inspectRepoPolicy(root);
    const policyValid = policyInspection.status === "valid_custom" && policyPresent;

    let ecosystem = "unknown";
    let hasTestRunner = false;
    let hasTypecheck = false;
    let hasLinter = false;
    let hasFormatter = false;
    let allowedCommandCount = 0;

    if (policyValid) {
      try {
        const policy = loadRepoPolicy(root);
        ecosystem = policy.ecosystem;
        hasTestRunner =
          typeof policy.test_runner.default_command === "string" &&
          policy.test_runner.default_command.trim().length > 0;
        hasTypecheck =
          typeof policy.typecheck_command === "string" &&
          policy.typecheck_command.trim().length > 0;
        hasLinter =
          typeof policy.lint_command === "string" && policy.lint_command.trim().length > 0;
        allowedCommandCount = Array.isArray(policy.allowed_commands)
          ? policy.allowed_commands.length
          : 0;
        const details = PolicyDiscoveryEngine.inspect(root);
        hasFormatter = details.detectedFormatters.length > 0;
      } catch {
        ecosystem = "unknown";
      }
    }

    const readyForMindAuditor =
      policyPresent &&
      policyValid &&
      backlogLedgerPresent &&
      defectsLedgerPresent &&
      sessionAuthorityPresent;

    return {
      repoRoot: root,
      policyPresent,
      policyValid,
      ...(policyInspection.error !== undefined ? { policyError: policyInspection.error } : {}),
      ecosystem,
      hasTestRunner,
      hasTypecheck,
      hasLinter,
      hasFormatter,
      allowedCommandCount,
      sessionAuthorityPresent,
      backlogLedgerPresent,
      defectsLedgerPresent,
      readyForMindAuditor,
    };
  }

  public static scaffoldTailoredPolicy(
    repoRoot: string,
    options?: { overrideEcosystem?: RepoEcosystem },
  ): RepoPolicy {
    const root = resolve(repoRoot);
    const discovery = discoverToolchain(root, options?.overrideEcosystem);

    const policy: RepoPolicy = {
      schema_version: CURRENT_POLICY_SCHEMA_VERSION,
      ecosystem: discovery.ecosystem,
      ...(discovery.packageManager !== undefined
        ? { package_manager: discovery.packageManager }
        : {}),
      skill_home_repo_root: resolveSkillHomeRepo(),
      test_runner: discovery.testRunner,
      ...(discovery.typecheckCommand !== undefined
        ? { typecheck_command: discovery.typecheckCommand }
        : {}),
      ...(discovery.lintCommand !== undefined ? { lint_command: discovery.lintCommand } : {}),
      allowed_commands: discovery.allowedCommands,
      forbidden_commands: discovery.forbiddenCommands,
      read_scope_neighborhood_depth: 2,
      review_protocol: { ...DEFAULT_REVIEW_PROTOCOL_POLICY },
      planning: { ...DEFAULT_PLANNING_POLICY },
      agents: buildDefaultAgents(),
      docker_environment: buildDefaultDocker(),
      hooks: { ...DEFAULT_LIFECYCLE_HOOKS_CONFIG },
    };

    saveRepoPolicy(policy, root);
    return policy;
  }

  public static initializeGovernance(
    options: BootstrapRepoGovernanceOptions,
  ): RepoGovernanceStatus {
    const root = resolve(options.repoRoot);
    const oltDir = join(root, ".olt");
    if (!existsSync(oltDir)) {
      mkdirSync(oltDir, { recursive: true });
    }

    const policyPath = join(oltDir, "policy.json");
    if (!existsSync(policyPath)) {
      PolicyDiscoveryEngine.scaffoldTailoredPolicy(root);
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
}

export function discoverAndCalibrateRepoPolicy(
  repoRoot: string,
): GovernanceToolchainDiscoveryResult {
  return PolicyDiscoveryEngine.discoverAndCalibrate(repoRoot);
}

export function auditRepoGovernanceCoverage(
  repoRoot: string,
  capsuleRunRoot?: string,
): GovernanceCoverageReport {
  return PolicyDiscoveryEngine.auditCoverage(repoRoot, capsuleRunRoot);
}
