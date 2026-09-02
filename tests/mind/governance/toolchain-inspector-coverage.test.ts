import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectToolchainDetails } from "../../../olt/scripts/src/mind/governance/toolchain-inspector.ts";

describe("Toolchain Inspector Suite (toolchain-inspector.ts)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `toolchain-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("Package.json parsing and edge cases", () => {
    it("handles missing, corrupted, or non-object package.json", () => {
      const emptyRes = inspectToolchainDetails(testDir);
      expect(emptyRes.detectedPackageManagers).toEqual([]);
      expect(emptyRes.isMonorepo).toBe(false);

      writeFileSync(join(testDir, "package.json"), "invalid { json");
      const badJsonRes = inspectToolchainDetails(testDir);
      expect(badJsonRes.detectedLinters).toEqual([]);

      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: "string-not-object",
          devDependencies: null,
          scripts: 12345,
          workspaces: null,
        }),
      );
      const invalidTypesRes = inspectToolchainDetails(testDir);
      expect(invalidTypesRes.detectedPackageManagers).toEqual([]);
    });

    it("parses valid dependencies, devDependencies, and test scripts", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { vitest: "^1.0.0", eslint: "^8.0.0" },
          devDependencies: { typescript: "^5.0.0", prettier: "^3.0.0" },
          scripts: { test: "bun test --coverage" },
        }),
      );

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedTestRunners).toContain("bun test");
      expect(res.detectedTestRunners).toContain("vitest");
      expect(res.detectedTypecheckers).toContain("tsc");
      expect(res.detectedLinters).toContain("eslint");
      expect(res.detectedFormatters).toContain("prettier");
      expect(res.isTypeScript).toBe(true);
    });
  });

  describe("Workspace topologies & monorepo runners", () => {
    it("detects pnpm workspace with yaml member list", () => {
      writeFileSync(
        join(testDir, "pnpm-workspace.yaml"),
        "packages:\n  - 'packages/*'\n  - \"apps/web\"\n  - \n",
      );
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");

      const res = inspectToolchainDetails(testDir);
      expect(res.isMonorepo).toBe(true);
      expect(res.workspaceKind).toBe("pnpm");
      expect(res.workspaceMembers).toEqual(["packages/*", "apps/web"]);
      expect(res.detectedPackageManagers).toContain("pnpm");
    });

    it("detects turbo and cargo workspace runners", () => {
      const turboDir = join(testDir, "turbo-repo");
      mkdirSync(turboDir, { recursive: true });
      writeFileSync(join(turboDir, "turbo.json"), "{}");
      const turboRes = inspectToolchainDetails(turboDir);
      expect(turboRes.isMonorepo).toBe(true);
      expect(turboRes.monorepoRunner).toBe("turbo");
      expect(turboRes.detectedTestRunners).toContain("turbo test");

      const cargoDir = join(testDir, "cargo-repo");
      mkdirSync(cargoDir, { recursive: true });
      writeFileSync(join(cargoDir, "Cargo.toml"), "[workspace]\nmembers = ['crates/*']");
      const cargoRes = inspectToolchainDetails(cargoDir);
      expect(cargoRes.isMonorepo).toBe(true);
      expect(cargoRes.monorepoRunner).toBe("cargo");
      expect(cargoRes.detectedTestRunners).toContain("cargo test --workspace");
    });

    it("detects nx, lerna, and go.work topologies", () => {
      const nxDir = join(testDir, "nx-repo");
      mkdirSync(nxDir, { recursive: true });
      writeFileSync(join(nxDir, "nx.json"), "{}");
      expect(inspectToolchainDetails(nxDir).workspaceKind).toBe("nx");

      const lernaDir = join(testDir, "lerna-repo");
      mkdirSync(lernaDir, { recursive: true });
      writeFileSync(join(lernaDir, "lerna.json"), "{}");
      expect(inspectToolchainDetails(lernaDir).workspaceKind).toBe("lerna");

      const goDir = join(testDir, "go-repo");
      mkdirSync(goDir, { recursive: true });
      writeFileSync(join(goDir, "go.work"), "go 1.22");
      expect(inspectToolchainDetails(goDir).workspaceKind).toBe("go_work");
    });

    it("detects workspaces specified in package.json as array or object", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ workspaces: ["packages/*", "tools/*"] }),
      );
      const resArr = inspectToolchainDetails(testDir);
      expect(resArr.isMonorepo).toBe(true);
      expect(resArr.workspaceKind).toBe("npm_yarn_bun");
      expect(resArr.workspaceMembers).toEqual(["packages/*", "tools/*"]);

      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ workspaces: { packages: ["libs/*"] } }),
      );
      const resObj = inspectToolchainDetails(testDir);
      expect(resObj.isMonorepo).toBe(true);
      expect(resObj.workspaceMembers).toEqual(["libs/*"]);
    });
  });

  describe("Ecosystem detection & Formatter command derivation", () => {
    it("detects Bun package manager, lockfile, and bunx prettier command", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "bun-app" }));
      writeFileSync(join(testDir, "bun.lockb"), "");
      writeFileSync(join(testDir, ".prettierrc"), "{}");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("bun");
      expect(res.detectedFormatters).toContain("prettier");
      expect(res.formatCommand).toBe("bunx prettier --write .");
    });

    it("detects PNPM and pnpm exec prettier command", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "pnpm-app" }));
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
      writeFileSync(join(testDir, "prettier.config.js"), "module.exports = {}");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("pnpm");
      expect(res.formatCommand).toBe("pnpm exec prettier --write .");
    });

    it("detects NPM and npx prettier command fallback", () => {
      writeFileSync(join(testDir, "package-lock.json"), "{}");
      writeFileSync(join(testDir, ".prettierrc.json"), "{}");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("npm");
      expect(res.formatCommand).toBe("npx prettier --write .");
    });

    it("detects Biome linter/formatter with precedence over Prettier", () => {
      writeFileSync(join(testDir, "biome.json"), "{}");
      writeFileSync(join(testDir, ".prettierrc"), "{}");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedLinters).toContain("biome");
      expect(res.detectedFormatters).toContain("biome");
      expect(res.formatCommand).toBe("biome format --write .");
    });

    it("detects Rust toolchain, clippy, rustfmt, and cargo fmt command", () => {
      writeFileSync(join(testDir, "Cargo.toml"), "[package]\nname = 'test-rs'");
      writeFileSync(join(testDir, "rustfmt.toml"), "");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("cargo");
      expect(res.detectedTestRunners).toContain("cargo test");
      expect(res.detectedTypecheckers).toContain("cargo check");
      expect(res.detectedLinters).toContain("clippy");
      expect(res.detectedFormatters).toContain("rustfmt");
      expect(res.formatCommand).toBe("cargo fmt");
    });

    it("detects Go toolchain, vet, golangci-lint, gofmt, and gofmt -w . command", () => {
      writeFileSync(join(testDir, "go.mod"), "module example.com/app\n\ngo 1.22\n");
      writeFileSync(join(testDir, ".golangci.yml"), "version: 2\n");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("go");
      expect(res.detectedTestRunners).toContain("go test");
      expect(res.detectedTypecheckers).toContain("go vet");
      expect(res.detectedLinters).toContain("golangci-lint");
      expect(res.detectedFormatters).toContain("gofmt");
      expect(res.formatCommand).toBe("gofmt -w .");
    });

    it("detects Python toolchain with poetry, pipenv, pip, pytest, pyright, mypy, ruff, flake8", () => {
      writeFileSync(join(testDir, "poetry.lock"), "");
      writeFileSync(join(testDir, "pytest.ini"), "[pytest]\n");
      writeFileSync(join(testDir, "pyrightconfig.json"), "{}");
      writeFileSync(join(testDir, "mypy.ini"), "[mypy]\n");
      writeFileSync(join(testDir, "ruff.toml"), "");
      writeFileSync(join(testDir, ".flake8"), "[flake8]\n");

      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("poetry");
      expect(res.detectedTestRunners).toContain("pytest");
      expect(res.detectedTypecheckers).toContain("pyright");
      expect(res.detectedTypecheckers).toContain("mypy");
      expect(res.detectedLinters).toContain("ruff");
      expect(res.detectedLinters).toContain("flake8");
      expect(res.detectedFormatters).toContain("ruff format");
      expect(res.formatCommand).toBe("ruff format .");
    });

    it("detects Pipfile for pipenv and yarn lockfile", () => {
      writeFileSync(join(testDir, "Pipfile"), "");
      writeFileSync(join(testDir, "yarn.lock"), "");
      const res = inspectToolchainDetails(testDir);
      expect(res.detectedPackageManagers).toContain("pipenv");
      expect(res.detectedPackageManagers).toContain("yarn");
    });
  });

  describe("Monorepo nested member inspection & tool discovery", () => {
    it("scans tools across candidate parent dirs (packages, apps, modules)", () => {
      writeFileSync(join(testDir, "turbo.json"), "{}");
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "root" }));

      const pkgCore = join(testDir, "packages", "core");
      mkdirSync(pkgCore, { recursive: true });
      writeFileSync(
        join(pkgCore, "package.json"),
        JSON.stringify({
          name: "@repo/core",
          dependencies: { vitest: "^1.0.0", oxlint: "^0.2.0" },
          devDependencies: { typescript: "^5.0.0", prettier: "^3.0.0" },
        }),
      );

      const appWeb = join(testDir, "apps", "web");
      mkdirSync(appWeb, { recursive: true });
      writeFileSync(
        join(appWeb, "package.json"),
        JSON.stringify({
          name: "@repo/web",
          dependencies: { jest: "^29.0.0", "@biomejs/biome": "^1.0.0" },
          devDependencies: { eslint: "^8.0.0" },
        }),
      );

      const res = inspectToolchainDetails(testDir);
      expect(res.isMonorepo).toBe(true);
      expect(res.detectedTestRunners).toContain("vitest");
      expect(res.detectedTestRunners).toContain("jest");
      expect(res.detectedTypecheckers).toContain("tsc");
      expect(res.detectedLinters).toContain("oxlint");
      expect(res.detectedLinters).toContain("eslint");
      expect(res.detectedLinters).toContain("biome");
      expect(res.detectedFormatters).toContain("prettier");
      expect(res.detectedFormatters).toContain("biome");
    });

    it("collects member dirs from explicit workspaceMembers when candidate parents absent", () => {
      writeFileSync(join(testDir, "pnpm-workspace.yaml"), "packages:\n  - 'custom_modules/*'\n");
      const modDir = join(testDir, "custom_modules", "alpha");
      mkdirSync(modDir, { recursive: true });
      writeFileSync(
        join(modDir, "package.json"),
        JSON.stringify({
          name: "alpha",
          dependencies: { jest: "^29.0.0" },
        }),
      );

      const res = inspectToolchainDetails(testDir);
      expect(res.isMonorepo).toBe(true);
      expect(res.detectedTestRunners).toContain("jest");
    });
  });
});
