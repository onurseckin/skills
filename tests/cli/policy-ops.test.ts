import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  policyCheckDriftCommand,
  policyGetCommand,
  policyInitCommand,
  policySetCommand,
} from "../../olt/scripts/src/cli/commands/policy-ops.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  computePolicyChecksum,
  generateDefaultRepoPolicy,
  saveRepoPolicy,
} from "../../olt/scripts/src/policy/index.ts";

const tempDirs: string[] = [];

function createTempRepo(label: string): string {
  const dir = join(
    tmpdir(),
    `policy-ops-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}", "utf-8");
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs.length = 0;
});

describe("policy-ops CLI commands", () => {
  describe("policyInitCommand", () => {
    test("initializes policy with default repo and explicit ecosystem", async () => {
      const repo = createTempRepo("init-custom");
      const res = await policyInitCommand({
        repo,
        ecosystem: "python",
      });

      expect(res.ok).toBe(true);
      expect(res.ecosystem).toBe("python");
      expect(typeof res.file_path).toBe("string");
      expect(String(res.markdown)).toContain("Policy Initialized");
    });

    test("initializes policy with repo-root and dir fallback flags", async () => {
      const repo1 = createTempRepo("init-repo-root");
      const res1 = await policyInitCommand({ "repo-root": repo1 });
      expect(res1.ok).toBe(true);

      const repo2 = createTempRepo("init-dir");
      const res2 = await policyInitCommand({ dir: repo2 });
      expect(res2.ok).toBe(true);
    });
  });

  describe("policyGetCommand", () => {
    test("returns full policy when key is omitted", async () => {
      const repo = createTempRepo("get-full");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      const res = await policyGetCommand({ repo });
      expect(res.ok).toBe(true);
      expect(res.policy).toBeDefined();
      expect(String(res.markdown)).toContain("Repository Policy");
    });

    test("retrieves nested key values correctly", async () => {
      const repo = createTempRepo("get-key");
      const policy = generateDefaultRepoPolicy(repo);
      policy.read_scope_neighborhood_depth = 5;
      saveRepoPolicy(policy, repo);

      const res = await policyGetCommand({
        repo,
        key: "read_scope_neighborhood_depth",
      });
      expect(res.ok).toBe(true);
      expect(res.value).toBe(5);
      expect(String(res.markdown)).toContain("Policy Key: `read_scope_neighborhood_depth`");
    });

    test("retrieves deeper nested object paths and handles intermediate non-object", async () => {
      const repo = createTempRepo("get-deep-key");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      const res = await policyGetCommand({
        repo,
        key: "test_runner.default_command",
      });
      expect(res.ok).toBe(true);
      expect(typeof res.value).toBe("string");

      // Deep non-existent key returns undefined / throws
      await expect(
        policyGetCommand({
          repo,
          key: "test_runner.default_command.non_existent_prop",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    test("throws HarnessError INVALID_ARGUMENT when key is not found", async () => {
      const repo = createTempRepo("get-missing");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      await expect(
        policyGetCommand({
          repo,
          key: "non_existent.deep_key",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });
  });

  describe("policySetCommand", () => {
    test("sets nested configuration with various coerced types", async () => {
      const repo = createTempRepo("set-types");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      // Boolean true coercion
      const boolRes = await policySetCommand({
        repo,
        key: "review_protocol.escalate_on_exhausted_adversarial",
        value: "true",
      });
      expect(boolRes.value).toBe(true);

      // Boolean false coercion
      const falseRes = await policySetCommand({
        repo,
        key: "review_protocol.escalate_on_exhausted_adversarial",
        value: "false",
      });
      expect(falseRes.value).toBe(false);

      // Integer coercion
      const intRes = await policySetCommand({
        repo,
        key: "read_scope_neighborhood_depth",
        value: "4",
      });
      expect(intRes.value).toBe(4);

      // Provenance string coercion
      const provRes = await policySetCommand({
        repo,
        key: "provenance",
        value: "custom-template-v1",
      });
      expect(provRes.value).toBe("custom-template-v1");

      // JSON string array coercion
      const jsonRes = await policySetCommand({
        repo,
        key: "forbidden_commands",
        value: '["rm -rf /", "mkfs"]',
      });
      expect(jsonRes.value).toEqual(["rm -rf /", "mkfs"]);

      // Plain string coercion
      const strRes = await policySetCommand({
        repo,
        key: "typecheck_command",
        value: "bun run typecheck",
      });
      expect(strRes.value).toBe("bun run typecheck");
    });

    test("creates intermediate objects when setting nested keys on undefined parents", async () => {
      const repo = createTempRepo("set-deep");
      const policy = generateDefaultRepoPolicy(repo);
      delete (policy as Record<string, unknown>).planning;
      saveRepoPolicy(policy, repo);

      const res = await policySetCommand({
        repo,
        key: "planning.mandatory_brainstorming_rounds",
        value: "3",
      });
      expect(res.ok).toBe(true);
      expect(res.value).toBe(3);
    });

    test("throws when setting invalid policy fields", async () => {
      const repo = createTempRepo("set-invalid");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      await expect(
        policySetCommand({
          repo,
          key: "invalid_top_level_key",
          value: "test",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });
  });

  describe("policyCheckDriftCommand", () => {
    test("reports in_sync when checksum matches and policy is valid", async () => {
      const repo = createTempRepo("drift-ok");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);
      const checksum = computePolicyChecksum(repo);

      const res = await policyCheckDriftCommand({
        repo,
        checksum,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("in_sync");
      expect(res.drifted).toBe(false);
      expect(res.checksum).toBe(checksum);
    });

    test("detects drift when expected checksum differs", async () => {
      const repo = createTempRepo("drift-diff");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      const res = await policyCheckDriftCommand({
        repo,
        checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("drifted");
      expect(res.drifted).toBe(true);
    });

    test("flags invalid_custom status as drifted", async () => {
      const repo = createTempRepo("drift-corrupt");
      mkdirSync(join(repo, ".olt"), { recursive: true });
      writeFileSync(join(repo, ".olt", "policy.json"), "{ corrupt json", "utf-8");

      const res = await policyCheckDriftCommand({ repo });
      expect(res.drifted).toBe(true);
      expect(res.status).toBe("drifted");
    });

    test("throws HarnessError INTEGRITY when strict mode is set on drift or corruption", async () => {
      const repo = createTempRepo("drift-strict");
      const policy = generateDefaultRepoPolicy(repo);
      saveRepoPolicy(policy, repo);

      await expect(
        policyCheckDriftCommand({
          repo,
          checksum: "sha256:mismatch",
          strict: true,
        }),
      ).rejects.toMatchObject({
        code: "INTEGRITY",
      });

      mkdirSync(join(repo, ".olt"), { recursive: true });
      writeFileSync(join(repo, ".olt", "policy.json"), "{ corrupt json", "utf-8");

      await expect(
        policyCheckDriftCommand({
          repo,
          strict: true,
        }),
      ).rejects.toMatchObject({
        code: "INTEGRITY",
      });
    });
  });
});
