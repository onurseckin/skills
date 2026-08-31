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
} from "../../../olt/scripts/src/orchestrator/completion-audio.ts";

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
      expect(isSubagentRole("orchestrator")).toBe(false);
      expect(isSubagentRole("coordinator")).toBe(false);
      expect(isSubagentRole("supervisor")).toBe(false);
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
      const decision = evaluateCompletionAudio(baseInput, { platform: "win32", command: "echo test" });
      expect(decision.shouldPlay).toBe(true);
    });

    test("filters subagent noise when subagentFilterEnabled is true", () => {
      const taskInput: CompletionAudioEvaluationInput = {
        event: "task:complete",
        taskId: "task-p01",
        role: "implementer",
      };
      const decision = evaluateCompletionAudio(taskInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("subagent_noise_filtered");
    });

    test("filters events emitted by subagent roles", () => {
      const subagentInput: CompletionAudioEvaluationInput = { event: "orchestrator:complete", role: "implementer" };
      const decision = evaluateCompletionAudio(subagentInput, { platform: "darwin" });
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("role_suppressed");
    });

    test("supports wildcard event matching in allowedEvents", () => {
      const customConfig: CompletionAudioConfig = {
        platform: "darwin",
        allowedEvents: ["orchestrator:*", "*:success"],
      };
      expect(evaluateCompletionAudio({ event: "orchestrator:custom-step", tier: "orchestrator" }, customConfig).shouldPlay).toBe(true);
      expect(evaluateCompletionAudio({ event: "pipeline:success", tier: "orchestrator" }, customConfig).shouldPlay).toBe(true);
    });

    test("enforces cooldown throttle between consecutive audio chimes", () => {
      const now = 10000;
      const lastPlayedAt = 8000;
      const decision = evaluateCompletionAudio(baseInput, { platform: "darwin", cooldownMs: 3000 }, lastPlayedAt, now);
      expect(decision.shouldPlay).toBe(false);
      expect(decision.reason).toBe("cooldown_throttled");
      expect(decision.cooldownRemainingMs).toBe(1000);

      const decision2 = evaluateCompletionAudio(baseInput, { platform: "darwin", cooldownMs: 3000 }, 10000, 14000);
      expect(decision2.shouldPlay).toBe(true);
    });
  });

  describe("playCompletionAudioSync", () => {
    test("refuses raw shell command string and non-allowlisted players", () => {
      const res1 = playCompletionAudioSync({ command: "echo 'chime'", silent: true });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("commandArgv");

      const res2 = playCompletionAudioSync({ commandArgv: ["rm", "-rf", "/tmp/w.wav"], silent: true });
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("not an allowlisted audio player");
    });

    test("refuses non-audio extensions and relative paths", () => {
      const res1 = playCompletionAudioSync({ commandArgv: ["afplay", "/etc/passwd"], silent: true });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("recognized audio extension");

      const res2 = playCompletionAudioSync({ commandArgv: ["afplay", "sounds/chime.wav"], silent: true });
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("absolute path");
    });

    test("gracefully handles unknown non-supported platforms without crashing", () => {
      const result = playCompletionAudioSync({ platform: "freebsd" });
      expect(result.success).toBe(true);
      expect(result.command).toBe("noop");
      expect(result.output).toContain("freebsd audio skipped");
    });
  });

  describe("filterCompletionAudioEvents & CompletionAudioManager", () => {
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

    test("suppresses subagent notifications and tracks playback with cooldown in manager", async () => {
      const manager = new CompletionAudioManager({
        platform: "darwin",
        commandArgv: ["afplay", "/System/Library/Sounds/Bottle.aiff"],
        player: () => ({ status: 0, stdout: "mock chime" }),
        cooldownMs: 3000,
        silent: true,
      });

      const subResult = await manager.notifyCompletion("task:complete", { role: "implementer", taskId: "task-01" });
      expect(subResult.played).toBe(false);
      expect(manager.getLastPlayedAt()).toBe(0);

      const res1 = await manager.notifyCompletion("orchestrator:complete", { tier: "orchestrator" }, 100000);
      expect(res1.played).toBe(true);
      expect(manager.getLastPlayedAt()).toBe(100000);

      const res2 = await manager.notifyCompletion("run:complete", { tier: "orchestrator" }, 101000);
      expect(res2.played).toBe(false);
      expect(res2.reason).toBe("cooldown_throttled");

      const res3 = await manager.notifyCompletion("run:complete", { tier: "orchestrator" }, 104000);
      expect(res3.played).toBe(true);

      manager.resetCooldown();
      expect(manager.getLastPlayedAt()).toBe(0);
    });

    test("exports standard frozen constants", () => {
      expect(DEFAULT_ORCHESTRATOR_TIERS).toContain("orchestrator");
      expect(DEFAULT_SUBAGENT_ROLES).toContain("implementer");
      expect(DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS).toContain("orchestrator:complete");
      expect(DEFAULT_SUPPRESSED_SUBAGENT_EVENTS).toContain("task:complete");
      expect(DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS).toBe(3000);
    });
  });
});
