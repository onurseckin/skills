/**
 * P41 Declarative Mechanical Harness Lifecycle Hook Engine - Type Definitions
 */

/**
 * Standard known lifecycle events across the mechanical harness.
 */
export type KnownLifecycleEvent =
  | "orchestrator:start"
  | "orchestrator:complete"
  | "orchestrator:fail"
  | "run:start"
  | "run:complete"
  | "run:fail"
  | "mind:pulse-open"
  | "mind:pulse-close"
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

/**
 * Lifecycle event identifier, supporting both standard known events and arbitrary string events.
 */
export type LifecycleEvent = KnownLifecycleEvent | (string & {});

/**
 * Supported hook action types.
 */
export type HookAction = "shell" | "audio" | "webhook" | "custom";
export type HookActionType = HookAction;

/**
 * Custom in-process hook handler function signature.
 */
export type CustomHookHandler = (
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
) => Promise<unknown> | unknown;

/**
 * Declarative definition for a single lifecycle hook.
 */
export interface HookDefinition {
  /** Unique identifier for the hook */
  readonly id?: string | undefined;
  /** Human-readable description of the hook */
  readonly description?: string | undefined;
  /** List of lifecycle events or wildcard patterns (e.g. "gate:*", "*") that trigger this hook */
  readonly events: readonly (LifecycleEvent | string)[];
  /** Action type to execute */
  readonly action: HookAction;

  // Audio action parameters
  /** Name of system sound (e.g. "Bottle", "Glass", "Hero", "Ping", "Pop") */
  readonly sound?: string | undefined;
  /** Exact path to sound file (e.g. "/System/Library/Sounds/Bottle.aiff") */
  readonly file?: string | undefined;
  /** Volume level multiplier */
  readonly volume?: number | undefined;

  // Shell action parameters
  /** Shell command to execute (e.g. "afplay /System/Library/Sounds/Bottle.aiff") */
  readonly command?: string | undefined;
  /** Working directory for command execution */
  readonly cwd?: string | undefined;
  /** Environment variables passed to command execution */
  readonly env?: Readonly<Record<string, string>> | undefined;

  // Webhook action parameters
  /** URL endpoint to notify */
  readonly url?: string | undefined;
  /** HTTP method (defaults to "POST") */
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  /** Custom HTTP headers for webhook */
  readonly headers?: Readonly<Record<string, string>> | undefined;

  // Custom action parameters
  /** In-process handler callback */
  readonly handler?: CustomHookHandler | undefined;

  // Target platform filtering & runtime control
  /** Platform whitelist (e.g. ["darwin"], ["linux"], ["win32"]). Empty means all platforms. */
  readonly platforms?: readonly (NodeJS.Platform | string)[] | undefined;
  /** Whether the hook is enabled (defaults to true) */
  readonly enabled?: boolean | undefined;
  /** Maximum execution time in milliseconds before timing out */
  readonly timeout_ms?: number | undefined;
  /** Whether to suppress stdout/stderr logs (defaults to false) */
  readonly silent?: boolean | undefined;
}

/**
 * Structured execution result for an individual hook dispatch.
 */
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

/**
 * Root declarative configuration schema for lifecycle hooks.
 */
export interface HookConfig {
  readonly schema?: "harness.hooks_config" | string | undefined;
  readonly version?: number | undefined;
  /** Master switch to enable or disable all hooks */
  readonly enabled?: boolean | undefined;
  /** List of registered hook definitions */
  readonly hooks: readonly HookDefinition[];
  /** Default audio file path on macOS */
  readonly defaultAudioDarwin?: string | undefined;
  /** Default audio file path on Linux */
  readonly defaultAudioLinux?: string | undefined;
  /** Custom metadata dictionary */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}
