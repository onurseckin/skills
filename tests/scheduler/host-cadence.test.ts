import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_HOST_INTERVAL_SECONDS,
  isSchedulerEnabled,
  resolveAgentSchedulerConfig,
  resolveSchedulerCron,
  resolveSchedulerIntervalSeconds,
} from "../../olt/scripts/src/engine/scheduler/host-cadence.ts";
import {
  generateDefaultRepoPolicy,
  type HostType,
  type RepoPolicy,
} from "../../olt/scripts/src/policy/index.ts";

describe("Embedded Schedulers & Host Cadence (Task 2.3)", () => {
  const policy: RepoPolicy = generateDefaultRepoPolicy();

  describe("DEFAULT_HOST_INTERVAL_SECONDS", () => {
    test("defines exact default interval seconds per host profile", () => {
      expect(DEFAULT_HOST_INTERVAL_SECONDS.antigravity).toBe(300);
      expect(DEFAULT_HOST_INTERVAL_SECONDS.claude_code).toBe(900);
      expect(DEFAULT_HOST_INTERVAL_SECONDS.codex).toBe(900);
      expect(DEFAULT_HOST_INTERVAL_SECONDS.cursor).toBe(300);
    });
  });

  describe("mind_supervisor host cadence resolution", () => {
    test("returns 300s interval for antigravity and cursor", () => {
      expect(resolveSchedulerIntervalSeconds("mind_supervisor", "antigravity", policy)).toBe(300);
      expect(resolveSchedulerIntervalSeconds("mind_supervisor", "cursor", policy)).toBe(300);

      const agyConfig = resolveAgentSchedulerConfig("mind_supervisor", "antigravity", policy);
      expect(agyConfig.interval_seconds).toBe(300);
      expect(agyConfig.cron).toBe("*/5 * * * *");
      expect(agyConfig.enabled).toBe(true);

      const cursorConfig = resolveAgentSchedulerConfig("mind_supervisor", "cursor", policy);
      expect(cursorConfig.interval_seconds).toBe(300);
      expect(cursorConfig.cron).toBe("*/5 * * * *");
      expect(cursorConfig.enabled).toBe(true);
    });

    test("returns 900s interval for claude_code and codex", () => {
      expect(resolveSchedulerIntervalSeconds("mind_supervisor", "claude_code", policy)).toBe(900);
      expect(resolveSchedulerIntervalSeconds("mind_supervisor", "codex", policy)).toBe(900);

      const claudeConfig = resolveAgentSchedulerConfig("mind_supervisor", "claude_code", policy);
      expect(claudeConfig.interval_seconds).toBe(900);
      expect(claudeConfig.cron).toBe("*/15 * * * *");
      expect(claudeConfig.enabled).toBe(true);

      const codexConfig = resolveAgentSchedulerConfig("mind_supervisor", "codex", policy);
      expect(codexConfig.interval_seconds).toBe(900);
      expect(codexConfig.cron).toBe("*/15 * * * *");
      expect(codexConfig.enabled).toBe(true);
    });

    test("resolves aliases like 'mind' and 'mind-supervisor'", () => {
      expect(resolveSchedulerIntervalSeconds("mind", "antigravity", policy)).toBe(300);
      expect(resolveSchedulerIntervalSeconds("mind-supervisor", "claude_code", policy)).toBe(900);
      expect(resolveSchedulerCron("mind", "antigravity", policy)).toBe("*/5 * * * *");
      expect(isSchedulerEnabled("mind", "antigravity", policy)).toBe(true);
    });
  });

  describe("autonomic_watchdog host cadence resolution", () => {
    test("returns 300s interval across all hosts for watchdog", () => {
      const hosts: readonly HostType[] = ["antigravity", "claude_code", "codex", "cursor"];
      for (const host of hosts) {
        expect(resolveSchedulerIntervalSeconds("autonomic_watchdog", host, policy)).toBe(300);
        expect(isSchedulerEnabled("autonomic_watchdog", host, policy)).toBe(true);
      }
    });

    test("resolves alias 'watchdog'", () => {
      expect(resolveSchedulerIntervalSeconds("watchdog", "antigravity", policy)).toBe(300);
      expect(isSchedulerEnabled("watchdog", "antigravity", policy)).toBe(true);
    });
  });

  describe("non-scheduled agents handling", () => {
    test("returns enabled: false for roles without scheduler in host policy", () => {
      expect(isSchedulerEnabled("implementer", "antigravity", policy)).toBe(false);
      expect(isSchedulerEnabled("validator_code_quality", "claude_code", policy)).toBe(false);
      expect(isSchedulerEnabled("orchestrator", "codex", policy)).toBe(false);
      expect(isSchedulerEnabled("coordinator", "cursor", policy)).toBe(false);

      const implConfig = resolveAgentSchedulerConfig("implementer", "antigravity", policy);
      expect(implConfig.enabled).toBe(false);
      expect(implConfig.interval_seconds).toBe(300);
      expect(resolveSchedulerCron("implementer", "antigravity", policy)).toBeUndefined();
    });
  });

  describe("custom policy overrides", () => {
    test("respects explicit interval_seconds, cron, and enabled overrides in custom policy", () => {
      const customPolicy: RepoPolicy = {
        ...policy,
        agents: {
          ...policy.agents,
          custom_agent: {
            tier: 3,
            rbac: { can_execute_shell: true, can_edit_code: true },
            hosts: {
              antigravity: {
                model: "gemini-custom",
                model_tier: "high",
                scheduler: {
                  interval_seconds: 60,
                  cron: "*/1 * * * *",
                  enabled: true,
                  jitter_seconds: 5,
                },
              },
              claude_code: {
                model: "claude-custom",
                model_tier: "high",
                scheduler: {
                  interval_seconds: 120,
                  enabled: false,
                },
              },
              codex: {
                model: "gpt-custom",
                model_tier: "high",
              },
              cursor: {
                model: "cursor-custom",
                model_tier: "high",
              },
            },
          },
        },
      };

      expect(resolveSchedulerIntervalSeconds("custom_agent", "antigravity", customPolicy)).toBe(60);
      expect(resolveSchedulerCron("custom_agent", "antigravity", customPolicy)).toBe("*/1 * * * *");
      expect(isSchedulerEnabled("custom_agent", "antigravity", customPolicy)).toBe(true);

      expect(resolveSchedulerIntervalSeconds("custom_agent", "claude_code", customPolicy)).toBe(
        120,
      );
      expect(isSchedulerEnabled("custom_agent", "claude_code", customPolicy)).toBe(false);

      expect(resolveSchedulerIntervalSeconds("custom_agent", "codex", customPolicy)).toBe(900);
      expect(isSchedulerEnabled("custom_agent", "codex", customPolicy)).toBe(false);
    });
  });

  describe("error handling and fail-closed behavior", () => {
    test("throws INVALID_ARGUMENT when role is empty or whitespace", () => {
      expect(() => resolveAgentSchedulerConfig("", "antigravity", policy)).toThrow(HarnessError);
      expect(() => resolveAgentSchedulerConfig("   ", "antigravity", policy)).toThrow(HarnessError);
    });

    test("throws INVALID_ARGUMENT when role cannot be resolved", () => {
      expect(() =>
        resolveAgentSchedulerConfig("unknown_nonexistent_role", "antigravity", policy),
      ).toThrow(HarnessError);
      try {
        resolveAgentSchedulerConfig("unknown_nonexistent_role", "antigravity", policy);
        expect.unreachable("expected throw");
      } catch (err) {
        expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      }
    });

    test("throws INVALID_ARGUMENT when host type is invalid", () => {
      expect(() =>
        resolveAgentSchedulerConfig(
          "mind_supervisor",
          "invalid_host" as unknown as HostType,
          policy,
        ),
      ).toThrow(HarnessError);
    });

    test("throws INTEGRITY when host configuration is missing", () => {
      const corruptPolicy: RepoPolicy = {
        ...policy,
        agents: {
          ...policy.agents,
          broken_agent: {
            tier: 3,
            rbac: { can_execute_shell: true, can_edit_code: true },
            hosts: {} as unknown as Record<
              HostType,
              typeof policy.agents.mind_supervisor.hosts.antigravity
            >,
          },
        },
      };
      expect(() =>
        resolveAgentSchedulerConfig("broken_agent", "antigravity", corruptPolicy),
      ).toThrow(HarnessError);
      try {
        resolveAgentSchedulerConfig("broken_agent", "antigravity", corruptPolicy);
        expect.unreachable("expected throw");
      } catch (err) {
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });

  describe("defaults when host or policy is omitted", () => {
    test("uses loadRepoPolicy and active host resolution", () => {
      const config = resolveAgentSchedulerConfig("mind_supervisor", "antigravity");
      expect(config.interval_seconds).toBe(300);
      expect(config.enabled).toBe(true);

      const interval = resolveSchedulerIntervalSeconds("mind_supervisor", "claude_code");
      expect(interval).toBe(900);
    });
  });
});
