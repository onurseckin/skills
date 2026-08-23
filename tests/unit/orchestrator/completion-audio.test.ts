import { describe, expect, test } from "bun:test";
import {
  CompletionAudioManager,
  DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS,
  DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS,
  DEFAULT_ORCHESTRATOR_TIERS,
  DEFAULT_SUBAGENT_ROLES,
  DEFAULT_SUPPRESSED_SUBAGENT_EVENTS,
  evaluateCompletionAudio,
  filterCompletionAudioEvents,
  isOrchestratorTier,
  isSubagentNoise,
  isSubagentRole,
  playCompletionAudioSync,
  type CompletionAudioConfig,
  type CompletionAudioContext,
  type CompletionAudioEvaluationInput,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/completion-audio.ts";

describe("Orchestrator-Tier Completion Audio & Subagent Anti-Noise Filter", () => {
  describe("isOrchestratorTier", () => {
    test("correctly identifies orchestrator authority tiers and roles", () => {
      expect(isOrchestratorTier("orchestrator")).toBe(true);
      expect(isOrchestratorTier("root")).toBe(true);
      expect(isOrchestratorTier("supervisor")).toBe(true);
      expect(isOrchestratorTier("coordinator")).toBe(true);
      expect(isOrchestratorTier("coordinator_authority_cadence")).toBe(true);
      expect(isOrchestratorTier("run-supervisor")).toBe(true);
      expect(isOrchestratorTier("parent")).toBe(true);
    });

    test("rejects subagent or worker roles as orchestrator tiers", () => {
      expect(isOrchestratorTier("implementer")).toBe(false);
      expect(isOrchestratorTier("implementer_task-p41")).toBe(false);
      expect(isOrchestratorTier("validator")).toBe(false);
      expect(isOrchestratorTier("mechanic")).toBe(false);
      expect(isOrchestratorTier("critic")).toBe(false);
      expect(isOrchestratorTier("probe")).toBe(false);
      expect(isOrchestratorTier("worker")).toBe(false);
      expect(isOrchestratorTier(undefined)).toBe(false);
      expect(isOrchestratorTier("")).toBe(false);
    });

    test("supports custom allowed tiers whitelist", () => {
      expect(isOrchestratorTier("custom-boss", ["custom-boss", "lead"])).toBe(true);
      expect(isOrchestratorTier("orchestrator", ["custom-boss", "lead"])).toBe(false);
    });
  });

  describe("isSubagentRole", () => {
    test("detects subagent role names and prefixed agent ids", () => {
      expect(isSubagentRole("implementer")).toBe(true);
      expect(isSubagentRole("implementer_task-123")).toBe(true);
      expect(isSubagentRole("validator")).toBe(true);
      expect(isSubagentRole("validator_task-456")).toBe(true);
      expect(isSubagentRole("mechanic-validator")).toBe(true);
      expect(isSubagentRole("critic")).toBe(true);
      expect(isSubagentRole("probe")).toBe(true);
      expect(isSubagentRole("subagent")).toBe(true);
      expect(isSubagentRole("worker")).toBe(true);
    });

    test("rejects orchestrator roles as subagents", () => {
      expect(isSubagentRole("orchestrator")).toBe(false);
      expect(isSubagentRole("coordinator")).toBe(false);
      expect(isSubagentRole("supervisor")).toBe(false);
      expect(isSubagentRole("root")).toBe(false);
      expect(isSubagentRole(undefined)).toBe(false);
      expect(isSubagentRole("")).toBe(false);
    });
  });

  describe("isSubagentNoise", () => {
    test("flags default suppressed subagent lifecycle events as noise", () => {
      expect(isSubagentNoise("task:start")).toBe(true);
      expect(isSubagentNoise("task:complete")).toBe(true);
      expect(isSubagentNoise("task:heartbeat")).toBe(true);
      expect(isSubagentNoise("task:claim")).toBe(true);
      expect(isSubagentNoise("task:submit")).toBe(true);
      expect(isSubagentNoise("critic:start")).toBe(true);
      expect(isSubagentNoise("critic:approve")).toBe(true);
      expect(isSubagentNoise("probe:pass")).toBe(true);
      expect(isSubagentNoise("gate:pass")).toBe(true);
      expect(isSubagentNoise("repair:complete")).toBe(true);
      expect(isSubagentNoise("subagent:heartbeat")).toBe(true);
      expect(isSubagentNoise("mind:pulse")).toBe(true);
    });

    test("does not flag orchestrator completion events as noise", () => {
      expect(isSubagentNoise("orchestrator:complete")).toBe(false);
      expect(isSubagentNoise("orchestrator:converged")).toBe(false);
      expect(isSubagentNoise("run:complete")).toBe(false);
      expect(isSubagentNoise("supervision:complete")).toBe(false);
      expect(isSubagentNoise("loop:complete")).toBe(false);
    });

    test("flags events from subagent context with taskId as noise", () => {
      const context: CompletionAudioContext = {
        taskId: "task-01",
        actor: "implementer_task-01",
        role: "implementer",
      };
      expect(isSubagentNoise("custom:finish", context)).toBe(true);
    });

    test("permits orchestrator context even if accompanied by metadata", () => {
      const context: CompletionAudioContext = {
        tier: "orchestrator",
        actor: "orchestrator-main",
        runId: "run-gen3-test",
      };
      expect(isSubagentNoise("orchestrator:complete", context)).toBe(false);
    });
  });

  describe("evaluateCompletionAudio", () => {
    const baseInput: CompletionAudioEvaluationInput = {
      event: "orchestrator:complete",
      tier: "orchestrator",
      runId: "run-001",
    };

    test("approves orchestrator completion events with default settings on supported platform", () => {
      const decision = evaluateCompletionAudio(baseInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(true);
      expect(decision.reason).toBe("orchestrator_tier_allowed");
      expect(decision.matchedEvent).toBe("orchestrator:complete");
    });

    test("returns disabled when config.enabled is false", () => {
      const decision = evaluateCompletionAudio(baseInput, { enabled: false, platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("disabled");
    });

    test("returns platform_unsupported on unsupported platforms without custom command", () => {
      const decision = evaluateCompletionAudio(baseInput, { platform: "win32" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("platform_unsupported");
    });

    test("allows execution on any platform if custom command is provided", () => {
      const decision = evaluateCompletionAudio(baseInput, {
        platform: "win32",
        command: "echo test",
      });
      expect(decision.shouldPlay).toBe(true);
    });

    test("filters subagent noise when subagentFilterEnabled is true (default)", () => {
      const taskCompleteInput: CompletionAudioEvaluationInput = {
        event: "task:complete",
        taskId: "task-p01",
        role: "implementer",
      };
      const decision = evaluateCompletionAudio(taskCompleteInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("subagent_noise_filtered");
    });

    test("filters events emitted by subagent roles", () => {
      const subagentInput: CompletionAudioEvaluationInput = {
        event: "orchestrator:complete",
        role: "implementer",
      };
      const decision = evaluateCompletionAudio(subagentInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("role_suppressed");
    });

    test("rejects unsupported non-orchestrator events", () => {
      const unknownEventInput: CompletionAudioEvaluationInput = {
        event: "unknown:random:event",
        tier: "orchestrator",
      };
      const decision = evaluateCompletionAudio(unknownEventInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("unsupported_event");
    });

    test("supports wildcard event matching in allowedEvents", () => {
      const customConfig: CompletionAudioConfig = {
        platform: "darwin",
        allowedEvents: ["orchestrator:*", "*:success"],
      };

      const decision1 = evaluateCompletionAudio(
        { event: "orchestrator:custom-step", tier: "orchestrator" },
        customConfig,
      );
      expect(decision1.shouldPlay).toBe(true);

      const decision2 = evaluateCompletionAudio(
        { event: "pipeline:success", tier: "orchestrator" },
        customConfig,
      );
      expect(decision2.shouldPlay).toBe(true);
    });

    test("enforces cooldown throttle between consecutive audio chimes", () => {
      const now = 10000;
      const lastPlayedAt = 8000; // 2 seconds ago, cooldown is 3000ms
      const decision = evaluateCompletionAudio(
        baseInput,
        { platform: "darwin", cooldownMs: 3000 },
        lastPlayedAt,
        now,
      );

      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("cooldown_throttled");
      expect(decision.cooldownRemainingMs).toBe(1000);
    });

    test("permits playback once cooldown window has elapsed", () => {
      const now = 14000;
      const lastPlayedAt = 10000; // 4 seconds ago, cooldown is 3000ms
      const decision = evaluateCompletionAudio(
        baseInput,
        { platform: "darwin", cooldownMs: 3000 },
        lastPlayedAt,
        now,
      );

      expect(decision.shouldPlay).toBe(true);
      expect(decision.reason).toBe("orchestrator_tier_allowed");
    });
  });

  describe("playCompletionAudioSync", () => {
    test("executes custom shell command safely in test mode", () => {
      const result = playCompletionAudioSync({
        command: "echo 'orchestrator chime'",
        silent: true,
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe("echo 'orchestrator chime'");
    });

    test("gracefully handles unknown non-supported platforms without crashing", () => {
      const result = playCompletionAudioSync({
        platform: "freebsd",
      });
      expect(result.success).toBe(true);
      expect(result.command).toBe("noop");
      expect(result.output).toContain("freebsd audio skipped");
    });

    test("captures command failures gracefully", () => {
      const result = playCompletionAudioSync({
        command: "exit 42",
        silent: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("42");
    });
  });

  describe("filterCompletionAudioEvents", () => {
    test("filters mixed event stream down to only valid orchestrator chime events", () => {
      const mixedEvents: CompletionAudioEvaluationInput[] = [
        { event: "task:start", role: "implementer" },
        { event: "task:complete", role: "implementer" },
        { event: "gate:pass", role: "validator" },
        { event: "critic:approve", role: "critic" },
        { event: "orchestrator:complete", tier: "orchestrator" },
        { event: "subagent:complete", role: "subagent" },
        { event: "run:complete", tier: "root" },
      ];

      const filtered = filterCompletionAudioEvents(mixedEvents, { platform: "darwin" });
      expect(filtered.length).toBe(2);
      expect(filtered.map((e) => e.event)).toEqual(["orchestrator:complete", "run:complete"]);
    });
  });

  describe("CompletionAudioManager", () => {
    test("initializes with default config and tracks play state", () => {
      const manager = new CompletionAudioManager({ platform: "darwin", cooldownMs: 2000 });
      expect(manager.getLastPlayedAt()).toBe(0);
      expect(manager.getConfig().cooldownMs).toBe(2000);
    });

    test("updates configuration dynamically", () => {
      const manager = new CompletionAudioManager({ platform: "darwin" });
      manager.updateConfig({ cooldownMs: 5000, sound: "Glass" });
      expect(manager.getConfig().cooldownMs).toBe(5000);
      expect(manager.getConfig().sound).toBe("Glass");
    });

    test("suppresses subagent notifications and prevents sound playback", async () => {
      const manager = new CompletionAudioManager({
        platform: "darwin",
        command: "echo 'mock chime'",
      });

      const result = await manager.notifyCompletion("task:complete", {
        role: "implementer",
        taskId: "task-01",
      });

      expect(result.played).toBe(false);
      expect(result.reason).toBe("subagent_noise_filtered");
      expect(manager.getLastPlayedAt()).toBe(0);
    });

    test("plays audio chime for orchestrator completion and sets lastPlayedAt", async () => {
      const manager = new CompletionAudioManager({
        platform: "darwin",
        command: "echo 'mock chime'",
        silent: true,
      });

      const timestamp = 50000;
      const result = await manager.notifyCompletion(
        "orchestrator:complete",
        { tier: "orchestrator" },
        timestamp,
      );

      expect(result.played).toBe(true);
      expect(result.reason).toBe("orchestrator_tier_allowed");
      expect(manager.getLastPlayedAt()).toBe(timestamp);
    });

    test("throttles rapid subsequent orchestrator notifications within cooldown", async () => {
      const manager = new CompletionAudioManager({
        platform: "darwin",
        command: "echo 'mock chime'",
        cooldownMs: 3000,
        silent: true,
      });

      const t1 = 100000;
      const res1 = await manager.notifyCompletion(
        "orchestrator:complete",
        { tier: "orchestrator" },
        t1,
      );
      expect(res1.played).toBe(true);

      const t2 = 101000; // 1 second later (cooldown is 3s)
      const res2 = await manager.notifyCompletion("run:complete", { tier: "orchestrator" }, t2);
      expect(res2.played).toBe(false);
      expect(res2.reason).toBe("cooldown_throttled");

      const t3 = 104000; // 4 seconds later (after cooldown)
      const res3 = await manager.notifyCompletion("run:complete", { tier: "orchestrator" }, t3);
      expect(res3.played).toBe(true);
    });

    test("resetCooldown allows immediate notification", async () => {
      const manager = new CompletionAudioManager({
        platform: "darwin",
        command: "echo 'mock chime'",
        cooldownMs: 10000,
        silent: true,
      });

      await manager.notifyCompletion("orchestrator:complete", { tier: "orchestrator" }, 10000);
      expect(manager.getLastPlayedAt()).toBe(10000);

      manager.resetCooldown();
      expect(manager.getLastPlayedAt()).toBe(0);

      const res = await manager.notifyCompletion(
        "orchestrator:complete",
        { tier: "orchestrator" },
        10500,
      );
      expect(res.played).toBe(true);
    });
  });

  describe("Constants Integrity", () => {
    test("exports standard frozen constants", () => {
      expect(DEFAULT_ORCHESTRATOR_TIERS).toContain("orchestrator");
      expect(DEFAULT_SUBAGENT_ROLES).toContain("implementer");
      expect(DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS).toContain("orchestrator:complete");
      expect(DEFAULT_SUPPRESSED_SUBAGENT_EVENTS).toContain("task:complete");
      expect(DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS).toBe(3000);
    });
  });
});
