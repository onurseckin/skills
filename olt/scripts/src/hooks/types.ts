export type KnownLifecycleEvent =
  | "orchestrator:start"
  | "orchestrator:complete"
  | "orchestrator:fail"
  | "run:start"
  | "run:complete"
  | "run:fail"
  | "mind:pulse-open"
  | "mind:pulse"
  | "gate:pass"
  | "gate:fail"
  | "task:start"
  | "task:review"
  | "task:complete"
  | "task:fail"
  | "critic:start"
  | "critic:approve"
  | "critic:reject"
  | "repair:start"
  | "repair:complete"
  | "repair:fail";

export type LifecycleEvent = KnownLifecycleEvent | (string & {});

export type HookAction = "shell" | "audio" | "webhook" | "custom";
export type HookActionType = HookAction;

export type CustomHookHandler = (
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
) => Promise<unknown> | unknown;

export interface HookDefinition {
  readonly id?: string | undefined;
  readonly description?: string | undefined;
  readonly events: readonly (LifecycleEvent | string)[];
  readonly action: HookAction;

  readonly sound?: string | undefined;
  readonly file?: string | undefined;
  readonly volume?: number | undefined;

  readonly command?: string | undefined;
  readonly commandArgv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;

  readonly url?: string | undefined;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;

  readonly handler?: CustomHookHandler | undefined;

  readonly platforms?: readonly (NodeJS.Platform | string)[] | undefined;
  readonly enabled?: boolean | undefined;
  readonly timeout_ms?: number | undefined;
  readonly silent?: boolean | undefined;
}

export interface HookResult {
  readonly hookId: string;
  readonly event: LifecycleEvent;
  readonly action: HookAction;
  readonly success: boolean;
  readonly durationMs: number;
  readonly output?: string | undefined;
  readonly error?: string | undefined;
  readonly skipped?: boolean | undefined;
  readonly skipReason?: string | undefined;
}

export interface HookConfig {
  readonly schema?: "harness.hooks_config" | string | undefined;
  readonly version?: number | undefined;
  readonly enabled?: boolean | undefined;
  readonly hooks: readonly HookDefinition[];
  readonly defaultAudioDarwin?: string | undefined;
  readonly defaultAudioLinux?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export type HookShellRefusalRule =
  | "SHELL_STRING_COMMAND_REJECTED"
  | "MISSING_COMMAND_ARGV"
  | "EXECUTABLE_NOT_ALLOWLISTED"
  | "RECURSIVE_DELETE_DETECTED"
  | "FORBIDDEN_COMMANDS_POLICY"
  | "CWD_OUTSIDE_REPOSITORY";

export type HookAudioRefusalRule = "AUDIO_COMMAND_STRING_REJECTED" | "AUDIO_FILE_PATH_INVALID";

export interface ProcessRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string>> | undefined;
    readonly timeoutMs: number;
    readonly captureOutput: boolean;
  },
) => ProcessRunResult;

export type HookCwdResolution =
  | { readonly ok: true; readonly cwd: string }
  | { readonly ok: false; readonly reason: string };
