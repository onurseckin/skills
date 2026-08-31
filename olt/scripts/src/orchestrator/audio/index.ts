/**
 * Explicit named facade for the audio and notification domain.
 */

export type {
  AudioPlayer,
  AudioPlayResult,
  CompletionAudioConfig,
  CompletionAudioContext,
  CompletionAudioEvaluationInput,
  CompletionAudioPlayResult,
  CompletionDecision,
  CompletionDecisionReason,
  SoundExecutionOptions,
} from "./types.ts";

export {
  ALLOWED_AUDIO_PLAYERS,
  AUDIO_FILE_EXTENSIONS,
  AUDIO_PLAYER_CANDIDATE_PATHS,
  DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS,
  DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS,
  DEFAULT_ORCHESTRATOR_TIERS,
  DEFAULT_SUBAGENT_ROLES,
  DEFAULT_SUPPRESSED_SUBAGENT_EVENTS,
} from "./constants.ts";

export { playCompletionAudioSync } from "./player.ts";
export {
  evaluateCompletionAudio,
  filterCompletionAudioEvents,
  isOrchestratorTier,
  isSubagentNoise,
  isSubagentRole,
} from "./evaluator.ts";
export { CompletionAudioManager, OrchestratorCompletionAudio } from "./orchestrator-audio.ts";
