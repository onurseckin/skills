export * as config from "./config/index.ts";
export * as dispatcher from "./dispatcher/index.ts";
export * as execution from "./execution/index.ts";
export * as security from "./security/index.ts";

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
} from "./config/index.ts";

export {
  dispatchLifecycleHook,
  dispatchSingleHook,
  isPlatformSupported,
  matchesEvent,
} from "./dispatcher/index.ts";

export {
  executeAudioAction,
  executeCustomAction,
  executeShellAction,
  executeWebhookAction,
  resolveAudioSoundPath,
} from "./execution/index.ts";

export {
  ALLOWED_SHELL_EXECUTABLES,
  buildHookChildEnvironment,
  commandContainsRecursiveDelete,
  findForbiddenCommandMatch,
  isAllowedShellExecutable,
  resolvePinnedHookCwd,
} from "./security/index.ts";

export {
  setupVirtualHooksFS,
  cleanupVirtualHooksFS,
  getVirtualHooksFS,
  scratchRoot,
} from "./fixture.ts";
