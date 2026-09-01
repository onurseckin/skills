import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  detectRepoEcosystem,
  generateDefaultRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Repo Policy Ecosystem Auto-Detection (Bun, Cargo, Python, Node, Unknown)", () => {
  const scratchBase = "/virtual/policy/io/detect-ecosystems";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  test("detects Bun ecosystem when bun.lock or bun.lockb exists", () => {
    const dir = join(scratchBase, "bun-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "", "utf-8");

    expect(detectRepoEcosystem(dir)).toBe("bun");
    const defaultPolicy = generateDefaultRepoPolicy(dir);
    expect(defaultPolicy.ecosystem).toBe("bun");
    expect(defaultPolicy.package_manager).toBe("bun");
    expect(defaultPolicy.test_runner.default_command).toBe("bun test");
    expect(defaultPolicy.test_runner.targeted_pattern).toBe("bun test <path>");
    expect(defaultPolicy.test_runner.full_suite_command).toBe("bun test");
  });

  test("detects Bun ecosystem when bun.lockb exists", () => {
    const dir = join(scratchBase, "bunb-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lockb"), "", "utf-8");

    expect(detectRepoEcosystem(dir)).toBe("bun");
  });

  test("detects Cargo ecosystem when Cargo.toml or Cargo.lock exists", () => {
    const dir = join(scratchBase, "cargo-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "foo"', "utf-8");

    expect(detectRepoEcosystem(dir)).toBe("cargo");
    const defaultPolicy = generateDefaultRepoPolicy(dir);
    expect(defaultPolicy.ecosystem).toBe("cargo");
    expect(defaultPolicy.package_manager).toBe("cargo");
    expect(defaultPolicy.test_runner.default_command).toBe("cargo test");
    expect(defaultPolicy.test_runner.targeted_pattern).toBe("cargo test -- <path>");

    const dir2 = join(scratchBase, "cargo-lock-test");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "Cargo.lock"), "", "utf-8");
    expect(detectRepoEcosystem(dir2)).toBe("cargo");
  });

  test("detects Python ecosystem across poetry, pipenv, requirements.txt and setup.py", () => {
    const dirPoetry = join(scratchBase, "py-poetry");
    mkdirSync(dirPoetry, { recursive: true });
    writeFileSync(join(dirPoetry, "pyproject.toml"), "[tool.poetry]", "utf-8");
    writeFileSync(join(dirPoetry, "poetry.lock"), "", "utf-8");
    expect(detectRepoEcosystem(dirPoetry)).toBe("python");
    const poetryPolicy = generateDefaultRepoPolicy(dirPoetry);
    expect(poetryPolicy.package_manager).toBe("poetry");
    expect(poetryPolicy.test_runner.default_command).toBe("pytest");

    const dirPipenv = join(scratchBase, "py-pipenv");
    mkdirSync(dirPipenv, { recursive: true });
    writeFileSync(join(dirPipenv, "Pipfile"), "", "utf-8");
    expect(detectRepoEcosystem(dirPipenv)).toBe("python");
    const pipenvPolicy = generateDefaultRepoPolicy(dirPipenv);
    expect(pipenvPolicy.package_manager).toBe("pipenv");

    const dirReq = join(scratchBase, "py-req");
    mkdirSync(dirReq, { recursive: true });
    writeFileSync(join(dirReq, "requirements.txt"), "pytest\n", "utf-8");
    expect(detectRepoEcosystem(dirReq)).toBe("python");
    const reqPolicy = generateDefaultRepoPolicy(dirReq);
    expect(reqPolicy.package_manager).toBe("pip");

    const dirSetup = join(scratchBase, "py-setup");
    mkdirSync(dirSetup, { recursive: true });
    writeFileSync(join(dirSetup, "setup.py"), "# setup\n", "utf-8");
    expect(detectRepoEcosystem(dirSetup)).toBe("python");
  });

  test("detects Node ecosystem across pnpm, yarn, npm, and lockfiles", () => {
    const dirPnpm = join(scratchBase, "node-pnpm");
    mkdirSync(dirPnpm, { recursive: true });
    writeFileSync(join(dirPnpm, "package.json"), "{}", "utf-8");
    writeFileSync(join(dirPnpm, "pnpm-lock.yaml"), "", "utf-8");
    expect(detectRepoEcosystem(dirPnpm)).toBe("node");
    const pnpmPolicy = generateDefaultRepoPolicy(dirPnpm);
    expect(pnpmPolicy.package_manager).toBe("pnpm");
    expect(pnpmPolicy.test_runner.targeted_pattern).toBe("pnpm test <path>");

    const dirYarn = join(scratchBase, "node-yarn");
    mkdirSync(dirYarn, { recursive: true });
    writeFileSync(join(dirYarn, "yarn.lock"), "", "utf-8");
    expect(detectRepoEcosystem(dirYarn)).toBe("node");
    const yarnPolicy = generateDefaultRepoPolicy(dirYarn);
    expect(yarnPolicy.package_manager).toBe("yarn");
    expect(yarnPolicy.test_runner.targeted_pattern).toBe("yarn test <path>");

    const dirNpm = join(scratchBase, "node-npm");
    mkdirSync(dirNpm, { recursive: true });
    writeFileSync(join(dirNpm, "package-lock.json"), "{}", "utf-8");
    expect(detectRepoEcosystem(dirNpm)).toBe("node");
    const npmPolicy = generateDefaultRepoPolicy(dirNpm);
    expect(npmPolicy.package_manager).toBe("npm");
    expect(npmPolicy.test_runner.targeted_pattern).toBe("npm test -- <path>");
  });

  test("detects unknown ecosystem when no marker files exist", () => {
    const dirUnknown = join(scratchBase, "unknown-eco");
    mkdirSync(dirUnknown, { recursive: true });
    expect(detectRepoEcosystem(dirUnknown)).toBe("unknown");
    const unknownPolicy = generateDefaultRepoPolicy(dirUnknown);
    expect(unknownPolicy.ecosystem).toBe("unknown");
    expect(unknownPolicy.test_runner.default_command).toBe("test");
    expect(unknownPolicy.test_runner.targeted_pattern).toBe("test <path>");
  });

  test("detectRepoEcosystem and generateDefaultRepoPolicy resolve current repo when repoRoot is omitted", () => {
    const eco = detectRepoEcosystem();
    expect(typeof eco).toBe("string");
    const policy = generateDefaultRepoPolicy();
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
  });
});
