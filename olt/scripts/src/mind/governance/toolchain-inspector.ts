import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverToolchain } from "../../policy/generator/index.ts";
import type { PackageManager, RepoEcosystem, TestRunnerPolicy } from "../../policy/types/index.ts";

export type WorkspaceKind =
  | "pnpm"
  | "turborepo"
  | "npm_yarn_bun"
  | "cargo"
  | "go_work"
  | "lerna"
  | "nx";

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
  readonly workspaceKind?: WorkspaceKind | undefined;
  readonly workspaceMembers?: readonly string[] | undefined;
  readonly monorepoRunner?: string | undefined;
}

function hasAny(root: string, files: readonly string[]): boolean {
  return files.some((f) => existsSync(join(root, f)));
}

function parsePackageJson(root: string): {
  raw: Record<string, unknown>;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
} {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return { raw: {}, deps: {}, devDeps: {}, scripts: {} };
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    const deps = (
      typeof raw.dependencies === "object" && raw.dependencies !== null ? raw.dependencies : {}
    ) as Record<string, string>;
    const devDeps = (
      typeof raw.devDependencies === "object" && raw.devDependencies !== null
        ? raw.devDependencies
        : {}
    ) as Record<string, string>;
    const scripts = (
      typeof raw.scripts === "object" && raw.scripts !== null ? raw.scripts : {}
    ) as Record<string, string>;
    return { raw, deps, devDeps, scripts };
  } catch {
    return { raw: {}, deps: {}, devDeps: {}, scripts: {} };
  }
}

function detectWorkspaceTopology(
  root: string,
  rawPkg: Record<string, unknown>,
): {
  isMonorepo: boolean;
  workspaceKind?: WorkspaceKind;
  workspaceMembers?: readonly string[];
  monorepoRunner?: string;
} {
  let workspaceKind: WorkspaceKind | undefined;
  const workspaceMembers: string[] = [];
  let monorepoRunner: string | undefined;

  if (existsSync(join(root, "pnpm-workspace.yaml"))) {
    workspaceKind = "pnpm";
    try {
      const content = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-")) {
          const item = trimmed
            .replace(/^-\s*['"]?/, "")
            .replace(/['"]?$/, "")
            .trim();
          if (item.length > 0) workspaceMembers.push(item);
        }
      }
    } catch {}
  }
  if (existsSync(join(root, "turbo.json"))) {
    monorepoRunner = "turbo";
    workspaceKind = workspaceKind ?? "turborepo";
  }
  if (existsSync(join(root, "nx.json"))) {
    monorepoRunner = "nx";
    workspaceKind = workspaceKind ?? "nx";
  }
  if (existsSync(join(root, "lerna.json"))) {
    monorepoRunner = "lerna";
    workspaceKind = workspaceKind ?? "lerna";
  }
  if (existsSync(join(root, "go.work"))) {
    workspaceKind = "go_work";
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    try {
      if (readFileSync(join(root, "Cargo.toml"), "utf8").includes("[workspace]")) {
        workspaceKind = "cargo";
        monorepoRunner = monorepoRunner ?? "cargo";
      }
    } catch {}
  }
  if (rawPkg["workspaces"] !== undefined) {
    workspaceKind = workspaceKind ?? "npm_yarn_bun";
    const rawWs = rawPkg["workspaces"];
    const list = Array.isArray(rawWs)
      ? rawWs
      : typeof rawWs === "object" &&
          rawWs !== null &&
          Array.isArray((rawWs as { packages?: unknown[] }).packages)
        ? (rawWs as { packages: unknown[] }).packages
        : [];
    for (const w of list) {
      if (typeof w === "string") workspaceMembers.push(w);
    }
  }

  return {
    isMonorepo: workspaceKind !== undefined,
    ...(workspaceKind ? { workspaceKind } : {}),
    ...(workspaceMembers.length > 0 ? { workspaceMembers } : {}),
    ...(monorepoRunner ? { monorepoRunner } : {}),
  };
}

function collectWorkspaceMemberDirs(root: string, members?: readonly string[]): string[] {
  const dirs: string[] = [];
  const candidateParents = ["packages", "apps", "libs", "crates", "modules"];
  for (const parent of candidateParents) {
    const parentPath = join(root, parent);
    if (existsSync(parentPath)) {
      try {
        const entries = readdirSync(parentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirs.push(join(parentPath, entry.name));
            if (dirs.length >= 8) break;
          }
        }
      } catch {}
    }
  }

  if (members && members.length > 0 && dirs.length === 0) {
    for (const mem of members) {
      const clean = mem.replace(/\/\*.*$/, "");
      const full = join(root, clean);
      if (existsSync(full)) {
        try {
          const entries = readdirSync(full, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              dirs.push(join(full, entry.name));
              if (dirs.length >= 8) break;
            }
          }
        } catch {
          dirs.push(full);
        }
      }
    }
  }
  return dirs.slice(0, 8);
}

export function inspectToolchainDetails(repoRoot: string): DiscoveredToolchainDetails {
  const root = resolve(repoRoot);
  const discovered = discoverToolchain(root);
  const { raw, deps, devDeps, scripts } = parsePackageJson(root);
  const hasDep = (name: string): boolean => name in deps || name in devDeps;

  // 1. Package Managers
  const pmRules: Array<[string[], string]> = [
    [["bun.lock", "bun.lockb", "bunfig.toml"], "bun"],
    [["pnpm-lock.yaml", "pnpm-workspace.yaml"], "pnpm"],
    [["yarn.lock", ".yarnrc.yml"], "yarn"],
    [["package-lock.json"], "npm"],
    [["Cargo.toml", "Cargo.lock"], "cargo"],
    [["poetry.lock"], "poetry"],
    [["Pipfile", "Pipfile.lock"], "pipenv"],
    [["requirements.txt", "setup.py"], "pip"],
    [["go.mod", "go.sum"], "go"],
  ];
  const detectedPackageManagers = pmRules
    .filter(([files]) => hasAny(root, files))
    .map(([, name]) => name);

  // 2. Test Runners
  const detectedTestRunners: string[] = [];
  const testScript = scripts["test"];
  if (
    detectedPackageManagers.includes("bun") ||
    (typeof testScript === "string" && testScript.includes("bun test"))
  ) {
    detectedTestRunners.push("bun test");
  }
  if (hasDep("vitest") || hasAny(root, ["vitest.config.ts", "vitest.config.js"]))
    detectedTestRunners.push("vitest");
  if (hasDep("jest") || hasAny(root, ["jest.config.js", "jest.config.ts"]))
    detectedTestRunners.push("jest");
  if (hasAny(root, ["pytest.ini", "tests", "test", "pyproject.toml"])) {
    if (detectedPackageManagers.some((pm) => ["poetry", "pipenv", "pip"].includes(pm)))
      detectedTestRunners.push("pytest");
  }
  if (existsSync(join(root, "Cargo.toml"))) detectedTestRunners.push("cargo test");
  if (existsSync(join(root, "go.mod"))) detectedTestRunners.push("go test");

  // 3. Typecheckers
  const detectedTypecheckers: string[] = [];
  if (existsSync(join(root, "tsconfig.json")) || hasDep("typescript"))
    detectedTypecheckers.push("tsc");
  if (existsSync(join(root, "pyrightconfig.json"))) detectedTypecheckers.push("pyright");
  if (hasAny(root, ["mypy.ini", ".mypy.ini"])) detectedTypecheckers.push("mypy");
  if (existsSync(join(root, "Cargo.toml"))) detectedTypecheckers.push("cargo check");
  if (existsSync(join(root, "go.mod"))) detectedTypecheckers.push("go vet");

  // 4. Linters
  const detectedLinters: string[] = [];
  const eslintFiles = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
    ".eslintrc.json",
    ".eslintrc.js",
  ];
  if (hasDep("eslint") || hasAny(root, eslintFiles)) detectedLinters.push("eslint");
  if (hasDep("oxlint") || hasAny(root, [".oxlintrc.json", "oxlint.json"]))
    detectedLinters.push("oxlint");
  const hasBiome =
    hasDep("@biomejs/biome") || hasDep("biome") || hasAny(root, ["biome.json", "biome.jsonc"]);
  if (hasBiome) detectedLinters.push("biome");
  if (hasAny(root, ["ruff.toml", ".ruff.toml"])) detectedLinters.push("ruff");
  if (existsSync(join(root, "Cargo.toml"))) detectedLinters.push("clippy");
  if (hasAny(root, [".golangci.yml", ".golangci.yaml"])) detectedLinters.push("golangci-lint");
  if (existsSync(join(root, ".flake8"))) detectedLinters.push("flake8");

  // 5. Formatters
  const detectedFormatters: string[] = [];
  const prettierFiles = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    "prettier.config.js",
    "prettier.config.mjs",
  ];
  if (hasDep("prettier") || hasAny(root, prettierFiles)) detectedFormatters.push("prettier");
  if (hasBiome) detectedFormatters.push("biome");
  if (hasAny(root, ["ruff.toml", ".ruff.toml"])) detectedFormatters.push("ruff format");
  if (hasAny(root, ["rustfmt.toml", ".rustfmt.toml"])) detectedFormatters.push("rustfmt");
  if (existsSync(join(root, "go.mod"))) detectedFormatters.push("gofmt");

  const topology = detectWorkspaceTopology(root, raw);

  // 6. Monorepo nested member inspection and runner preferences
  if (topology.isMonorepo) {
    if (topology.monorepoRunner === "turbo" && !detectedTestRunners.includes("turbo test")) {
      detectedTestRunners.push("turbo test");
    }
    if (
      topology.workspaceKind === "cargo" &&
      !detectedTestRunners.includes("cargo test --workspace")
    ) {
      detectedTestRunners.push("cargo test --workspace");
    }

    const memberDirs = collectWorkspaceMemberDirs(root, topology.workspaceMembers);
    for (const subDir of memberDirs) {
      const subPkg = parsePackageJson(subDir);
      const hasSubDep = (name: string): boolean => name in subPkg.deps || name in subPkg.devDeps;

      if (
        (hasSubDep("vitest") || hasAny(subDir, ["vitest.config.ts", "vitest.config.js"])) &&
        !detectedTestRunners.includes("vitest")
      ) {
        detectedTestRunners.push("vitest");
      }
      if (
        (hasSubDep("jest") || hasAny(subDir, ["jest.config.js", "jest.config.ts"])) &&
        !detectedTestRunners.includes("jest")
      ) {
        detectedTestRunners.push("jest");
      }
      if (
        (existsSync(join(subDir, "tsconfig.json")) || hasSubDep("typescript")) &&
        !detectedTypecheckers.includes("tsc")
      ) {
        detectedTypecheckers.push("tsc");
      }
      if (
        (hasSubDep("eslint") || hasAny(subDir, ["eslint.config.js", ".eslintrc.json"])) &&
        !detectedLinters.includes("eslint")
      ) {
        detectedLinters.push("eslint");
      }
      if (
        (hasSubDep("oxlint") || hasAny(subDir, [".oxlintrc.json", "oxlint.json"])) &&
        !detectedLinters.includes("oxlint")
      ) {
        detectedLinters.push("oxlint");
      }
      if (
        (hasSubDep("prettier") || hasAny(subDir, [".prettierrc", ".prettierrc.json"])) &&
        !detectedFormatters.includes("prettier")
      ) {
        detectedFormatters.push("prettier");
      }
      if (hasSubDep("@biomejs/biome") || hasSubDep("biome") || hasAny(subDir, ["biome.json"])) {
        if (!detectedLinters.includes("biome")) detectedLinters.push("biome");
        if (!detectedFormatters.includes("biome")) detectedFormatters.push("biome");
      }
    }
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
    isMonorepo: topology.isMonorepo || Boolean(discovered.isMonorepo),
    isTypeScript: Boolean(discovered.isTypeScript) || detectedTypecheckers.includes("tsc"),
    ...(topology.workspaceKind ? { workspaceKind: topology.workspaceKind } : {}),
    ...(topology.workspaceMembers ? { workspaceMembers: topology.workspaceMembers } : {}),
    ...(topology.monorepoRunner ? { monorepoRunner: topology.monorepoRunner } : {}),
  };
}
