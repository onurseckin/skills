import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectRepoEcosystem,
  generateDefaultRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  validateRepoPolicy,
} from "../../../olt/scripts/src/policy/repo-policy.ts";

describe("Repo Policy Auto-Detection & Schema Validation", () => {
  const tmpTestDir = join(require("os").tmpdir(), "tmp", "test-repo-policy");

  test("detects Bun ecosystem when bun.lock or bun.lockb exists", () => {
    mkdirSync(tmpTestDir, { recursive: true });
    writeFileSync(join(tmpTestDir, "bun.lock"), "", "utf-8");

    const ecosystem = detectRepoEcosystem(tmpTestDir);
    expect(ecosystem).toBe("bun");

    const defaultPolicy = generateDefaultRepoPolicy(tmpTestDir);
    expect(defaultPolicy.ecosystem).toBe("bun");
    expect(defaultPolicy.test_runner.default_command).toBe("bun test");
    expect(defaultPolicy.test_runner.targeted_pattern).toBe("bun test <path>");

    rmSync(tmpTestDir, { recursive: true, force: true });
  });

  test("detects Cargo ecosystem when Cargo.toml exists", () => {
    mkdirSync(tmpTestDir, { recursive: true });
    writeFileSync(join(tmpTestDir, "Cargo.toml"), '[package]\nname = "foo"', "utf-8");

    const ecosystem = detectRepoEcosystem(tmpTestDir);
    expect(ecosystem).toBe("cargo");

    const defaultPolicy = generateDefaultRepoPolicy(tmpTestDir);
    expect(defaultPolicy.ecosystem).toBe("cargo");
    expect(defaultPolicy.test_runner.default_command).toBe("cargo test");

    rmSync(tmpTestDir, { recursive: true, force: true });
  });

  test("detects Python ecosystem when pyproject.toml exists", () => {
    mkdirSync(tmpTestDir, { recursive: true });
    writeFileSync(join(tmpTestDir, "pyproject.toml"), "[tool.poetry]", "utf-8");

    const ecosystem = detectRepoEcosystem(tmpTestDir);
    expect(ecosystem).toBe("python");

    const defaultPolicy = generateDefaultRepoPolicy(tmpTestDir);
    expect(defaultPolicy.ecosystem).toBe("python");
    expect(defaultPolicy.test_runner.default_command).toBe("pytest");

    rmSync(tmpTestDir, { recursive: true, force: true });
  });

  test("validates and normalizes malformed policy objects", () => {
    const raw = {
      schema_version: 1,
      ecosystem: "BUN",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    };

    const validated = validateRepoPolicy(raw);
    expect(validated.schema_version).toBe(1);
    expect(validated.ecosystem).toBe("bun");
    expect(validated.read_scope_neighborhood_depth).toBe(2);
  });

  test("saves and loads repo policy reliably", () => {
    mkdirSync(tmpTestDir, { recursive: true });
    const policyPath = join(tmpTestDir, "policy.json");

    const policy = generateDefaultRepoPolicy(process.cwd());
    saveRepoPolicy(policy, tmpTestDir, policyPath);

    const loaded = loadRepoPolicy(tmpTestDir, policyPath);
    expect(loaded.ecosystem).toBe(policy.ecosystem);
    expect(loaded.test_runner.default_command).toBe(policy.test_runner.default_command);

    rmSync(tmpTestDir, { recursive: true, force: true });
  });
});
