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
  type CompletionAudioEvaluationInput,
} from "../../../olt/scripts/src/orchestrator/completion-audio.ts";

const split = (s: string) => s.split(",");
const baseInput: CompletionAudioEvaluationInput = {
  event: "orchestrator:complete",
  tier: "orchestrator",
  runId: "run-001",
};

describe("Orchestrator-Tier Completion Audio & Subagent Anti-Noise Filter", () => {
  test("isOrchestratorTier identifies tiers and rejects subagent roles", () => {
    split(
      "orchestrator,root,supervisor,coordinator,coordinator_authority_cadence,run-supervisor,parent",
    ).forEach((t) => expect(isOrchestratorTier(t)).toBe(true));
    [
      ...split("implementer,implementer_task-p41,validator,mechanic,critic,probe,worker,"),
      undefined,
    ].forEach((r) => expect(isOrchestratorTier(r)).toBe(false));
    expect(isOrchestratorTier("custom-boss", ["custom-boss", "lead"])).toBe(true);
    expect(isOrchestratorTier("orchestrator", ["custom-boss", "lead"])).toBe(false);
  });

  test("isSubagentRole detects subagent roles and rejects orchestrator tiers", () => {
    split(
      "implementer,implementer_task-123,validator,validator_task-456,mechanic-validator,critic,probe,subagent,worker",
    ).forEach((r) => expect(isSubagentRole(r)).toBe(true));
    split("orchestrator,coordinator,supervisor").forEach((r) =>
      expect(isSubagentRole(r)).toBe(false),
    );
  });

  test("isSubagentNoise filters subagent events and allows orchestrator completion", () => {
    split(
      "task:start,task:complete,task:heartbeat,task:claim,task:submit,critic:start,critic:approve,probe:pass,gate:pass,repair:complete,subagent:heartbeat,mind:pulse",
    ).forEach((e) => expect(isSubagentNoise(e)).toBe(true));
    split(
      "orchestrator:complete,orchestrator:converged,run:complete,supervision:complete,loop:complete",
    ).forEach((e) => expect(isSubagentNoise(e)).toBe(false));
    expect(
      isSubagentNoise("custom:finish", {
        taskId: "task-01",
        actor: "implementer_task-01",
        role: "implementer",
      }),
    ).toBe(true);
    expect(
      isSubagentNoise("orchestrator:complete", {
        tier: "orchestrator",
        actor: "orchestrator-main",
        runId: "run-gen3-test",
      }),
    ).toBe(false);
  });

  test("evaluateCompletionAudio handles platform support, noise filtering, and wildcard matching", () => {
    const approved = evaluateCompletionAudio(baseInput, { platform: "darwin" });
    expect(approved.shouldPlay).toBe(true);
    expect(approved.reason).toBe("orchestrator_tier_allowed");
    expect(approved.matchedEvent).toBe("orchestrator:complete");

    expect(evaluateCompletionAudio(baseInput, { enabled: false, platform: "darwin" }).reason).toBe(
      "disabled",
    );
    expect(evaluateCompletionAudio(baseInput, { platform: "win32" }).reason).toBe(
      "platform_unsupported",
    );
    expect(
      evaluateCompletionAudio(baseInput, { platform: "win32", command: "echo test" }).shouldPlay,
    ).toBe(true);

    expect(
      evaluateCompletionAudio(
        { event: "task:complete", taskId: "task-p01", role: "implementer" },
        { platform: "darwin" },
      ).reason,
    ).toBe("subagent_noise_filtered");
    expect(
      evaluateCompletionAudio(
        { event: "orchestrator:complete", role: "implementer" },
        { platform: "darwin" },
      ).reason,
    ).toBe("role_suppressed");

    const cfg: CompletionAudioConfig = {
      platform: "darwin",
      allowedEvents: ["orchestrator:*", "*:success"],
    };
    expect(
      evaluateCompletionAudio({ event: "orchestrator:custom-step", tier: "orchestrator" }, cfg)
        .shouldPlay,
    ).toBe(true);
    expect(
      evaluateCompletionAudio({ event: "pipeline:success", tier: "orchestrator" }, cfg).shouldPlay,
    ).toBe(true);
  });

  test("evaluateCompletionAudio enforces cooldown throttle between consecutive audio chimes", () => {
    const throttled = evaluateCompletionAudio(
      baseInput,
      { platform: "darwin", cooldownMs: 3000 },
      8000,
      10000,
    );
    expect(throttled.shouldPlay).toBe(false);
    expect(throttled.reason).toBe("cooldown_throttled");
    expect(throttled.cooldownRemainingMs).toBe(1000);
    expect(
      evaluateCompletionAudio(baseInput, { platform: "darwin", cooldownMs: 3000 }, 10000, 14000)
        .shouldPlay,
    ).toBe(true);
  });

  test("playCompletionAudioSync validates command safety and audio extensions", () => {
    const r1 = playCompletionAudioSync({ command: "echo 'chime'", silent: true });
    expect(r1.success).toBe(false);
    expect(r1.error).toContain("commandArgv");

    const r2 = playCompletionAudioSync({ commandArgv: ["rm", "-rf", "/tmp/w.wav"], silent: true });
    expect(r2.success).toBe(false);
    expect(r2.error).toContain("not an allowlisted audio player");

    const r3 = playCompletionAudioSync({ commandArgv: ["afplay", "/etc/passwd"], silent: true });
    expect(r3.success).toBe(false);
    expect(r3.error).toContain("recognized audio extension");

    const r4 = playCompletionAudioSync({
      commandArgv: ["afplay", "sounds/chime.wav"],
      silent: true,
    });
    expect(r4.success).toBe(false);
    expect(r4.error).toContain("absolute path");

    const r5 = playCompletionAudioSync({ platform: "freebsd" });
    expect(r5.success).toBe(true);
    expect(r5.command).toBe("noop");
    expect(r5.output).toContain("freebsd audio skipped");
  });

  test("filterCompletionAudioEvents and CompletionAudioManager notify and manage cooldown", async () => {
    const mixed: CompletionAudioEvaluationInput[] = [
      { event: "task:start", role: "implementer" },
      { event: "task:complete", role: "implementer" },
      { event: "gate:pass", role: "validator" },
      { event: "critic:approve", role: "critic" },
      { event: "orchestrator:complete", tier: "orchestrator" },
      { event: "subagent:complete", role: "subagent" },
      { event: "run:complete", tier: "root" },
    ];
    expect(filterCompletionAudioEvents(mixed, { platform: "darwin" }).map((e) => e.event)).toEqual([
      "orchestrator:complete",
      "run:complete",
    ]);

    const mgr = new CompletionAudioManager({
      platform: "darwin",
      commandArgv: ["afplay", "/System/Library/Sounds/Bottle.aiff"],
      player: () => ({ status: 0, stdout: "mock chime" }),
      cooldownMs: 3000,
      silent: true,
    });
    expect(
      (await mgr.notifyCompletion("task:complete", { role: "implementer", taskId: "task-01" }))
        .played,
    ).toBe(false);
    expect(mgr.getLastPlayedAt()).toBe(0);

    expect(
      (await mgr.notifyCompletion("orchestrator:complete", { tier: "orchestrator" }, 100000))
        .played,
    ).toBe(true);
    expect(mgr.getLastPlayedAt()).toBe(100000);

    const throttled = await mgr.notifyCompletion("run:complete", { tier: "orchestrator" }, 101000);
    expect(throttled.played).toBe(false);
    expect(throttled.reason).toBe("cooldown_throttled");

    expect(
      (await mgr.notifyCompletion("run:complete", { tier: "orchestrator" }, 104000)).played,
    ).toBe(true);
    mgr.resetCooldown();
    expect(mgr.getLastPlayedAt()).toBe(0);
  });

  test("exports standard frozen constants", () => {
    expect(DEFAULT_ORCHESTRATOR_TIERS).toContain("orchestrator");
    expect(DEFAULT_SUBAGENT_ROLES).toContain("implementer");
    expect(DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS).toContain("orchestrator:complete");
    expect(DEFAULT_SUPPRESSED_SUBAGENT_EVENTS).toContain("task:complete");
    expect(DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS).toBe(3000);
  });
});
