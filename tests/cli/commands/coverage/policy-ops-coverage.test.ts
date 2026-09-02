import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  policyAuditCommand,
  policyCheckDriftCommand,
  policyGetCommand,
  policyInitCommand,
  policySetCommand,
} from "../../../../olt/scripts/src/cli/commands/policy-ops.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { computePolicyChecksum } from "../../../../olt/scripts/src/policy/index.ts";

describe("policy-ops CLI Command Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "policy-ops-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("policyInitCommand handles default, ecosystem, calibrate, and awaken modes", async () => {
    // 1. Default init with repo alias
    const res1 = await policyInitCommand({ repo: tempDir });
    expect(res1.ok).toBe(true);
    expect(typeof res1.file_path).toBe("string");
    expect(res1.markdown).toContain("### Policy Initialized");

    // 2. Explicit ecosystem and repo-root alias
    const res2 = await policyInitCommand({
      "repo-root": tempDir,
      ecosystem: "bun",
    });
    expect(res2.ok).toBe(true);
    expect(res2.ecosystem).toBe("bun");

    // 3. Calibrate / auto-discover with dir alias
    const res3 = await policyInitCommand({
      dir: tempDir,
      calibrate: true,
    });
    expect(res3.ok).toBe(true);
    expect(res3.policy).toBeDefined();

    // 4. Awaken / first-responder mode
    const res4 = await policyInitCommand({
      repo: tempDir,
      awaken: true,
      "test-commands": true,
    });
    expect(res4.ok).toBe(true);
    expect(res4.awakened).toBe(true);
    expect(res4.markdown).toContain("Tier 0 Awakened");
  });

  test("policyGetCommand returns entire policy or nested key, throwing on missing key", async () => {
    await policyInitCommand({ repo: tempDir, ecosystem: "bun" });

    // 1. Get entire policy
    const all = await policyGetCommand({ repo: tempDir });
    expect(all.ok).toBe(true);
    expect(all.markdown).toContain("### Repository Policy");

    // 2. Get existing nested key
    const single = await policyGetCommand({ repo: tempDir, key: "test_runner.default_command" });
    expect(single.ok).toBe(true);
    expect(typeof single.value).toBe("string");
    expect(single.markdown).toContain("### Policy Key: `test_runner.default_command`");

    // 3. Throw on missing key
    await expect(
      policyGetCommand({ repo: tempDir, key: "nonexistent.nested.key" }),
    ).rejects.toThrow(HarnessError);
  });

  test("policySetCommand validates arguments, parses coerced values, and sets nested keys", async () => {
    await policyInitCommand({ repo: tempDir, ecosystem: "bun" });

    // 1. Missing key or value validation
    await expect(policySetCommand({ repo: tempDir })).rejects.toThrow(HarnessError);
    await expect(policySetCommand({ repo: tempDir, key: "test" })).rejects.toThrow(HarnessError);

    // 2. String coerced value
    const resStr = await policySetCommand({
      repo: tempDir,
      key: "test_runner.default_command",
      value: "bun test --coverage",
    });
    expect(resStr.value).toBe("bun test --coverage");

    // 3. Boolean coerced values
    const resBoolTrue = await policySetCommand({
      repo: tempDir,
      key: "planning.enforce_edge_case_matrix",
      value: "true",
    });
    expect(resBoolTrue.value).toBe(true);

    const resBoolFalse = await policySetCommand({
      repo: tempDir,
      key: "planning.reject_shallow_umbrella_compression",
      value: "false",
    });
    expect(resBoolFalse.value).toBe(false);

    // 4. Integer coerced value
    const resInt = await policySetCommand({
      repo: tempDir,
      key: "test_runner.timeout_ms",
      value: "15000",
    });
    expect(resInt.value).toBe(15000);

    // 5. JSON array coerced value
    const resJson = await policySetCommand({
      repo: tempDir,
      key: "hooks.on_task_completion",
      value: JSON.stringify(["scripts/lint.sh"]),
    });
    expect(resJson.value).toEqual(["scripts/lint.sh"]);
    expect(resJson.markdown).toContain("### Policy Key Updated");
  });

  test("policyCheckDriftCommand checks synchronization and strict enforcement", async () => {
    await policyInitCommand({ repo: tempDir, ecosystem: "bun" });
    const currentChecksum = computePolicyChecksum(tempDir);

    // 1. In-sync without checksum or matching checksum
    const res1 = await policyCheckDriftCommand({ repo: tempDir });
    expect(res1.status).toBe("in_sync");
    expect(res1.drifted).toBe(false);

    const res2 = await policyCheckDriftCommand({ repo: tempDir, checksum: currentChecksum });
    expect(res2.status).toBe("in_sync");

    // 2. Drifted checksum
    const res3 = await policyCheckDriftCommand({ repo: tempDir, checksum: "sha256-mismatch" });
    expect(res3.status).toBe("drifted");
    expect(res3.drifted).toBe(true);

    // 3. Strict failure on drift
    await expect(
      policyCheckDriftCommand({ repo: tempDir, checksum: "sha256-mismatch", strict: true }),
    ).rejects.toThrow(HarnessError);

    // 4. Invalid policy file handling in strict mode
    const oltDir = join(tempDir, ".olt");
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "policy.json"), "{ invalid json: true");

    await expect(policyCheckDriftCommand({ repo: tempDir, strict: true })).rejects.toThrow(
      HarnessError,
    );
  });

  test("policyAuditCommand executes governance coverage audit across flag aliases", async () => {
    await policyInitCommand({ repo: tempDir, ecosystem: "bun" });

    const res = await policyAuditCommand({
      "repo-root": tempDir,
      "run-root": "capsule-run-1",
    });

    expect(res.ok).toBe(true);
    expect(res.report).toBeDefined();
    expect(typeof res.ready).toBe("boolean");
    expect(res.markdown).toContain("### Governance Coverage Audit");
  });
});
