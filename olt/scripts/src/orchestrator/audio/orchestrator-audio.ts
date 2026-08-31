import { evaluateCompletionAudio } from "./evaluator.ts";
import { playCompletionAudioSync } from "./player.ts";
import type {
  CompletionAudioConfig,
  CompletionAudioContext,
  CompletionAudioEvaluationInput,
  CompletionAudioPlayResult,
  CompletionDecision,
} from "./types.ts";

export class OrchestratorCompletionAudio {
  private config: CompletionAudioConfig;
  private lastPlayedAt = 0;

  public constructor(config: CompletionAudioConfig = {}) {
    this.config = config;
  }

  public getConfig(): CompletionAudioConfig {
    return this.config;
  }

  public updateConfig(newConfig: Partial<CompletionAudioConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public evaluate(
    input: CompletionAudioEvaluationInput,
    now: number = Date.now(),
  ): CompletionDecision {
    return evaluateCompletionAudio(input, this.config, this.lastPlayedAt, now);
  }

  public play(
    input: CompletionAudioEvaluationInput,
    now: number = Date.now(),
  ): CompletionAudioPlayResult {
    const decision = this.evaluate(input, now);

    if (!decision.shouldPlay) {
      return {
        played: false,
        event: input.event,
        reason: decision.reason,
      };
    }

    const playResult = playCompletionAudioSync({
      sound: this.config.sound,
      file: this.config.soundFile,
      command: this.config.command,
      commandArgv: this.config.commandArgv,
      player: this.config.player,
      platform: this.config.platform,
      silent: this.config.silent,
    });

    if (playResult.success) {
      this.lastPlayedAt = now;
    }

    return {
      played: playResult.success,
      event: input.event,
      sound: this.config.sound,
      command: playResult.command,
      reason: decision.reason,
      output: playResult.output,
      error: playResult.error,
    };
  }

  public async notifyCompletion(
    event: string,
    context?: CompletionAudioContext,
    now: number = Date.now(),
  ): Promise<CompletionAudioPlayResult> {
    const input: CompletionAudioEvaluationInput = {
      event,
      actor: context?.actor,
      role: context?.role,
      tier: context?.tier,
      runId: context?.runId,
      taskId: context?.taskId,
      timestamp: now,
    };
    return this.play(input, now);
  }

  public resetCooldown(): void {
    this.lastPlayedAt = 0;
  }

  public getLastPlayedAt(): number {
    return this.lastPlayedAt;
  }
}

export const CompletionAudioManager = OrchestratorCompletionAudio;
