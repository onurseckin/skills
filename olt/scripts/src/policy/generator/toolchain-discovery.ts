import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "../../core/shared/paths.ts";
import type { PackageManager, RepoEcosystem, TestRunnerPolicy } from "../types/index.ts";
import { buildAllowedCommands } from "./command-builder.ts";
import { detectRepoEcosystem } from "./ecosystem-detect.ts";
import {
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
  type ParsedMakefile,
  type ParsedPackageJson,
  type ParsedPythonManifest,
  type ParsedTurboJson,
} from "./manifest-readers.ts";

export { buildAllowedCommands, type AllowedCommandsContext } from "./command-builder.ts";
export {
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
  type ParsedMakefile,
  type ParsedPackageJson,
  type ParsedPythonManifest,
  type ParsedTurboJson,
} from "./manifest-readers.ts";

export interface DiscoveredToolchain {
  readonly ecosystem: RepoEcosystem;
  readonly packageManager?: PackageManager | undefined;
  readonly typecheckCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly testRunner: TestRunnerPolicy;
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
  readonly isMonorepo?: boolean | undefined;
  readonly isTypeScript?: boolean | undefined;
}

interface ManifestBundle {
  readonly root: string;
  readonly pkg: ParsedPackageJson;
  readonly turbo: ParsedTurboJson;
  readonly py: ParsedPythonManifest;
  readonly make: ParsedMakefile;
  readonly isTs: boolean;
  readonly isMonorepo: boolean;
  readonly hasOxlint: boolean;
  readonly hasBiome: boolean;
  readonly hasEslint: boolean;
  readonly hasVitest: boolean;
  readonly hasJest: boolean;
}

function gatherManifestBundle(root: string): ManifestBundle {
  const pkg = readPackageJson(root);
  const turbo = readTurboJson(root);
  const py = readPythonManifests(root);
  const make = readMakefile(root);

  const isTs = existsSync(join(root, "tsconfig.json")) || pkg.hasDep("typescript");
  const isMonorepo = turbo.exists || pkg.hasDep("turbo") || pkg.hasScript("turbo");
  const hasOxlint =
    pkg.hasDep("oxlint") ||
    existsSync(join(root, ".oxlintrc.json")) ||
    existsSync(join(root, "oxlint.json"));
  const hasBiome =
    pkg.hasDep("@biomejs/biome") ||
    pkg.hasDep("biome") ||
    existsSync(join(root, "biome.json")) ||
    existsSync(join(root, "biome.jsonc"));
  const hasEslint =
    pkg.hasDep("eslint") ||
    existsSync(join(root, ".eslintrc.json")) ||
    existsSync(join(root, ".eslintrc.js")) ||
    existsSync(join(root, "eslint.config.js")) ||
    existsSync(join(root, "eslint.config.mjs")) ||
    existsSync(join(root, "eslint.config.ts"));
  const hasVitest =
    pkg.hasDep("vitest") ||
    existsSync(join(root, "vitest.config.ts")) ||
    existsSync(join(root, "vitest.config.js"));
  const hasJest =
    pkg.hasDep("jest") ||
    existsSync(join(root, "jest.config.js")) ||
    existsSync(join(root, "jest.config.ts"));

  return {
    root,
    pkg,
    turbo,
    py,
    make,
    isTs,
    isMonorepo,
    hasOxlint,
    hasBiome,
    hasEslint,
    hasVitest,
    hasJest,
  };
}

function resolvePm(eco: RepoEcosystem, bundle: ManifestBundle): PackageManager | undefined {
  if (eco === "bun") return "bun";
  if (eco === "cargo") return "cargo";
  if (eco === "python") {
    if (
      existsSync(join(bundle.root, "poetry.lock")) ||
      (bundle.py.hasPyproject && bundle.py.usesPoetry && !bundle.py.hasPipfile)
    ) {
      return "poetry";
    }
    if (existsSync(join(bundle.root, "Pipfile"))) {
      return "pipenv";
    }
    return "pip";
  }
  if (eco === "node") {
    if (
      existsSync(join(bundle.root, "pnpm-lock.yaml")) ||
      bundle.pkg.packageManager?.startsWith("pnpm")
    ) {
      return "pnpm";
    }
    if (
      existsSync(join(bundle.root, "yarn.lock")) ||
      bundle.pkg.packageManager?.startsWith("yarn")
    ) {
      return "yarn";
    }
    return "npm";
  }
  return undefined;
}

function resolveTypecheckCmd(
  eco: RepoEcosystem,
  pm: PackageManager | undefined,
  b: ManifestBundle,
): string | undefined {
  if (eco === "bun") {
    if (b.isMonorepo && b.turbo.hasTask("typecheck")) return "turbo run typecheck";
    if (b.pkg.hasScript("typecheck")) return "bun run typecheck";
    if (b.pkg.hasScript("check-types")) return "bun run check-types";
    if (b.pkg.hasScript("type-check")) return "bun run type-check";
    return "bun run typecheck";
  }
  if (eco === "node") {
    const p = pm ?? "npm";
    const runPrefix = p === "npm" ? "npm run" : p === "pnpm" ? "pnpm run" : "yarn";
    if (b.isMonorepo && b.turbo.hasTask("typecheck")) return "turbo run typecheck";
    if (b.pkg.hasScript("typecheck")) return `${runPrefix} typecheck`;
    if (b.pkg.hasScript("check-types")) return `${runPrefix} check-types`;
    if (b.pkg.hasScript("type-check")) return `${runPrefix} type-check`;
    if (b.isTs) {
      if (p === "npm") return "npx tsc --noEmit";
      if (p === "pnpm") return "pnpm exec tsc --noEmit";
      return "yarn tsc --noEmit";
    }
    return `${p} run typecheck`;
  }
  if (eco === "cargo") return "cargo check";
  if (eco === "python") return "mypy";
  if (b.make.hasTarget("typecheck")) return "make typecheck";
  if (b.make.hasTarget("check")) return "make check";
  return undefined;
}

function resolveLintCmd(
  eco: RepoEcosystem,
  pm: PackageManager | undefined,
  b: ManifestBundle,
): string | undefined {
  if (eco === "bun") {
    if (b.isMonorepo && b.turbo.hasTask("lint")) return "turbo run lint";
    if (b.pkg.hasScript("lint")) return "bun run lint";
    if (b.hasOxlint) return "oxlint";
    if (b.hasBiome) return "biome check";
    if (b.hasEslint) return "eslint .";
    return "bun run lint";
  }
  if (eco === "node") {
    const p = pm ?? "npm";
    const runPrefix = p === "npm" ? "npm run" : p === "pnpm" ? "pnpm run" : "yarn";
    if (b.isMonorepo && b.turbo.hasTask("lint")) return "turbo run lint";
    if (b.pkg.hasScript("lint")) return `${runPrefix} lint`;
    if (b.hasOxlint) return "oxlint";
    if (b.hasBiome) return "biome check";
    if (b.hasEslint) return "eslint .";
    return `${p} run lint`;
  }
  if (eco === "cargo") return "cargo clippy";
  if (eco === "python") return b.py.usesFlake8 && !b.py.usesRuff ? "flake8" : "ruff check";
  if (b.make.hasTarget("lint")) return "make lint";
  return undefined;
}

function resolveTestRunner(
  eco: RepoEcosystem,
  pm: PackageManager | undefined,
  b: ManifestBundle,
): TestRunnerPolicy {
  if (eco === "bun") {
    const full = b.isMonorepo && b.turbo.hasTask("test") ? "turbo run test" : "bun test";
    return {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: full,
      timeout_ms: 30000,
    };
  }
  if (eco === "cargo") {
    return {
      default_command: "cargo test",
      targeted_pattern: "cargo test -- <path>",
      full_suite_command: "cargo test",
      timeout_ms: 30000,
    };
  }
  if (eco === "python") {
    return {
      default_command: "pytest",
      targeted_pattern: "pytest <path>",
      full_suite_command: "pytest",
      timeout_ms: 30000,
    };
  }
  if (eco === "node") {
    const p = pm ?? "npm";
    const runner = p === "npm" ? "npm test --" : p === "pnpm" ? "pnpm test" : "yarn test";
    const full = b.isMonorepo && b.turbo.hasTask("test") ? "turbo run test" : `${p} test`;
    return {
      default_command: `${p} test`,
      targeted_pattern: `${runner} <path>`,
      full_suite_command: full,
      timeout_ms: 30000,
    };
  }
  if (b.make.hasTarget("test")) {
    return {
      default_command: "make test",
      targeted_pattern: "make test",
      full_suite_command: "make test",
      timeout_ms: 30000,
    };
  }
  return {
    default_command: "test",
    targeted_pattern: "test <path>",
    full_suite_command: "test",
    timeout_ms: 30000,
  };
}

export function discoverToolchain(
  repoRoot?: string,
  overrideEcosystem?: RepoEcosystem,
): DiscoveredToolchain {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const eco = overrideEcosystem ?? detectRepoEcosystem(root);
  const bundle = gatherManifestBundle(root);
  const pm = resolvePm(eco, bundle);
  const typecheckCmd = resolveTypecheckCmd(eco, pm, bundle);
  const lintCmd = resolveLintCmd(eco, pm, bundle);
  const testRunner = resolveTestRunner(eco, pm, bundle);
  const allowedCommands = buildAllowedCommands({
    ecosystem: eco,
    packageManager: pm,
    isMonorepo: bundle.isMonorepo,
    isTs: bundle.isTs,
    hasOxlint: bundle.hasOxlint,
    hasBiome: bundle.hasBiome,
    hasEslint: bundle.hasEslint,
    hasVitest: bundle.hasVitest,
    hasJest: bundle.hasJest,
    py: bundle.py,
    make: bundle.make,
    turboExists: bundle.turbo.exists,
  });
  const forbiddenCommands = ["git commit", "git push", "git reset", "rm -rf /"];

  return {
    ecosystem: eco,
    packageManager: pm,
    typecheckCommand: typecheckCmd,
    lintCommand: lintCmd,
    testRunner,
    allowedCommands,
    forbiddenCommands,
    isMonorepo: bundle.isMonorepo,
    isTypeScript: bundle.isTs,
  };
}
