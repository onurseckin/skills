import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  DEFAULT_PLANNING_POLICY,
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  detectRepoEcosystem,
  generateDefaultRepoPolicy,
  initRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  validateRepoPolicy,
} from "../../../olt/scripts/src/policy/repo-policy.ts";

describe("Repo Policy Auto-Detection & Schema Validation", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "test-repo-policy");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
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

    rmSync(dir, { recursive: true, force: true });
  });

  test("detects Bun ecosystem when bun.lockb exists", () => {
    const dir = join(scratchBase, "bunb-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lockb"), "", "utf-8");

    expect(detectRepoEcosystem(dir)).toBe("bun");
    rmSync(dir, { recursive: true, force: true });
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

    rmSync(dir, { recursive: true, force: true });

    const dir2 = join(scratchBase, "cargo-lock-test");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "Cargo.lock"), "", "utf-8");
    expect(detectRepoEcosystem(dir2)).toBe("cargo");
    rmSync(dir2, { recursive: true, force: true });
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
    rmSync(dirPoetry, { recursive: true, force: true });

    const dirPipenv = join(scratchBase, "py-pipenv");
    mkdirSync(dirPipenv, { recursive: true });
    writeFileSync(join(dirPipenv, "Pipfile"), "", "utf-8");
    expect(detectRepoEcosystem(dirPipenv)).toBe("python");
    const pipenvPolicy = generateDefaultRepoPolicy(dirPipenv);
    expect(pipenvPolicy.package_manager).toBe("pipenv");
    rmSync(dirPipenv, { recursive: true, force: true });

    const dirReq = join(scratchBase, "py-req");
    mkdirSync(dirReq, { recursive: true });
    writeFileSync(join(dirReq, "requirements.txt"), "pytest\n", "utf-8");
    expect(detectRepoEcosystem(dirReq)).toBe("python");
    const reqPolicy = generateDefaultRepoPolicy(dirReq);
    expect(reqPolicy.package_manager).toBe("pip");
    rmSync(dirReq, { recursive: true, force: true });

    const dirSetup = join(scratchBase, "py-setup");
    mkdirSync(dirSetup, { recursive: true });
    writeFileSync(join(dirSetup, "setup.py"), "# setup\n", "utf-8");
    expect(detectRepoEcosystem(dirSetup)).toBe("python");
    rmSync(dirSetup, { recursive: true, force: true });
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
    rmSync(dirPnpm, { recursive: true, force: true });

    const dirYarn = join(scratchBase, "node-yarn");
    mkdirSync(dirYarn, { recursive: true });
    writeFileSync(join(dirYarn, "yarn.lock"), "", "utf-8");
    expect(detectRepoEcosystem(dirYarn)).toBe("node");
    const yarnPolicy = generateDefaultRepoPolicy(dirYarn);
    expect(yarnPolicy.package_manager).toBe("yarn");
    expect(yarnPolicy.test_runner.targeted_pattern).toBe("yarn test <path>");
    rmSync(dirYarn, { recursive: true, force: true });

    const dirNpm = join(scratchBase, "node-npm");
    mkdirSync(dirNpm, { recursive: true });
    writeFileSync(join(dirNpm, "package-lock.json"), "{}", "utf-8");
    expect(detectRepoEcosystem(dirNpm)).toBe("node");
    const npmPolicy = generateDefaultRepoPolicy(dirNpm);
    expect(npmPolicy.package_manager).toBe("npm");
    expect(npmPolicy.test_runner.targeted_pattern).toBe("npm test -- <path>");
    rmSync(dirNpm, { recursive: true, force: true });
  });

  test("detects unknown ecosystem when no marker files exist", () => {
    const dirUnknown = join(scratchBase, "unknown-eco");
    mkdirSync(dirUnknown, { recursive: true });
    expect(detectRepoEcosystem(dirUnknown)).toBe("unknown");
    const unknownPolicy = generateDefaultRepoPolicy(dirUnknown);
    expect(unknownPolicy.ecosystem).toBe("unknown");
    expect(unknownPolicy.test_runner.default_command).toBe("test");
    expect(unknownPolicy.test_runner.targeted_pattern).toBe("test <path>");
    rmSync(dirUnknown, { recursive: true, force: true });
  });

  test("detectRepoEcosystem and generateDefaultRepoPolicy resolve current repo when repoRoot is omitted", () => {
    const eco = detectRepoEcosystem();
    expect(typeof eco).toBe("string");
    const policy = generateDefaultRepoPolicy();
    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
  });

  test("validates and normalizes malformed policy objects and throws on invalid inputs", () => {
    expect(() => validateRepoPolicy(null)).toThrow(/must be an object/i);
    expect(() => validateRepoPolicy("string")).toThrow(/must be an object/i);
    expect(() => validateRepoPolicy([1, 2, 3])).toThrow(/must be an object/i);

    const empty = validateRepoPolicy({});
    expect(empty.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(empty.ecosystem).toBe("unknown");
    expect(empty.test_runner.default_command).toBe("bun test");
    expect(empty.read_scope_neighborhood_depth).toBe(2);
    expect(empty.review_protocol).toEqual(DEFAULT_REVIEW_PROTOCOL_POLICY);
    expect(empty.planning).toEqual(DEFAULT_PLANNING_POLICY);

    const custom = validateRepoPolicy({
      schema_version: 2,
      ecosystem: "python",
      package_manager: "poetry",
      test_runner: {
        default_command: "  pytest -v  ",
        targeted_pattern: "  pytest <path> -s  ",
        full_suite_command: "  pytest  ",
      },
      typecheck_command: "  mypy .  ",
      lint_command: "  ruff check .  ",
      allowed_commands: ["pytest", "  ", 123, "mypy"],
      forbidden_commands: ["git push", ""],
      read_scope_neighborhood_depth: -5,
      review_protocol: {
        max_adversarial_pushes: 0,
        cognitive_pushes: -2,
        escalate_on_exhausted_adversarial: false,
      },
      planning: {
        mandatory_brainstorming_rounds: -1,
        socratic_expansion_depth: -3,
        enforce_edge_case_matrix: false,
        min_tasks_per_complex_prompt: 0,
        max_files_per_task: 0,
        reject_shallow_umbrella_compression: false,
      },
    });

    expect(custom.schema_version).toBe(2);
    expect(custom.ecosystem).toBe("python");
    expect(custom.package_manager).toBe("poetry");
    expect(custom.test_runner.default_command).toBe("pytest -v");
    expect(custom.test_runner.targeted_pattern).toBe("pytest <path> -s");
    expect(custom.test_runner.full_suite_command).toBe("pytest");
    expect(custom.typecheck_command).toBe("mypy .");
    expect(custom.lint_command).toBe("ruff check .");
    expect(custom.allowed_commands).toEqual(["pytest", "mypy"]);
    expect(custom.forbidden_commands).toEqual(["git push"]);
    expect(custom.read_scope_neighborhood_depth).toBe(2);
    expect(custom.review_protocol?.max_adversarial_pushes).toBe(
      DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
    );
    expect(custom.review_protocol?.cognitive_pushes).toBe(
      DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
    );
    expect(custom.review_protocol?.escalate_on_exhausted_adversarial).toBe(false);
    expect(custom.planning?.mandatory_brainstorming_rounds).toBe(
      DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
    );
    expect(custom.planning?.min_tasks_per_complex_prompt).toBe(
      DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
    );
  });

  test("saves, loads and initializes repo policy while distinguishing missing and invalid policy", () => {
    const dir = join(scratchBase, "save-load-init");
    const policyPath = join(dir, "nested", "policy.json");

    // Missing file returns default policy
    const fallbackPolicy = loadRepoPolicy(dir, policyPath);
    expect(fallbackPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    // Corrupted file fails closed with the path and parsing diagnosis
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(policyPath, "{ invalid json", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/Repository policy.*invalid/i);
    try {
      loadRepoPolicy(dir, policyPath);
      throw new Error("expected invalid policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(error).toHaveProperty("message");
      expect(String((error as Error).message)).toContain(policyPath);
    }

    writeFileSync(policyPath, "true", "utf-8");
    expect(() => loadRepoPolicy(dir, policyPath)).toThrow(/must be an object/i);

    // Save policy creates directories and validates
    const policy = generateDefaultRepoPolicy(process.cwd());
    const savedPath = saveRepoPolicy(policy, dir, policyPath);
    expect(savedPath).toBe(policyPath);

    const loaded = loadRepoPolicy(dir, policyPath);
    expect(loaded.ecosystem).toBe(policy.ecosystem);
    expect(loaded.test_runner.default_command).toBe(policy.test_runner.default_command);

    // initRepoPolicy creates and saves default policy
    const initDir = join(scratchBase, "init-policy-dir");
    const initialized = initRepoPolicy(initDir);
    expect(initialized.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    rmSync(dir, { recursive: true, force: true });
    rmSync(initDir, { recursive: true, force: true });
  });

  test("fails closed when an existing canonical policy path is unreadable", () => {
    const dir = join(scratchBase, "unreadable-policy");
    const policyPath = join(dir, ".olt", "policy.json");
    mkdirSync(policyPath, { recursive: true });

    expect(() => loadRepoPolicy(dir)).toThrow(/Repository policy.*invalid/i);
    try {
      loadRepoPolicy(dir);
      throw new Error("expected unreadable policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(String((error as Error).message)).toContain(policyPath);
      expect(String((error as Error).message)).toMatch(/directory|EISDIR/i);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  test("inspectRepoPolicy accurately reports auto_detected, valid_custom, and invalid_custom status (Matrix row 13)", () => {
    const dir = join(scratchBase, "inspect-policy-test");
    const customPolicyPath = join(dir, ".olt", "policy.json");

    // Case 1: Missing file -> auto_detected
    const autoDetected = inspectRepoPolicy(dir, customPolicyPath);
    expect(autoDetected.status).toBe("auto_detected");
    expect(autoDetected.policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(autoDetected.error).toBeUndefined();

    // Case 2: Valid custom file -> valid_custom
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const samplePolicy = generateDefaultRepoPolicy(dir);
    writeFileSync(customPolicyPath, JSON.stringify(samplePolicy, null, 2), "utf-8");
    const validCustom = inspectRepoPolicy(dir, customPolicyPath);
    expect(validCustom.status).toBe("valid_custom");
    expect(validCustom.policy.ecosystem).toBe(samplePolicy.ecosystem);
    expect(validCustom.filePath).toBe(customPolicyPath);
    expect(validCustom.error).toBeUndefined();

    // Case 3: Corrupted / invalid JSON -> invalid_custom with fallback policy and error message
    writeFileSync(customPolicyPath, "{ malformed json: true", "utf-8");
    const invalidCustom = inspectRepoPolicy(dir, customPolicyPath);
    expect(invalidCustom.status).toBe("invalid_custom");
    expect(invalidCustom.policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(invalidCustom.filePath).toBe(customPolicyPath);
    expect(invalidCustom.error).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  });
});
