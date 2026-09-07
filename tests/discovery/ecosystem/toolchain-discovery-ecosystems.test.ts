import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  discoverToolchain,
  generateDefaultRepoPolicy,
  parseRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  getCargoPresets,
  getPythonPresets,
  getUnknownPresets,
} from "../../../olt/scripts/src/policy/generator/toolchain-presets.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Toolchain Discovery - Ecosystems (Bun, Node, Cargo, Python, Make)", () => {
  const scratch = "/virtual/toolchain-discovery-ecosystems";
  let vfs: VirtualMemoryFS;
  let vfsSession: VirtualFSSession;

  beforeAll(() => {
    try {
      getCargoPresets();
      getPythonPresets();
      getUnknownPresets();
    } catch {}
  });

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfsSession = createVirtualFSSession(vfs);
    vfs.mkdirSync(scratch, { recursive: true });
    vfs.chdir(scratch);
  });

  afterEach(() => {
    vfsSession.cleanup();
  });

  test("discovers bun toolchain with typescript and custom scripts", () => {
    const dir = join(scratch, "bun-toolchain");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "bun.lock"), "");
    vfs.writeFileSync(join(dir, "tsconfig.json"), "{}");
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { typecheck: "tsc --noEmit", lint: "eslint .", test: "bun test" },
        devDependencies: { typescript: "^5.0.0", eslint: "^8.0.0" },
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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { turbo: "^2.0.0" } }),
    );
    vfs.writeFileSync(
      join(dir, "turbo.json"),
      JSON.stringify({ pipeline: { typecheck: {}, lint: {}, test: {} } }),
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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    vfs.writeFileSync(join(dir, "biome.json"), "{}");
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: { vitest: "^1.0.0", "@biomejs/biome": "^1.5.0" },
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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "package-lock.json"), "{}");
    vfs.writeFileSync(join(dir, "tsconfig.json"), "{}");
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: { jest: "^29.0.0", oxlint: "^0.2.0", typescript: "^5.0.0" },
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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "rust-test"');
    vfs.writeFileSync(join(dir, "Cargo.lock"), "");

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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(
      join(dir, "pyproject.toml"),
      '[tool.poetry]\nname = "demo"\n[tool.ruff]\n[tool.mypy]\n[tool.pytest.ini_options]',
    );
    vfs.writeFileSync(join(dir, "poetry.lock"), "");

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
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(join(dir, "requirements.txt"), "flake8>=6.0.0\npytest>=7.0.0\nmypy>=1.0.0\n");

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("python");
    expect(discovered.packageManager).toBe("pip");
    expect(discovered.lintCommand).toBe("flake8");
    expect(discovered.allowedCommands).toContain("flake8");
  });

  test("discovers makefile targets when no manifest is present", () => {
    const dir = join(scratch, "make-project");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(
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

  test("returns cargo, python, and unknown presets", () => {
    const cargo = getCargoPresets();
    expect(cargo.ecosystem).toBe("cargo");
    expect(cargo.buildCommand).toBe("cargo build");

    const python = getPythonPresets();
    expect(python.ecosystem).toBe("python");
    expect(python.testRunner.default_command).toBe("pytest");

    const unknown = getUnknownPresets();
    expect(unknown.ecosystem).toBe("unknown");
    expect(unknown.packageManager).toBeUndefined();
  });

  test("discovers turborepo tasks format in turbo.json", () => {
    const dir = join(scratch, "turbo-tasks");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { turbo: "^2.0.0" } }),
    );
    vfs.writeFileSync(
      join(dir, "turbo.json"),
      JSON.stringify({ tasks: { typecheck: {}, lint: {}, test: {} } }),
    );
    const discovered = discoverToolchain(dir, "node");
    expect(discovered.isMonorepo).toBe(true);
    expect(discovered.typecheckCommand).toBe("turbo run typecheck");
  });

  test("gracefully falls back on an empty directory", () => {
    const dir = join(scratch, "empty-project");
    vfs.mkdirSync(dir, { recursive: true });

    const discovered = discoverToolchain(dir);
    expect(discovered.ecosystem).toBe("unknown");
    expect(discovered.packageManager).toBeUndefined();
    expect(discovered.typecheckCommand).toBeUndefined();
    expect(discovered.lintCommand).toBeUndefined();
    expect(discovered.testRunner.default_command).toBe("test");
    expect(discovered.allowedCommands).toContain("ls");
    expect(discovered.allowedCommands).toContain("cat");
    expect(discovered.isMonorepo).toBe(false);
    expect(discovered.isTypeScript).toBe(false);

    const policy = generateDefaultRepoPolicy(dir);
    expect(policy.ecosystem).toBe("unknown");
    expect(policy.test_runner.default_command).toBe("test");
  });

  test("gracefully falls back on malformed package.json and empty scripts", () => {
    const malformedDir = join(scratch, "malformed-json-project");
    vfs.mkdirSync(malformedDir, { recursive: true });
    vfs.writeFileSync(join(malformedDir, "package.json"), "{ NOT VALID JSON");

    const malformedDiscovered = discoverToolchain(malformedDir);
    expect(malformedDiscovered.ecosystem).toBe("node");
    expect(malformedDiscovered.packageManager).toBe("npm");
    expect(malformedDiscovered.typecheckCommand).toBe("npm run typecheck");
    expect(malformedDiscovered.lintCommand).toBe("npm run lint");
    expect(malformedDiscovered.testRunner.default_command).toBe("npm test");

    const emptyScriptsDir = join(scratch, "empty-scripts-project");
    vfs.mkdirSync(emptyScriptsDir, { recursive: true });
    vfs.writeFileSync(
      join(emptyScriptsDir, "package.json"),
      JSON.stringify({ name: "empty-scripts", scripts: {} }),
    );

    const emptyScriptsDiscovered = discoverToolchain(emptyScriptsDir);
    expect(emptyScriptsDiscovered.ecosystem).toBe("node");
    expect(emptyScriptsDiscovered.packageManager).toBe("npm");
    expect(emptyScriptsDiscovered.typecheckCommand).toBe("npm run typecheck");
    expect(emptyScriptsDiscovered.lintCommand).toBe("npm run lint");
    expect(emptyScriptsDiscovered.testRunner.default_command).toBe("npm test");
  });
});
