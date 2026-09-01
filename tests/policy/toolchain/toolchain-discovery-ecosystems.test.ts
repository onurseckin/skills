import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  discoverToolchain,
  generateDefaultRepoPolicy,
  parseRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Toolchain Discovery - Ecosystems (Bun, Node, Cargo, Python, Make)", () => {
  const scratch = "/virtual/policy/toolchain/discovery-ecosystems";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("discovers bun toolchain with typescript and custom scripts", () => {
    const dir = join(scratch, "bun-toolchain");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "bun test",
        },
        devDependencies: {
          typescript: "^5.0.0",
          eslint: "^8.0.0",
        },
      }),
    );

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("bun");
    expect(discovered.packageManager).toBe("bun");
    expect(discovered.isTypeScript).toBe(true);
    expect(discovered.typecheckCommand).toBe("bun run typecheck");
    expect(discovered.lintCommand).toBe("bun run lint");
    expect(discovered.testRunner.default_command).toBe("bun test");
    expect(discovered.allowedCommands).toContain("bun test");
    expect(discovered.allowedCommands).toContain("bun run");
    expect(discovered.allowedCommands).toContain("eslint");
    expect(discovered.allowedCommands).toContain("tsc");

    const policy = generateDefaultRepoPolicy(dir);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.package_manager).toBe("bun");
    expect(policy.typecheck_command).toBe("bun run typecheck");
    expect(parseRepoPolicy(policy).ecosystem).toBe("bun");
  });

  test("discovers turborepo monorepo pipeline", () => {
    const dir = join(scratch, "turbo-monorepo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { turbo: "^2.0.0" } }),
    );
    writeFileSync(
      join(dir, "turbo.json"),
      JSON.stringify({
        pipeline: {
          typecheck: {},
          lint: {},
          test: {},
        },
      }),
    );

    const discovered = discoverToolchain(dir, "node");
    expect(discovered.isMonorepo).toBe(true);
    expect(discovered.typecheckCommand).toBe("turbo run typecheck");
    expect(discovered.lintCommand).toBe("turbo run lint");
    expect(discovered.testRunner.full_suite_command).toBe("turbo run test");
    expect(discovered.allowedCommands).toContain("turbo");
    expect(discovered.allowedCommands).toContain("turbo run");
  });

  test("discovers pnpm with vitest and biome", () => {
    const dir = join(scratch, "pnpm-vitest-biome");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(dir, "biome.json"), "{}");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: {
          vitest: "^1.0.0",
          "@biomejs/biome": "^1.5.0",
        },
      }),
    );

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("node");
    expect(discovered.packageManager).toBe("pnpm");
    expect(discovered.lintCommand).toBe("biome check");
    expect(discovered.testRunner.default_command).toBe("pnpm test");
    expect(discovered.testRunner.targeted_pattern).toBe("pnpm test <path>");
    expect(discovered.allowedCommands).toContain("pnpm test");
    expect(discovered.allowedCommands).toContain("biome");
    expect(discovered.allowedCommands).toContain("biome check");
    expect(discovered.allowedCommands).toContain("vitest");
  });

  test("discovers node with npm, jest, eslint, and oxlint", () => {
    const dir = join(scratch, "npm-oxlint-jest");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: {
          jest: "^29.0.0",
          oxlint: "^0.2.0",
          typescript: "^5.0.0",
        },
      }),
    );

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("node");
    expect(discovered.packageManager).toBe("npm");
    expect(discovered.typecheckCommand).toBe("npx tsc --noEmit");
    expect(discovered.lintCommand).toBe("oxlint");
    expect(discovered.allowedCommands).toContain("oxlint");
    expect(discovered.allowedCommands).toContain("npx oxlint");
    expect(discovered.allowedCommands).toContain("jest");
    expect(discovered.allowedCommands).toContain("npx tsc");
  });

  test("discovers cargo project with cargo check and clippy", () => {
    const dir = join(scratch, "cargo-project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "rust-test"');
    writeFileSync(join(dir, "Cargo.lock"), "");

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("cargo");
    expect(discovered.packageManager).toBe("cargo");
    expect(discovered.typecheckCommand).toBe("cargo check");
    expect(discovered.lintCommand).toBe("cargo clippy");
    expect(discovered.testRunner.default_command).toBe("cargo test");
    expect(discovered.allowedCommands).toContain("cargo test");
    expect(discovered.allowedCommands).toContain("cargo check");
    expect(discovered.allowedCommands).toContain("cargo clippy");
    expect(discovered.allowedCommands).toContain("cargo build");
  });

  test("discovers python project with poetry, ruff, mypy, and pytest", () => {
    const dir = join(scratch, "python-poetry-ruff");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pyproject.toml"),
      '[tool.poetry]\nname = "demo"\n[tool.ruff]\n[tool.mypy]\n[tool.pytest.ini_options]',
    );
    writeFileSync(join(dir, "poetry.lock"), "");

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("python");
    expect(discovered.packageManager).toBe("poetry");
    expect(discovered.typecheckCommand).toBe("mypy");
    expect(discovered.lintCommand).toBe("ruff check");
    expect(discovered.testRunner.default_command).toBe("pytest");
    expect(discovered.allowedCommands).toContain("pytest");
    expect(discovered.allowedCommands).toContain("mypy");
    expect(discovered.allowedCommands).toContain("ruff check");
    expect(discovered.allowedCommands).toContain("poetry");
    expect(discovered.allowedCommands).toContain("poetry run pytest");
  });

  test("discovers python flake8 when ruff is not present", () => {
    const dir = join(scratch, "python-pip-flake8");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "requirements.txt"), "flake8>=6.0.0\npytest>=7.0.0\nmypy>=1.0.0\n");

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("python");
    expect(discovered.packageManager).toBe("pip");
    expect(discovered.lintCommand).toBe("flake8");
    expect(discovered.allowedCommands).toContain("flake8");
  });

  test("discovers makefile targets when no manifest is present", () => {
    const dir = join(scratch, "make-project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Makefile"),
      "test:\n\t@echo test\nlint:\n\t@echo lint\ntypecheck:\n\t@echo typecheck\n",
    );

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("unknown");
    expect(discovered.typecheckCommand).toBe("make typecheck");
    expect(discovered.lintCommand).toBe("make lint");
    expect(discovered.testRunner.default_command).toBe("make test");
    expect(discovered.allowedCommands).toContain("make");
    expect(discovered.allowedCommands).toContain("make test");
    expect(discovered.allowedCommands).toContain("make lint");
  });
});
