import { describe, expect, it } from "bun:test";
import {
  DANGEROUS_COMMAND_NAMES,
  PERMISSIVE_SANDBOX_POLICY,
  READ_ONLY_SANDBOX_POLICY,
  RESTRICTED_SANDBOX_POLICY,
  STRICT_SANDBOX_POLICY,
  assertPathWithinBoundaries,
  createCustomSandboxPolicy,
  isCommandSafe,
  isPathAllowed,
  resolveSandboxPolicy,
  sanitizeEnvironmentVariables,
  validatePolicyConfiguration,
  type SandboxPolicyConfig,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Dynamic Tool Sandboxing & Policy Suite", () => {
  describe("Sandbox Policy Resolution & Customization", () => {
    it("resolves default policies for all isolation levels", () => {
      expect(resolveSandboxPolicy("strict")).toBe(STRICT_SANDBOX_POLICY);
      expect(resolveSandboxPolicy("restricted")).toBe(RESTRICTED_SANDBOX_POLICY);
      expect(resolveSandboxPolicy("read_only")).toBe(READ_ONLY_SANDBOX_POLICY);
      expect(resolveSandboxPolicy("permissive")).toBe(PERMISSIVE_SANDBOX_POLICY);
    });

    it("creates custom policy merging overrides onto base policy", () => {
      const custom = createCustomSandboxPolicy({
        isolationLevel: "strict",
        maxMemoryMb: 2048,
        allowedDirectories: ["/tmp/custom"],
      });

      expect(custom.isolationLevel).toBe("strict");
      expect(custom.maxMemoryMb).toBe(2048);
      expect(custom.allowedDirectories).toEqual(["/tmp/custom"]);
      expect(custom.blockedDirectories).toEqual(STRICT_SANDBOX_POLICY.blockedDirectories);
    });

    it("validates policy configurations and detects invalid parameters", () => {
      const validErrors = validatePolicyConfiguration(STRICT_SANDBOX_POLICY);
      expect(validErrors).toEqual([]);

      const invalidPolicy: SandboxPolicyConfig = {
        ...STRICT_SANDBOX_POLICY,
        maxMemoryMb: 0,
        maxExecutionTimeMs: -1,
        maxOutputSizeBytes: 0,
      };
      const errors = validatePolicyConfiguration(invalidPolicy);
      expect(errors.length).toBe(3);
    });
  });

  describe("Boundary Guard & Path Confinement", () => {
    it("permits allowed paths and blocks forbidden directories", () => {
      expect(isPathAllowed("/etc/passwd", STRICT_SANDBOX_POLICY, false)).toBe(false);
      expect(isPathAllowed("/var/log/syslog", STRICT_SANDBOX_POLICY, false)).toBe(false);
      expect(isPathAllowed("/private/etc/hosts", STRICT_SANDBOX_POLICY, false)).toBe(false);

      const customPolicy = createCustomSandboxPolicy({
        allowedDirectories: ["/tmp/app", "/workspace"],
      });

      expect(isPathAllowed("/tmp/app/file.txt", customPolicy, false)).toBe(true);
      expect(isPathAllowed("/tmp/other/file.txt", customPolicy, false)).toBe(false);
    });

    it("blocks path traversal attacks and boundary prefix collisions", () => {
      const customPolicy = createCustomSandboxPolicy({
        allowedDirectories: ["/tmp/app"],
      });

      expect(isPathAllowed("/tmp/app/../../etc/passwd", customPolicy, false)).toBe(false);
      expect(isPathAllowed("/tmp/app/../other/secret.txt", customPolicy, false)).toBe(false);
      expect(isPathAllowed("/tmp/app-rogue/exploit", customPolicy, false)).toBe(false);
      expect(isPathAllowed("/tmp/app/safe/nested.txt", customPolicy, false)).toBe(true);
    });

    it("assertsPathWithinBoundaries throws on violations", () => {
      expect(() => {
        assertPathWithinBoundaries("/etc/shadow", STRICT_SANDBOX_POLICY, false);
      }).toThrow(/Filesystem access violation/);

      expect(() => {
        assertPathWithinBoundaries("/safe/file.txt", READ_ONLY_SANDBOX_POLICY, true);
      }).toThrow(/Filesystem access violation/);
    });

    it("sanitizes environment variables according to policy", () => {
      const rawEnv = {
        PATH: "/usr/bin:/bin",
        HOME: "/home/user",
        AWS_SECRET_ACCESS_KEY: "s",
        GITHUB_TOKEN: "g",
        CUSTOM_VAR: "c",
        MY_API_KEY: "k",
      };
      const strict = sanitizeEnvironmentVariables(rawEnv, STRICT_SANDBOX_POLICY);
      expect(strict.PATH).toBe("/usr/bin:/bin");
      expect(strict.HOME).toBe("/home/user");
      expect(strict.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(strict.GITHUB_TOKEN).toBeUndefined();
      expect(strict.CUSTOM_VAR).toBeUndefined();

      const perm = sanitizeEnvironmentVariables(rawEnv, PERMISSIVE_SANDBOX_POLICY);
      expect(perm.CUSTOM_VAR).toBe("c");
      expect(perm.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(perm.MY_API_KEY).toBeUndefined();
    });

    it("identifies dangerous commands and destructive argument patterns", () => {
      for (const cmd of DANGEROUS_COMMAND_NAMES) {
        expect(isCommandSafe(cmd, [], RESTRICTED_SANDBOX_POLICY)).toBe(false);
      }

      expect(isCommandSafe("/bin/echo", ["hello"], RESTRICTED_SANDBOX_POLICY)).toBe(true);
      expect(isCommandSafe("echo", ["hello"], STRICT_SANDBOX_POLICY)).toBe(false);
      expect(isCommandSafe("rm", ["-rf", "/"], RESTRICTED_SANDBOX_POLICY)).toBe(false);
      expect(isCommandSafe("rm", ["-rf", "/root"], RESTRICTED_SANDBOX_POLICY)).toBe(false);
    });
  });
});
