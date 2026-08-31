import { describe, expect, it } from "bun:test";
import {
  BALANCED_QUOTA,
  PERMISSIVE_QUOTA,
  STRICT_QUOTA,
  UNCONSTRAINED_QUOTA,
  createCustomSandboxPolicy,
  createDefaultResourcePolicy,
  createDefaultSandboxPolicy,
  mergeQuotas,
  resolveSandboxPolicy,
  resolveSandboxQuota,
  validatePolicyConfiguration,
} from "../../../olt/scripts/src/tooling/sandbox/policy.ts";

describe("Sandbox Policy & Quota Resolution Unit Test Suite", () => {
  describe("Standard Tier Quotas", () => {
    it("defines monotonically increasing constraints across tiers", () => {
      expect(STRICT_QUOTA.timeoutMs!).toBeLessThan(BALANCED_QUOTA.timeoutMs!);
      expect(BALANCED_QUOTA.timeoutMs!).toBeLessThan(PERMISSIVE_QUOTA.timeoutMs!);
      expect(PERMISSIVE_QUOTA.timeoutMs!).toBeLessThan(UNCONSTRAINED_QUOTA.timeoutMs!);

      expect(STRICT_QUOTA.maxMemoryRssBytes!).toBeLessThan(BALANCED_QUOTA.maxMemoryRssBytes!);
      expect(BALANCED_QUOTA.maxMemoryRssBytes!).toBeLessThan(PERMISSIVE_QUOTA.maxMemoryRssBytes!);
      expect(PERMISSIVE_QUOTA.maxMemoryRssBytes!).toBeLessThan(
        UNCONSTRAINED_QUOTA.maxMemoryRssBytes!,
      );

      expect(STRICT_QUOTA.maxCpuPercent!).toBeLessThan(BALANCED_QUOTA.maxCpuPercent!);
      expect(BALANCED_QUOTA.maxCpuPercent!).toBeLessThan(PERMISSIVE_QUOTA.maxCpuPercent!);
    });
  });

  describe("Quota merging and resolution", () => {
    it("merges partial overrides over base quota cleanly", () => {
      const merged = mergeQuotas(BALANCED_QUOTA, { timeoutMs: 12345, maxCpuPercent: 50 });
      expect(merged.timeoutMs).toBe(12345);
      expect(merged.maxCpuPercent).toBe(50);
      expect(merged.maxMemoryRssBytes).toBe(BALANCED_QUOTA.maxMemoryRssBytes);
    });

    it("resolves tier defaults, category overrides, and tool overrides in precedence order", () => {
      const policy = createDefaultResourcePolicy();
      const defaultQuota = resolveSandboxQuota(policy);
      expect(defaultQuota.timeoutMs).toBe(BALANCED_QUOTA.timeoutMs);

      const fsQuota = resolveSandboxQuota(policy, "balanced", "fs");
      expect(fsQuota.timeoutMs).toBe(15000);
      expect(fsQuota.maxMemoryRssBytes).toBe(256 * 1024 * 1024);

      const customPolicy = {
        ...policy,
        toolOverrides: {
          special_compute: { timeoutMs: 99999 },
        },
      };

      const toolQuota = resolveSandboxQuota(customPolicy, "balanced", "fs", "special_compute");
      expect(toolQuota.timeoutMs).toBe(99999);
      expect(toolQuota.maxMemoryRssBytes).toBe(256 * 1024 * 1024);
    });

    it("supports createDefaultSandboxPolicy alias", () => {
      const p1 = createDefaultResourcePolicy();
      const p2 = createDefaultSandboxPolicy();
      expect(p1.defaultTier).toBe(p2.defaultTier);
      expect(p1.tierQuotas.strict.timeoutMs).toBe(p2.tierQuotas.strict.timeoutMs);
    });
  });

  describe("Isolation Policies", () => {
    it("resolves isolation levels to concrete configuration", () => {
      const strict = resolveSandboxPolicy("strict");
      expect(strict.isolationLevel).toBe("strict");
      expect(strict.allowSubprocess).toBe(false);

      const permissive = resolveSandboxPolicy("permissive");
      expect(permissive.allowSubprocess).toBe(true);
      expect(permissive.allowNetwork).toBe(true);
    });

    it("creates custom policies with overrides", () => {
      const custom = createCustomSandboxPolicy({
        isolationLevel: "strict",
        maxMemoryMb: 2048,
        allowSubprocess: true,
      });

      expect(custom.maxMemoryMb).toBe(2048);
      expect(custom.allowSubprocess).toBe(true);
      expect(custom.blockedDirectories).toContain("/etc");
    });

    it("validates policy configuration bounds", () => {
      expect(validatePolicyConfiguration(resolveSandboxPolicy("strict"))).toHaveLength(0);
      const errors = validatePolicyConfiguration({
        isolationLevel: "strict",
        allowedDirectories: [],
        blockedDirectories: [],
        readOnlyDirectories: [],
        allowedEnvironmentKeys: [],
        blockedEnvironmentKeys: [],
        maxMemoryMb: -1,
        maxExecutionTimeMs: 1000,
        allowSubprocess: false,
        allowNetwork: false,
        maxOutputSizeBytes: 100,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain("maxMemoryMb must be greater than 0");
    });
  });
});
