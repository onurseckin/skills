import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import { DefaultCollectorEnvironment } from "../../../olt/scripts/src/telemetry/collectors/common.ts";

describe("DefaultCollectorEnvironment - fetchUserStatus", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checks hasFetchUserStatusOverride and uses custom override", async () => {
    const envNoOverride = new DefaultCollectorEnvironment();
    expect(envNoOverride.hasFetchUserStatusOverride).toBe(false);

    const envWithOverride = new DefaultCollectorEnvironment({
      fetchUserStatus: async (port: string) => ({ port, status: "mocked" }),
    });
    expect(envWithOverride.hasFetchUserStatusOverride).toBe(true);
    expect(await envWithOverride.fetchUserStatus("8080")).toEqual({
      port: "8080",
      status: "mocked",
    });
  });

  it("returns null when readFile override is present or port is 0 or mock", async () => {
    const envWithReadFile = new DefaultCollectorEnvironment({
      readFile: async () => "content",
    });
    expect(await envWithReadFile.fetchUserStatus("8080")).toBeNull();

    const env = new DefaultCollectorEnvironment();
    expect(await env.fetchUserStatus("0")).toBeNull();
    expect(await env.fetchUserStatus("mock")).toBeNull();
  });

  it("fetches user status via network fetch successfully", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ user: "test-user", quota: 100 }),
    })) as unknown as typeof fetch;

    const env = new DefaultCollectorEnvironment();
    const result = await env.fetchUserStatus("12345");
    expect(result).toEqual({ user: "test-user", quota: 100 });
  });

  it("returns null when network fetch returns non-ok or throws", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const env = new DefaultCollectorEnvironment();
    expect(await env.fetchUserStatus("12345")).toBeNull();

    globalThis.fetch = (async () => {
      throw new Error("Network unreachable");
    }) as unknown as typeof fetch;
    expect(await env.fetchUserStatus("12345")).toBeNull();
  });
});

describe("DefaultCollectorEnvironment - fetchClaudeUsage & Fixture", () => {
  const originalFetch = globalThis.fetch;
  const tempDir = join(tmpdir(), `claude-test-${Date.now()}`);

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("checks hasFetchClaudeUsageOverride and uses custom override", async () => {
    const envNoOverride = new DefaultCollectorEnvironment();
    expect(envNoOverride.hasFetchClaudeUsageOverride).toBe(false);

    const envWithOverride = new DefaultCollectorEnvironment({
      fetchClaudeUsage: async () => ({ custom: "claude" }),
    });
    expect(envWithOverride.hasFetchClaudeUsageOverride).toBe(true);
    expect(await envWithOverride.fetchClaudeUsage()).toEqual({ custom: "claude" });
  });

  it("returns null for fetchClaudeUsage when readFile override is present", async () => {
    const env = new DefaultCollectorEnvironment({ readFile: async () => "content" });
    expect(await env.fetchClaudeUsage()).toBeNull();
  });

  it("reads utilization from .claude.json in homedir", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, ".claude.json"),
      JSON.stringify({ cachedUsageUtilization: { five_hour: 0.4 } }),
    );

    const env = new DefaultCollectorEnvironment({ homedir: tempDir });
    const usage = await env.fetchClaudeUsage();
    expect(usage).toEqual({ cachedUsageUtilization: { five_hour: 0.4 } });
  });

  it("fetches Claude usage via OAuth token when .claude.json is absent", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ five_hour_utilization: 0.65 }),
    })) as unknown as typeof fetch;

    const env = new DefaultCollectorEnvironment({
      homedir: "/nonexistent-path-for-claude",
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oauth-token" },
    });

    const usage = await env.fetchClaudeUsage();
    expect(usage).toEqual({
      cachedUsageUtilization: { utilization: { five_hour_utilization: 0.65 } },
    });
  });

  it("returns null when OAuth fetch fails or token is missing", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const envWithToken = new DefaultCollectorEnvironment({
      homedir: "/nonexistent-path-for-claude",
      env: { ANTHROPIC_OAUTH_TOKEN: "sk-ant-token" },
    });
    expect(await envWithToken.fetchClaudeUsage()).toBeNull();

    const envNoToken = new DefaultCollectorEnvironment({
      homedir: "/nonexistent-path-for-claude",
      env: {},
    });
    expect(await envNoToken.fetchClaudeUsage()).toBeNull();
  });

  it("reads sample fixture via fetchClaudeFixture", async () => {
    const env = new DefaultCollectorEnvironment();
    const fixture = await env.fetchClaudeFixture();
    if (fixture !== null) {
      expect(typeof fixture).toBe("object");
    }
  });
});

describe("DefaultCollectorEnvironment - fetchCodexUsage", () => {
  const tempDir = join(tmpdir(), `codex-test-${Date.now()}`);

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("checks hasFetchCodexUsageOverride and uses custom override", async () => {
    const envNoOverride = new DefaultCollectorEnvironment();
    expect(envNoOverride.hasFetchCodexUsageOverride).toBe(false);

    const envWithOverride = new DefaultCollectorEnvironment({
      fetchCodexUsage: async () => ({ codex: "ok" }),
    });
    expect(envWithOverride.hasFetchCodexUsageOverride).toBe(true);
    expect(await envWithOverride.fetchCodexUsage()).toEqual({ codex: "ok" });
  });

  it("returns null for fetchCodexUsage when readFile override is present", async () => {
    const env = new DefaultCollectorEnvironment({ readFile: async () => "file" });
    expect(await env.fetchCodexUsage()).toBeNull();
  });

  it("parses token_count and rate_limits from rollout session files", async () => {
    const sessionsDir = join(tempDir, ".codex", "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const rolloutContent = [
      "invalid-json-line",
      JSON.stringify({ type: "other_event", payload: {} }),
      JSON.stringify({
        type: "session_state",
        payload: { type: "token_count", total_tokens: 4200 },
      }),
    ].join("\n");

    await writeFile(join(sessionsDir, "rollout-2026-09-01T12-00-00.jsonl"), rolloutContent);

    const env = new DefaultCollectorEnvironment({ homedir: tempDir });
    const usage = await env.fetchCodexUsage();
    expect(usage).toEqual({
      type: "session_state",
      payload: { type: "token_count", total_tokens: 4200 },
    });
  });

  it("returns null when sessions directory does not exist or has no rollout matches", async () => {
    const env = new DefaultCollectorEnvironment({
      homedir: join(tempDir, "missing-codex-dir"),
    });
    expect(await env.fetchCodexUsage()).toBeNull();
  });
});
