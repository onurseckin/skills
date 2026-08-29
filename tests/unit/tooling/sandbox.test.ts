import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DANGEROUS_COMMAND_NAMES,
  DynamicExecutionSandbox,
  IsolatedChildProcessManager,
  PERMISSIVE_SANDBOX_POLICY,
  READ_ONLY_SANDBOX_POLICY,
  RESTRICTED_SANDBOX_POLICY,
  STRICT_SANDBOX_POLICY,
  assertPathWithinBoundaries,
  createCustomSandboxPolicy,
  getGlobalExecutionSandbox,
  isCommandSafe,
  isPathAllowed,
  resetGlobalExecutionSandbox,
  resolveSandboxPolicy,
  sanitizeEnvironmentVariables,
  spawnIsolatedProcess,
  validatePolicyConfiguration,
  type SandboxPolicyConfig,
} from "../../../olt/scripts/src/tooling/index.ts";

describe("Dynamic Tool Sandboxing & Execution Isolation Suite", () => {
  beforeEach(() => {
    resetGlobalExecutionSandbox();
  });

  afterEach(() => {
    resetGlobalExecutionSandbox();
  });

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
        AWS_SECRET_ACCESS_KEY: "secret123",
        GITHUB_TOKEN: "ghp_12345",
        CUSTOM_VAR: "custom_value",
        MY_API_KEY: "api_key_secret",
      };

      const strictSanitized = sanitizeEnvironmentVariables(rawEnv, STRICT_SANDBOX_POLICY);
      expect(strictSanitized.PATH).toBe("/usr/bin:/bin");
      expect(strictSanitized.HOME).toBe("/home/user");
      expect(strictSanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(strictSanitized.GITHUB_TOKEN).toBeUndefined();
      expect(strictSanitized.CUSTOM_VAR).toBeUndefined();

      const permissiveSanitized = sanitizeEnvironmentVariables(rawEnv, PERMISSIVE_SANDBOX_POLICY);
      expect(permissiveSanitized.CUSTOM_VAR).toBe("custom_value");
      expect(permissiveSanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(permissiveSanitized.MY_API_KEY).toBeUndefined();
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

  describe("Isolated Child Process Management", () => {
    it("executes standard command and captures stdout", async () => {
      const result = await spawnIsolatedProcess("echo", ["hello-sandbox"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello-sandbox");
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("pipes stdin into subprocess", async () => {
      const result = await spawnIsolatedProcess("cat", [], { stdin: "streamed-input" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("streamed-input");
    });

    it("terminates long-running process when timeout is reached", async () => {
      const manager = new IsolatedChildProcessManager();
      const result = await manager.runIsolated("sleep", ["5"], { timeoutMs: 100 });
      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);
    });

    it("terminates process on AbortSignal trigger", async () => {
      const controller = new AbortController();
      const manager = new IsolatedChildProcessManager();
      const promise = manager.runIsolated("sleep", ["5"], { abortSignal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      const result = await promise;
      expect(result.killed).toBe(true);
    });

    it("truncates output when maxBufferBytes is exceeded", async () => {
      const result = await spawnIsolatedProcess("echo", ["12345678901234567890"], {
        maxBufferBytes: 5,
      });
      expect(result.stdout).toContain("[STDOUT TRUNCATED: MAX BUFFER EXCEEDED]");
    });
  });

  describe("Dynamic Execution Sandbox Engine", () => {
    it("executes in-memory async functions within boundary constraints", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(async () => 42 * 2);
      expect(res.success).toBe(true);
      expect(res.result).toBe(84);
      expect(res.timedOut).toBe(false);
      expect(res.violations).toEqual([]);
    });

    it("enforces timeout on hanging in-memory functions", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(
        () => new Promise((r) => setTimeout(r, 500)),
        { timeoutMs: 50 },
      );
      expect(res.success).toBe(false);
      expect(res.timedOut).toBe(true);
      expect(res.error).toContain("timed out");
    });

    it("catches function errors and returns structured failure", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(() => {
        throw new Error("Internal tool failure");
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Internal tool failure");
    });

    it("blocks execution when working directory violates boundary policy", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(async () => "ok", {
        workingDir: "/etc",
        isolationLevel: "strict",
      });
      expect(res.success).toBe(false);
      expect(res.violations.length).toBe(1);
      expect(res.violations[0]?.rule).toBe("PATH_BOUNDARY_VIOLATION");
    });

    it("executes subprocess command through sandbox with safety checks", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeCommand("echo", ["sandboxed-run"], {
        isolationLevel: "restricted",
      });
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("sandboxed-run");

      const blockedRes = await sandbox.executeCommand("sudo", ["whoami"], {
        isolationLevel: "restricted",
      });
      expect(blockedRes.exitCode).toBe(126);
      expect(blockedRes.stderr).toContain("prohibited");
      expect(sandbox.getViolations().length).toBe(1);
    });

    it("manages global singleton sandbox lifecycle", () => {
      const s1 = getGlobalExecutionSandbox();
      const s2 = getGlobalExecutionSandbox();
      expect(s1).toBe(s2);

      resetGlobalExecutionSandbox();
      const fresh = getGlobalExecutionSandbox();
      expect(fresh).not.toBe(s1);
    });
  });
});
