import type { HookConfig } from "../types.ts";

export const DEFAULT_DARWIN_SOUND_PATH = "/System/Library/Sounds/Bottle.aiff";
export const DEFAULT_DARWIN_AUDIO_COMMAND = `afplay ${DEFAULT_DARWIN_SOUND_PATH}`;
export const DEFAULT_HOOK_SCHEMA = "harness.hooks_config";
export const DEFAULT_HOOK_VERSION = 1;

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  schema: DEFAULT_HOOK_SCHEMA,
  version: DEFAULT_HOOK_VERSION,
  enabled: true,
  hooks: [
    {
      id: "builtin-orchestrator-complete-audio",
      description: "Audio chime on orchestrator completion",
      events: ["orchestrator:complete"],
      action: "audio",
      sound: "Bottle",
      file: DEFAULT_DARWIN_SOUND_PATH,
      platforms: ["darwin"],
      enabled: true,
    },
    {
      id: "builtin-run-complete-audio",
      description: "Audio chime on run completion",
      events: ["run:complete"],
      action: "audio",
      sound: "Bottle",
      file: DEFAULT_DARWIN_SOUND_PATH,
      platforms: ["darwin"],
      enabled: true,
    },
  ],
  defaultAudioDarwin: DEFAULT_DARWIN_SOUND_PATH,
};
