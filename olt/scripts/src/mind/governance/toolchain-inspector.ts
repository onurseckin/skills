import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverToolchain } from "../../policy/generator/index.ts";
import type { PackageManager, RepoEcosystem, TestRunnerPolicy } from "../../policy/types/index.ts";

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

function fileExistsInRoot(root: string, filename: string): boolean {
  return existsSync(join(root, filename));
}

function anyFileExists(root: string, filenames: readonly string[]): boolean {
  for (const f of filenames) {
    if (fileExistsInRoot(root, f)) {
      return true;
    }
  }
  return false;
}

function parsePackageJson(root: string): {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
} {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    return { deps: {}, devDeps: {}, scripts: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    const deps =
      typeof raw.dependencies === "object" && raw.dependencies !== null
        ? (raw.dependencies as Record<string, string>)
        : {};
    const devDeps =
      typeof raw.devDependencies === "object" && raw.devDependencies !== null
        ? (raw.devDependencies as Record<string, string>)
        : {};
    const scripts =
      typeof raw.scripts === "object" && raw.scripts !== null
        ? (raw.scripts as Record<string, string>)
        : {};
    return { deps, devDeps, scripts };
  } catch {
    return { deps: {}, devDeps: {}, scripts: {} };
  }
}

export function inspectToolchainDetails(repoRoot: string): DiscoveredToolchainDetails {
  const root = resolve(repoRoot);
  const discovered = discoverToolchain(root);

  const detectedPackageManagers: string[] = [];
  const detectedTestRunners: string[] = [];
  const detectedTypecheckers: string[] = [];
  const detectedLinters: string[] = [];
  const detectedFormatters: string[] = [];

  // 1. Package Managers
  if (anyFileExists(root, ["bun.lock", "bun.lockb", "bunfig.toml"])) {
    detectedPackageManagers.push("bun");
  }
  if (anyFileExists(root, ["pnpm-lock.yaml", "pnpm-workspace.yaml"])) {
    detectedPackageManagers.push("pnpm");
  }
  if (anyFileExists(root, ["yarn.lock", ".yarnrc.yml"])) {
    detectedPackageManagers.push("yarn");
  }
  if (fileExistsInRoot(root, "package-lock.json")) {
    detectedPackageManagers.push("npm");
  }
  if (anyFileExists(root, ["Cargo.toml", "Cargo.lock"])) {
    detectedPackageManagers.push("cargo");
  }
  if (fileExistsInRoot(root, "poetry.lock")) {
    detectedPackageManagers.push("poetry");
  }
  if (anyFileExists(root, ["Pipfile", "Pipfile.lock"])) {
    detectedPackageManagers.push("pipenv");
  }
  if (anyFileExists(root, ["requirements.txt", "setup.py"])) {
    detectedPackageManagers.push("pip");
  }
  if (anyFileExists(root, ["go.mod", "go.sum"])) {
    detectedPackageManagers.push("go");
  }

  const { deps, devDeps, scripts } = parsePackageJson(root);
  const hasDep = (name: string): boolean => {
    return Object.prototype.hasOwnProperty.call(deps, name)
      ? true
      : Object.prototype.hasOwnProperty.call(devDeps, name);
  };

  // 2. Test Runners
  const testScript = scripts["test"];
  const scriptHasBunTest = typeof testScript === "string" && testScript.includes("bun test");
  if (detectedPackageManagers.includes("bun") ? true : scriptHasBunTest) {
    detectedTestRunners.push("bun test");
  }
  if (hasDep("vitest") ? true : anyFileExists(root, ["vitest.config.ts", "vitest.config.js"])) {
    detectedTestRunners.push("vitest");
  }
  if (hasDep("jest") ? true : anyFileExists(root, ["jest.config.js", "jest.config.ts"])) {
    detectedTestRunners.push("jest");
  }
  if (anyFileExists(root, ["pytest.ini", "tests", "test", "pyproject.toml"])) {
    const isPythonPm = detectedPackageManagers.some((pm) => {
      return pm === "poetry" ? true : pm === "pipenv" ? true : pm === "pip";
    });
    if (isPythonPm) {
      detectedTestRunners.push("pytest");
    }
  }
  if (fileExistsInRoot(root, "Cargo.toml")) {
    detectedTestRunners.push("cargo test");
  }
  if (fileExistsInRoot(root, "go.mod")) {
    detectedTestRunners.push("go test");
  }

  // 3. Typecheckers
  if (fileExistsInRoot(root, "tsconfig.json") ? true : hasDep("typescript")) {
    detectedTypecheckers.push("tsc");
  }
  if (fileExistsInRoot(root, "pyrightconfig.json")) {
    detectedTypecheckers.push("pyright");
  }
  if (anyFileExists(root, ["mypy.ini", ".mypy.ini"])) {
    detectedTypecheckers.push("mypy");
  }
  if (fileExistsInRoot(root, "Cargo.toml")) {
    detectedTypecheckers.push("cargo check");
  }
  if (fileExistsInRoot(root, "go.mod")) {
    detectedTypecheckers.push("go vet");
  }

  // 4. Linters
  const hasEslintFile = anyFileExists(root, [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
    ".eslintrc.json",
    ".eslintrc.js",
  ]);
  if (hasDep("eslint") ? true : hasEslintFile) {
    detectedLinters.push("eslint");
  }
  if (hasDep("oxlint") ? true : anyFileExists(root, [".oxlintrc.json", "oxlint.json"])) {
    detectedLinters.push("oxlint");
  }
  const hasBiome = hasDep("@biomejs/biome") ? true : hasDep("biome");
  if (hasBiome ? true : anyFileExists(root, ["biome.json", "biome.jsonc"])) {
    detectedLinters.push("biome");
  }
  if (anyFileExists(root, ["ruff.toml", ".ruff.toml"])) {
    detectedLinters.push("ruff");
  }
  if (fileExistsInRoot(root, "Cargo.toml")) {
    detectedLinters.push("clippy");
  }
  if (anyFileExists(root, [".golangci.yml", ".golangci.yaml"])) {
    detectedLinters.push("golangci-lint");
  }
  if (fileExistsInRoot(root, ".flake8")) {
    detectedLinters.push("flake8");
  }

  // 5. Formatters
  const hasPrettierFile = anyFileExists(root, [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    "prettier.config.js",
    "prettier.config.mjs",
  ]);
  if (hasDep("prettier") ? true : hasPrettierFile) {
    detectedFormatters.push("prettier");
  }
  if (hasBiome ? true : anyFileExists(root, ["biome.json", "biome.jsonc"])) {
    detectedFormatters.push("biome");
  }
  if (anyFileExists(root, ["ruff.toml", ".ruff.toml"])) {
    detectedFormatters.push("ruff format");
  }
  if (anyFileExists(root, ["rustfmt.toml", ".rustfmt.toml"])) {
    detectedFormatters.push("rustfmt");
  }
  if (fileExistsInRoot(root, "go.mod")) {
    detectedFormatters.push("gofmt");
  }

  let formatCommand: string | undefined = undefined;
  if (detectedFormatters.includes("biome")) {
    formatCommand = "biome format --write .";
  } else if (detectedFormatters.includes("prettier")) {
    const pm = discovered.packageManager !== undefined ? discovered.packageManager : "npm";
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
    isMonorepo: Boolean(discovered.isMonorepo),
    isTypeScript: Boolean(discovered.isTypeScript),
  };
}
