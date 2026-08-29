import { DEFAULT_DARWIN_SOUND_PATH } from "./config/constants.ts";
import { defaultProcessRunner, formatHookRefusal } from "./shell.ts";
import type { HookDefinition, ProcessRunner } from "./types.ts";

const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ".aiff",
  ".wav",
  ".mp3",
  ".m4a",
  ".caf",
  ".au",
]);

export function resolveAudioSoundPath(
  sound?: string | undefined,
  file?: string | undefined,
): string {
  if (file !== undefined && file.trim().length > 0) {
    return file.trim();
  }
  if (sound !== undefined && sound.trim().length > 0) {
    const trimmed = sound.trim();
    if (trimmed.startsWith("/") || trimmed.includes(".")) {
      return trimmed;
    }
    return `/System/Library/Sounds/${trimmed}.aiff`;
  }
  return DEFAULT_DARWIN_SOUND_PATH;
}

export function isValidAudioFilePath(candidate: string): boolean {
  if (!candidate.startsWith("/")) {
    return false;
  }
  const lower = candidate.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function executeAudioAction(
  hook: HookDefinition,
  currentPlatform: string = process.platform,
  runner: ProcessRunner = defaultProcessRunner,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.command !== undefined && hook.command.trim().length > 0) {
    return {
      success: false,
      error: formatHookRefusal(
        "AUDIO_COMMAND_STRING_REJECTED",
        `audio hooks no longer accept a raw "command" shell string ("${hook.command}"); declare "sound" and/or "file" instead, e.g. { "action": "audio", "sound": "Bottle" }.`,
      ),
    };
  }

  if (currentPlatform === "darwin") {
    const soundPath = resolveAudioSoundPath(hook.sound, hook.file);
    if (!isValidAudioFilePath(soundPath)) {
      return {
        success: false,
        error: formatHookRefusal(
          "AUDIO_FILE_PATH_INVALID",
          `resolved audio path "${soundPath}" is not an absolute path ending in a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")}).`,
        ),
      };
    }
    try {
      const result = runner("afplay", [soundPath], {
        timeoutMs: hook.timeout_ms ?? 5000,
        captureOutput: hook.silent !== true,
      });

      if (result.status === 0) {
        return { success: true, output: `Played audio: ${soundPath}` };
      }
      const err = result.stderr.trim();
      return { success: false, error: err.length > 0 ? err : "Audio playback failed" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (currentPlatform === "linux") {
    const file =
      hook.file !== undefined
        ? hook.file
        : hook.sound !== undefined
          ? `/usr/share/sounds/${hook.sound}`
          : undefined;

    if (file === undefined) {
      process.stdout.write(" ");
      return { success: true, output: "Played terminal bell" };
    }

    if (!isValidAudioFilePath(file)) {
      return {
        success: false,
        error: formatHookRefusal(
          "AUDIO_FILE_PATH_INVALID",
          `resolved audio path "${file}" is not an absolute path ending in a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")}).`,
        ),
      };
    }

    try {
      for (const player of ["paplay", "aplay"]) {
        const result = runner(player, [file], {
          timeoutMs: hook.timeout_ms ?? 5000,
          captureOutput: false,
        });
        if (result.status === 0) {
          return { success: true, output: "Played Linux audio notification" };
        }
      }
      return { success: false, error: "Audio playback failed on paplay and aplay" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    success: true,
    output: `Audio action skipped on platform: ${currentPlatform}`,
  };
}
