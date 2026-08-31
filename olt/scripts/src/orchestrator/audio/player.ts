import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { resolveAudioSoundPath } from "../../hooks/dispatcher.ts";
import {
  ALLOWED_AUDIO_PLAYERS,
  AUDIO_FILE_EXTENSIONS,
  AUDIO_PLAYER_CANDIDATE_PATHS,
} from "./constants.ts";
import type { AudioPlayResult, SoundExecutionOptions } from "./types.ts";

function resolveAudioPlayerPath(executable: string): string | undefined {
  for (const candidate of AUDIO_PLAYER_CANDIDATE_PATHS[executable] ?? []) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function renderArgv(argv: readonly string[]): string {
  return argv.join(" ");
}

export function playCompletionAudioSync(options?: SoundExecutionOptions | undefined): {
  readonly success: boolean;
  readonly command: string;
  readonly output?: string | undefined;
  readonly error?: string | undefined;
} {
  const platform = options?.platform ?? process.platform;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const silent = options?.silent ?? false;

  if (options?.command !== undefined && options.command.trim().length > 0) {
    return {
      success: false,
      command: options.command,
      error: `completion audio no longer accepts a raw "command" shell string ("${options.command}"); declare "commandArgv" as an argv array whose first element is an allowlisted audio player (${ALLOWED_AUDIO_PLAYERS.join(", ")}), or pass "sound"/"file" and let the platform default apply.`,
    };
  }

  const attempts: string[][] = [];

  if (options?.commandArgv !== undefined) {
    if (options.commandArgv.length === 0) {
      return {
        success: false,
        command: "",
        error: "commandArgv must not be empty",
      };
    }
    attempts.push([...options.commandArgv]);
  } else if (platform === "darwin") {
    attempts.push(["afplay", resolveAudioSoundPath(options?.sound ?? "Bottle", options?.file)]);
  } else if (platform === "linux") {
    const file =
      options?.file ?? (options?.sound ? `/usr/share/sounds/${options.sound}` : undefined);
    if (file === undefined) {
      return {
        success: true,
        command: "noop",
        output: "No audio file resolved for linux; audio skipped gracefully",
      };
    }
    attempts.push(["paplay", file], ["aplay", file]);
  } else {
    return {
      success: true,
      command: "noop",
      output: `Platform ${platform} audio skipped gracefully`,
    };
  }

  let lastError = "Audio playback failed";
  let lastCommand = "";

  for (const argv of attempts) {
    const executable = argv[0]!;
    lastCommand = renderArgv(argv);

    if (!ALLOWED_AUDIO_PLAYERS.includes(executable)) {
      return {
        success: false,
        command: lastCommand,
        error: `Audio player "${executable}" is not an allowlisted audio player (${ALLOWED_AUDIO_PLAYERS.join(", ")})`,
      };
    }

    const fileArg = argv[1];
    if (fileArg !== undefined) {
      if (!fileArg.startsWith("/")) {
        return {
          success: false,
          command: lastCommand,
          error: `Audio file "${fileArg}" must be an absolute path`,
        };
      }
      const lowered = fileArg.toLowerCase();
      const hasValidExt = AUDIO_FILE_EXTENSIONS.some((ext) => lowered.endsWith(ext));
      if (!hasValidExt) {
        return {
          success: false,
          command: lastCommand,
          error: `Audio file "${fileArg}" does not have a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")})`,
        };
      }
    }

    const resolvedExecutable = resolveAudioPlayerPath(executable);
    if (!resolvedExecutable) {
      lastError = `No executable found for audio player "${executable}"`;
      continue;
    }

    try {
      if (options?.player) {
        const result: AudioPlayResult = options.player(resolvedExecutable, argv.slice(1), {
          timeoutMs,
          silent,
        });
        return {
          success: result.status === 0,
          command: lastCommand,
          ...(result.stdout !== undefined ? { output: result.stdout } : {}),
          ...(result.status !== 0
            ? { error: result.stderr ?? `Exited with status ${result.status}` }
            : {}),
        };
      }

      const child = spawnSync(resolvedExecutable, argv.slice(1), {
        timeout: timeoutMs,
        stdio: silent ? "ignore" : "pipe",
        encoding: "utf-8",
      });

      return {
        success: child.status === 0,
        command: lastCommand,
        ...(child.stdout ? { output: child.stdout } : {}),
        ...(child.status !== 0
          ? { error: child.stderr ?? `Exited with status ${child.status}` }
          : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
    }
  }

  return {
    success: false,
    command: lastCommand,
    error: lastError,
  };
}
