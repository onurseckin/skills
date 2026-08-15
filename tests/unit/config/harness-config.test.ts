import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  loadHarnessConfig,
} from "../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";

describe("harness-config", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "harness-config-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    }
    tempDirs.length = 0;
  });

  test("returns DEFAULT_CONFIG when no config file exists", () => {
    const dir = makeTempDir();
    const config = loadHarnessConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.min_adversarial_rejections).toBe(3);
    expect(config.max_repair_rounds).toBe(6);
    expect(config.max_output_bytes).toBe(10 * 1024 * 1024);
    expect(config.default_lease_seconds).toBe(1800);
    expect(config.default_max_parallel).toBe(4);
    expect(config.strict_validation).toBe(true);
  });

  test("loads settings from harness.config.json in repo root", () => {
    const dir = makeTempDir();
    const custom = {
      min_adversarial_rejections: 4,
      max_repair_rounds: 8,
      max_output_bytes: 5 * 1024 * 1024,
      default_lease_seconds: 900,
      default_max_parallel: 2,
      strict_validation: false,
    };
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(custom));

    const config = loadHarnessConfig(dir);
    expect(config).toEqual(custom);
  });

  test("loads settings from .harness.config.json when harness.config.json is absent", () => {
    const dir = makeTempDir();
    const custom = {
      max_repair_rounds: 7,
      strict_validation: false,
    };
    writeFileSync(join(dir, ".harness.config.json"), JSON.stringify(custom));

    const config = loadHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(7);
    expect(config.strict_validation).toBe(false);
    expect(config.max_output_bytes).toBe(DEFAULT_CONFIG.max_output_bytes);
    expect(config.default_lease_seconds).toBe(DEFAULT_CONFIG.default_lease_seconds);
  });

  test("prefers harness.config.json over .harness.config.json", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 10 }));
    writeFileSync(join(dir, ".harness.config.json"), JSON.stringify({ max_repair_rounds: 3 }));

    const config = loadHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(10);
  });

  test("applies capsule config and merges repo config over it", () => {
    const repoDir = makeTempDir();
    const capDir = makeTempDir();

    writeFileSync(
      join(capDir, "config.json"),
      JSON.stringify({ max_repair_rounds: 4, default_max_parallel: 8 }),
    );
    writeFileSync(join(repoDir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 6 }));

    const config = loadHarnessConfig(repoDir, capDir);
    expect(config.max_repair_rounds).toBe(6);
    expect(config.default_max_parallel).toBe(8);
    expect(config.default_lease_seconds).toBe(DEFAULT_CONFIG.default_lease_seconds);
  });

  test("gracefully recovers from invalid JSON or non-object files", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "harness.config.json"), "{ invalid-json }");

    const config = loadHarnessConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(["not", "an", "object"]));
    const configArray = loadHarnessConfig(dir);
    expect(configArray).toEqual(DEFAULT_CONFIG);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(null));
    const configNull = loadHarnessConfig(dir);
    expect(configNull).toEqual(DEFAULT_CONFIG);
  });

  test("ignores invalid field types and out-of-bounds values", () => {
    const dir = makeTempDir();
    const invalidFields = {
      max_repair_rounds: -1,
      max_output_bytes: 100, // below 1024 minimum
      default_lease_seconds: 2, // below 5s minimum
      default_max_parallel: 0,
      strict_validation: "not-a-boolean",
    };
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(invalidFields));

    const config = loadHarnessConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
