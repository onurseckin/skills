/**
 * Facade for orchestrator completion audio and notification chime management.
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
} from "./audio/index.ts";

export {
  ALLOWED_AUDIO_PLAYERS,
  AUDIO_FILE_EXTENSIONS,
  AUDIO_PLAYER_CANDIDATE_PATHS,
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
  OrchestratorCompletionAudio,
  playCompletionAudioSync,
} from "./audio/index.ts";
