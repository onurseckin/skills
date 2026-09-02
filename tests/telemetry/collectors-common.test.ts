import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  DefaultCollectorEnvironment,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_STORAGE_CACHE_TTL_MS,
  validateStorageCacheFreshness,
} from "../../olt/scripts/src/telemetry/collectors/common.ts";

describe("validateStorageCacheFreshness", () => {
  it("returns fresh for undefined timestamp", () => {
    const res = validateStorageCacheFreshness(undefined);
    expect(res).toEqual({ isFresh: true, ageMs: 0 });
  });

  it("returns fresh for unparseable timestamp string", () => {
    const res = validateStorageCacheFreshness("not-a-valid-date");
    expect(res).toEqual({ isFresh: true, ageMs: 0 });
  });

  it("handles valid number timestamp within freshness window", () => {
    const now = 1_700_000_000_000;
    const res = validateStorageCacheFreshness(now - 5000, now);
    expect(res).toEqual({ isFresh: true, ageMs: 5000 });
  });

  it("handles Date object timestamp", () => {
    const now = 1_700_000_000_000;
    const date = new Date(now - 12_000);
    const res = validateStorageCacheFreshness(date, now);
    expect(res).toEqual({ isFresh: true, ageMs: 12_000 });
  });

  it("handles ISO string timestamp", () => {
    const now = new Date("2026-09-01T12:00:00.000Z").getTime();
    const isoString = "2026-09-01T11:55:00.000Z";
    const res = validateStorageCacheFreshness(isoString, now);
    expect(res).toEqual({ isFresh: true, ageMs: 300_000 });
  });

  it("allows future timestamp within clock skew tolerance", () => {
    const now = 1_700_000_000_000;
    const res = validateStorageCacheFreshness(now + 20_000, now, MAX_STORAGE_CACHE_TTL_MS, 60_000);
    expect(res.isFresh).toBe(true);
    expect(res.ageMs).toBe(0);
  });

  it("rejects future timestamp exceeding clock skew limit", () => {
    const now = 1_700_000_000_000;
    const res = validateStorageCacheFreshness(now + 70_000, now, MAX_STORAGE_CACHE_TTL_MS, 60_000);
    expect(res.isFresh).toBe(false);
    expect(res.reason).toBe("future_clock_skew_exceeded");
    expect(res.ageMs).toBe(-70_000);
  });

  it("rejects stale timestamp exceeding TTL", () => {
    const now = 1_700_000_000_000;
    const ttl = 15 * 60 * 1000;
    const res = validateStorageCacheFreshness(now - ttl - 5000, now, ttl);
    expect(res.isFresh).toBe(false);
    expect(res.reason).toBe("stale_cache_ttl_expired");
    expect(res.ageMs).toBe(ttl + 5000);
  });

  it("uses default TTL and skew constants when omitted", () => {
    expect(MAX_STORAGE_CACHE_TTL_MS).toBe(900_000);
    expect(MAX_FUTURE_CLOCK_SKEW_MS).toBe(60_000);
    const now = Date.now();
    const res = validateStorageCacheFreshness(now - 1000);
    expect(res.isFresh).toBe(true);
  });
});

describe("DefaultCollectorEnvironment - Properties and Fallbacks", () => {
  it("provides default properties when no overrides are given", () => {
    const env = new DefaultCollectorEnvironment();
    expect(env.homedir).toBe(homedir());
    expect(typeof env.env).toBe("object");
    expect(env.activeHost).toBeUndefined();
    expect(env.activeModel).toBeUndefined();
    expect(env.processTree).toBeUndefined();
    expect(env.isolateExternalCaches).toBe(true);
  });

  it("honors constructor overrides for all getters", () => {
    const customTree = ["node", "claude"];
    const env = new DefaultCollectorEnvironment({
      homedir: "/custom/home",
      env: { CUSTOM_VAR: "123" },
      activeHost: "claude_code",
      activeModel: "claude-3-7-sonnet",
      processTree: customTree,
      isolateExternalCaches: false,
    });

    expect(env.homedir).toBe("/custom/home");
    expect(env.env).toEqual({ CUSTOM_VAR: "123" });
    expect(env.activeHost).toBe("claude_code");
    expect(env.activeModel).toBe("claude-3-7-sonnet");
    expect(env.processTree).toEqual(customTree);
    expect(env.isolateExternalCaches).toBe(false);
  });

  it("evaluates isHostActive with activeHost override", () => {
    const env = new DefaultCollectorEnvironment({ activeHost: "antigravity" });
    expect(env.isHostActive("antigravity")).toBe(true);
    expect(env.isHostActive("claude")).toBe(false);
  });

  it("evaluates isHostActive via detectActiveHost when activeHost is unset", () => {
    const env = new DefaultCollectorEnvironment({
      env: { CURSOR_PROJECT_DIR: "/my-cursor-dir" },
    });
    expect(env.isHostActive("cursor")).toBe(true);
    expect(env.isHostActive("codex")).toBe(false);
  });
});

describe("DefaultCollectorEnvironment - Execution & Filesystem Operations", () => {
  it("uses custom exec override when provided", async () => {
    const env = new DefaultCollectorEnvironment({
      exec: async (cmd, args) => ({
        stdout: `mocked ${cmd} ${args.join(" ")}`,
        stderr: "",
        exitCode: 0,
      }),
    });
    const result = await env.exec("echo", ["hello"]);
    expect(result).toEqual({ stdout: "mocked echo hello", stderr: "", exitCode: 0 });
  });

  it("returns null for default exec under test environment", async () => {
    const env = new DefaultCollectorEnvironment();
    const result = await env.exec("echo", ["hello"]);
    expect(result).toBeNull();
  });

  it("executes childProcess when test environment guards are bypassed", async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedBunEnv = process.env.BUN_ENV;
    const savedOltFs = process.env.OLT_VIRTUAL_FS;

    delete process.env.NODE_ENV;
    delete process.env.BUN_ENV;
    delete process.env.OLT_VIRTUAL_FS;

    try {
      const env = new DefaultCollectorEnvironment();
      const result = await env.exec("echo", ["telemetry_exec_probe"]);
      expect(result).not.toBeNull();
      expect(result?.stdout.trim()).toBe("telemetry_exec_probe");
      expect(result?.exitCode).toBe(0);

      const failResult = await env.exec("nonexistent_binary_xyz_12345", []);
      expect(failResult).toBeNull();
    } finally {
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
      if (savedBunEnv !== undefined) process.env.BUN_ENV = savedBunEnv;
      if (savedOltFs !== undefined) process.env.OLT_VIRTUAL_FS = savedOltFs;
    }
  });

  it("uses custom readFile and exists overrides when provided", async () => {
    const env = new DefaultCollectorEnvironment({
      readFile: async (p) => `content of ${p}`,
      exists: async (p) => p.includes("exists"),
    });

    expect(await env.readFile("/test.txt")).toBe("content of /test.txt");
    expect(await env.exists("/file-exists.txt")).toBe(true);
    expect(await env.exists("/file-missing.txt")).toBe(false);
  });

  it("falls back to real fs for readFile and exists", async () => {
    const env = new DefaultCollectorEnvironment();
    const pkgPath = resolve(process.cwd(), "package.json");
    const missingPath = resolve(process.cwd(), "nonexistent-telemetry-file.json");

    const content = await env.readFile(pkgPath);
    expect(typeof content).toBe("string");
    expect(content).toContain("name");

    const missingContent = await env.readFile(missingPath);
    expect(missingContent).toBeNull();

    expect(await env.exists(pkgPath)).toBe(true);
    expect(await env.exists(missingPath)).toBe(false);
  });
});
