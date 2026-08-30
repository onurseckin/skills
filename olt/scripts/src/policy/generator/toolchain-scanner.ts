import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot, resolveSkillHomeRepo } from "../../core/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type PackageManager,
  type RepoEcosystem,
  type RepoPolicy,
} from "../types/index.ts";
import { buildDefaultAgents } from "./default-agents.ts";
import { buildDefaultDocker } from "./default-docker.ts";
import {
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  DEFAULT_LIFECYCLE_HOOKS_CONFIG,
} from "./index.ts";
import type { ToolchainAnalysis } from "./toolchain-types.ts";
import { getCargoPresets, getPythonPresets, getUnknownPresets } from "./toolchain-presets.ts";

export type { ToolchainAnalysis } from "./toolchain-types.ts";

export function scanRepositoryToolchain(repoRoot?: string): ToolchainAnalysis {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();

  const pkgJsonPath = join(root, "package.json");
  const hasPkgJson = existsSync(pkgJsonPath);
  const hasBunLock = existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"));
  const hasPnpmLock = existsSync(join(root, "pnpm-lock.yaml"));
  const hasYarnLock = existsSync(join(root, "yarn.lock"));
  const hasNpmLock = existsSync(join(root, "package-lock.json"));
  const hasTurbo = existsSync(join(root, "turbo.json"));
  const hasNx = existsSync(join(root, "nx.json"));
  const hasTsConfig = existsSync(join(root, "tsconfig.json"));

  const hasCargo = existsSync(join(root, "Cargo.toml"));
  const hasPyproject = existsSync(join(root, "pyproject.toml"));
  const hasRequirements = existsSync(join(root, "requirements.txt"));
  const hasPipfile = existsSync(join(root, "Pipfile"));
  const hasSetupPy = existsSync(join(root, "setup.py"));

  if (hasCargo && !hasPkgJson) return getCargoPresets();
  if ((hasPyproject || hasRequirements || hasPipfile || hasSetupPy) && !hasPkgJson)
    return getPythonPresets();

  if (hasPkgJson) {
    let pkgJson: Record<string, unknown> = {};
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    } catch {}

    const scripts = (pkgJson.scripts ?? {}) as Record<string, string>;

    let pm: PackageManager = "npm";
    let eco: RepoEcosystem = "node";

    if (hasBunLock || existsSync(join(root, "bunfig.toml"))) {
      pm = "bun";
      eco = "bun";
    } else if (hasPnpmLock) {
      pm = "pnpm";
      eco = "node";
    } else if (hasYarnLock) {
      pm = "yarn";
      eco = "node";
    } else if (hasNpmLock) {
      pm = "npm";
      eco = "node";
    }

    const testCmd = scripts.test
      ? `${pm} test`
      : scripts["test:unit"]
        ? `${pm} run test:unit`
        : `${pm} test`;
    const targetedPattern = pm === "bun" ? "bun test <path>" : `${pm} test -- <path>`;
    const fullSuiteCmd = scripts["test:all"]
      ? pm === "bun"
        ? "bun test:all"
        : `${pm} run test:all`
      : testCmd;
    const typecheckCmd = scripts.typecheck
      ? pm === "bun"
        ? "bun typecheck"
        : `${pm} run typecheck`
      : scripts["check-types"]
        ? `${pm} run check-types`
        : hasTsConfig
          ? "tsc --noEmit"
          : undefined;
    const lintCmd = scripts.lint
      ? pm === "bun"
        ? "bun lint"
        : `${pm} run lint`
      : scripts["check-lint"]
        ? `${pm} run check-lint`
        : undefined;
    const buildCmd = scripts.build ? `${pm} run build` : undefined;

    const allowed = [
      pm === "bun" ? "bun test" : `${pm} test`,
      `${pm} run`,
      "git status",
      "git diff",
      "git log",
      "ls",
      "find",
      "grep",
      "cat",
      "wc",
    ];
    if (typecheckCmd) allowed.push(typecheckCmd);
    if (lintCmd) allowed.push(lintCmd);
    if (hasTsConfig) allowed.push("tsc");
    if (hasTurbo) allowed.push("turbo", "turbo run", `${pm} run test`);
    if (hasNx) allowed.push("nx");

    let monorepoTool: ToolchainAnalysis["monorepoTool"];
    if (hasTurbo) monorepoTool = "turbo";
    else if (hasNx) monorepoTool = "nx";
    else if (Array.isArray(pkgJson.workspaces))
      monorepoTool = pm === "pnpm" ? "pnpm-workspaces" : "npm-workspaces";

    return {
      ecosystem: eco,
      packageManager: pm,
      testRunner: {
        default_command: testCmd,
        targeted_pattern: targetedPattern,
        full_suite_command: fullSuiteCmd,
        timeout_ms: 30000,
      },
      typecheckCommand: typecheckCmd,
      lintCommand: lintCmd,
      buildCommand: buildCmd,
      allowedCommands: Array.from(new Set(allowed)),
      forbiddenCommands: ["git commit", "git push", "git reset", "rm -rf /"],
      isMonorepo: Boolean(monorepoTool),
      monorepoTool,
    };
  }

  return getUnknownPresets();
}

export function synthesizeCalibratedRepoPolicy(repoRoot?: string): RepoPolicy {
  const analysis = scanRepositoryToolchain(repoRoot);
  const homeRepo = resolveSkillHomeRepo();

  return {
    schema_version: CURRENT_POLICY_SCHEMA_VERSION,
    ecosystem: analysis.ecosystem,
    package_manager: analysis.packageManager,
    skill_home_repo_root: homeRepo,
    test_runner: analysis.testRunner,
    typecheck_command: analysis.typecheckCommand,
    lint_command: analysis.lintCommand,
    allowed_commands: analysis.allowedCommands,
    forbidden_commands: analysis.forbiddenCommands,
    read_scope_neighborhood_depth: 2,
    review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
    planning: DEFAULT_PLANNING_POLICY,
    agents: buildDefaultAgents(),
    docker_environment: buildDefaultDocker(),
    hooks: DEFAULT_LIFECYCLE_HOOKS_CONFIG,
  };
}
