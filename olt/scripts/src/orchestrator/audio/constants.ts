export const DEFAULT_ORCHESTRATOR_TIERS: readonly string[] = Object.freeze([
  "orchestrator",
  "root",
  "supervisor",
  "coordinator",
  "run-supervisor",
  "parent",
]);

export const DEFAULT_SUBAGENT_ROLES: readonly string[] = Object.freeze([
  "implementer",
  "validator",
  "mechanic",
  "critic",
  "probe",
  "subagent",
  "worker",
  "mechanic-validator",
  "quality-validator",
  "domain-mechanic",
]);

export const DEFAULT_ALLOWED_ORCHESTRATOR_EVENTS: readonly string[] = Object.freeze([
  "orchestrator:complete",
  "orchestrator:converged",
  "orchestrator:success",
  "orchestrator:fail",
  "run:complete",
  "run:fail",
  "loop:complete",
  "loop:converged",
  "supervision:complete",
  "multi-capsule:complete",
]);

export const DEFAULT_SUPPRESSED_SUBAGENT_EVENTS: readonly string[] = Object.freeze([
  "task:start",
  "task:review",
  "task:complete",
  "task:fail",
  "task:heartbeat",
  "task:claim",
  "task:submit",
  "task:reclaim",
  "critic:start",
  "critic:approve",
  "critic:reject",
  "probe:start",
  "probe:pass",
  "probe:fail",
  "gate:start",
  "gate:pass",
  "gate:fail",
  "repair:start",
  "repair:complete",
  "repair:fail",
  "subagent:start",
  "subagent:complete",
  "subagent:heartbeat",
  "mind:pulse",
  "mind:pulse-open",
]);

export const DEFAULT_COMPLETION_AUDIO_COOLDOWN_MS = 3000;

export const AUDIO_PLAYER_CANDIDATE_PATHS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    afplay: ["/usr/bin/afplay"],
    paplay: ["/usr/bin/paplay", "/bin/paplay"],
    aplay: ["/usr/bin/aplay", "/bin/aplay"],
  });

export const ALLOWED_AUDIO_PLAYERS: readonly string[] = Object.freeze(
  Object.keys(AUDIO_PLAYER_CANDIDATE_PATHS),
);

export const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ".aiff",
  ".aif",
  ".wav",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
]);
