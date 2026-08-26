/**
 * P41 Declarative Mechanical Harness Lifecycle Hook Engine
 */

export {
  DEFAULT_DARWIN_AUDIO_COMMAND,
  DEFAULT_DARWIN_SOUND_PATH,
  DEFAULT_HOOK_CONFIG,
  DEFAULT_HOOK_SCHEMA,
  DEFAULT_HOOK_VERSION,
  loadHookConfig,
  parseHookConfig,
  parseHookDefinition,
  resolveHookConfigFile,
  saveHookConfig,
} from "./config.ts";
export {
  commandContainsRecursiveDelete,
  dispatchLifecycleHook,
  dispatchSingleHook,
  executeAudioAction,
  executeCustomAction,
  executeShellAction,
  executeWebhookAction,
  findForbiddenCommandMatch,
  isPlatformSupported,
  matchesEvent,
  resolveAudioSoundPath,
  resolvePinnedHookCwd,
} from "./dispatcher.ts";
export type {
  CustomHookHandler,
  HookAction,
  HookActionType,
  HookConfig,
  HookDefinition,
  HookResult,
  KnownLifecycleEvent,
  LifecycleEvent,
} from "./types.ts";
