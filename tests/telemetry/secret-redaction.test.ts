import { describe, expect, it } from "bun:test";
import {
  ClaudeCollector,
  CodexCollector,
  type CollectorEnvironment,
} from "../../olt/scripts/src/telemetry/collectors/index.ts";
import { deepRedact, isSensitiveKey } from "../../olt/scripts/src/telemetry/redact.ts";

const SECRET_TOKEN = "sk-ant-oat01-ZZZZ9999SUPERSECRETVALUEDONOTLEAK";
const SECRET_EMAIL = "leaked-user@example.com";
const SECRET_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function assertNoLeak(result: unknown, secret: string) {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(secret);
}

describe("deepRedact / isSensitiveKey", () => {
  it("redacts known-sensitive key names regardless of nesting depth", () => {
    const input = {
      outer: {
        middle: {
          inner: {
            api_key: SECRET_TOKEN,
            token: SECRET_TOKEN,
            session_token: SECRET_TOKEN,
            auth_token: SECRET_TOKEN,
            refresh_token: SECRET_TOKEN,
            email: SECRET_EMAIL,
            accountUuid: SECRET_UUID,
            billingType: "stripe",
            planTier: "max",
            harmlessField: "keep-me",
          },
        },
      },
    };

    const redacted = deepRedact(input) as typeof input;
    assertNoLeak(redacted, SECRET_TOKEN);
    assertNoLeak(redacted, SECRET_EMAIL);
    assertNoLeak(redacted, SECRET_UUID);
    expect(redacted.outer.middle.inner.harmlessField).toBe("keep-me");
  });

  it("redacts secret-shaped string values even under an unrecognized key name", () => {
    const input = { someBrandNewFieldNobodyAllowlisted: `Bearer ${SECRET_TOKEN}` };
    const redacted = deepRedact(input) as Record<string, unknown>;
    assertNoLeak(redacted, SECRET_TOKEN);
  });

  it("does not redact ordinary non-sensitive keys", () => {
    expect(isSensitiveKey("plan_type")).toBe(false);
    expect(isSensitiveKey("windowType")).toBe(false);
    expect(isSensitiveKey("resets_at")).toBe(false);
  });

  it("redacts an unenumerated *_API_KEY-shaped field name holding a plain, non-prefixed secret value (CRITICAL: OPENAI_API_KEY normalizes outside the old exact-match blocklist)", () => {
    const PLAIN_SECRET = "zx9Qplm4RvTnKw8LbHs2FdGaYc7Ue1Ni";
    expect(isSensitiveKey("OPENAI_API_KEY")).toBe(true);
    expect(isSensitiveKey("ANTHROPIC_API_KEY")).toBe(true);
    expect(isSensitiveKey("GITHUB_TOKEN")).toBe(true);

    const redacted = deepRedact({
      OPENAI_API_KEY: PLAIN_SECRET,
      tokens: { access_token: PLAIN_SECRET },
      last_refresh: "2026-01-01T00:00:00Z",
    }) as Record<string, unknown>;
    assertNoLeak(redacted, PLAIN_SECRET);
    expect(redacted.last_refresh).toBe("2026-01-01T00:00:00Z");
  });
});

describe("collector secret redaction (invariant: no substring of an injected secret survives probe())", () => {
  it("OpenAI-shaped codex config.toml dump never leaks the embedded api_key value", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".codex/config.toml")) {
          return `[auth]\napi_key = "${SECRET_TOKEN}"\nmodel = "gpt-5"\n`;
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    assertNoLeak(result, SECRET_TOKEN);
  });

  it("Codex auth.json tokens/session_token/auth_token fields never leak their values", async () => {
    const env: CollectorEnvironment = {
      exec: async () => null,
      homedir: "/mock/home",
      readFile: async (path) => {
        if (path.includes(".codex/auth.json")) {
          return JSON.stringify({
            tokens: { access_token: SECRET_TOKEN },
            session_token: SECRET_TOKEN,
            auth_token: SECRET_TOKEN,
            plan_type: "plus",
          });
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    assertNoLeak(result, SECRET_TOKEN);
    expect(JSON.stringify(result)).toContain("plus");
  });

  it("Claude OAuth email/accountUuid/billingType/planTier never leak into the report", async () => {
    const env: CollectorEnvironment = {
      fetchClaudeUsage: async () => ({
        cachedUsageUtilization: {
          utilization: {
            five_hour: { utilization: 25.5 },
          },
        },
        oauthAccount: {
          emailAddress: SECRET_EMAIL,
          accountUuid: SECRET_UUID,
          billingType: "stripe_subscription",
          planTier: "claude_max",
        },
      }),
    };

    const collector = new ClaudeCollector(env);
    const result = await collector.probe();

    expect(result.isDetected).toBe(true);
    assertNoLeak(result, SECRET_EMAIL);
    assertNoLeak(result, SECRET_UUID);
  });
});
