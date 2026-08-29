import type { FlagShape, FlagShapes } from "../arguments.ts";
import type { CommandContext, Flags } from "../options.ts";
import type { ErrorCode } from "../../core/errors/codes.ts";

export type HarnessErrorCode = ErrorCode | "UNKNOWN_ERROR";
export type ErrorSeverity = "fatal" | "error" | "warning" | "info";

export interface CliErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: HarnessErrorCode;
    readonly message: string;
    readonly severity: ErrorSeverity;
    readonly exitCode: number;
    readonly issues?: readonly unknown[];
    readonly fix?: string;
  };
}

export interface CliSuccessEnvelope<T = unknown> {
  readonly ok: true;
  readonly data: T;
}

export type FlagType = "string" | "int" | "bool";

export interface FlagSpec {
  readonly name: string;
  readonly type: FlagType;
  readonly required: boolean;
  readonly repeatable: boolean;
  readonly default?: string | number | boolean;
  readonly description: string;
}

export type CommandFlagSpec = FlagSpec;

export interface ExitCodeSpec {
  readonly code: number;
  readonly meaning: string;
}

export const PRIMARY_VERBS = ["plan", "queue", "task", "run", "doctor", "mind", "msg", "worktree"] as const;
export type PrimaryVerb = (typeof PRIMARY_VERBS)[number];
export type CommandTier = "primary" | "internal";

export type CommandDomain =
  | "plan" | "queue" | "task" | "run" | "critic" | "summary" | "inspection"
  | "orchestrator" | "install" | "agent" | "branch" | "orphan" | "authority"
  | "diagnostics" | "reporting" | "gate" | "capture" | "mind" | "doctor"
  | "policy" | "msg" | "worktree" | "sched" | "role" | "hygiene" | "defect";

export type CommandHandler = (
  flags: Flags,
  context: CommandContext,
  remainder: readonly string[],
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface CommandAuthoritySpec {
  readonly requiresActingIdentity: true;
  readonly authorityRunFlag: "authority-run";
  readonly allowedRoles: readonly string[];
  readonly constrainedPathFlags?: readonly string[];
}

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly domain: CommandDomain;
  readonly tier?: CommandTier;
  readonly internal?: boolean;
  readonly summary: string;
  readonly description: string;
  readonly flags: readonly FlagSpec[];
  readonly readsStdin: boolean;
  readonly takesRemainder: boolean;
  readonly exitCodes: readonly ExitCodeSpec[];
  readonly examples: readonly string[];
  readonly authority?: CommandAuthoritySpec;
  readonly handler: CommandHandler;
}

export function isInternalCommand(spec: CommandSpec): boolean {
  if (spec.internal !== undefined) return spec.internal;
  if (spec.tier !== undefined) return spec.tier === "internal";
  if (spec.domain === "doctor" || spec.name === "doctor" || spec.name.startsWith("doctor:")) return false;
  return !(PRIMARY_VERBS as readonly string[]).includes(spec.domain);
}

export function isPrimaryCommand(spec: CommandSpec): boolean {
  return !isInternalCommand(spec);
}

export function commandTier(spec: CommandSpec): CommandTier {
  return isInternalCommand(spec) ? "internal" : "primary";
}

export const DEFAULT_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - markdown brief on stdout, or JSON when --format json is set" },
  { code: 3, meaning: "INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY / UNSUPPORTED_PLATFORM - rejected before the capsule changed" },
  { code: 4, meaning: "LOCK_TIMEOUT - the capsule lock was still held at the deadline" },
  { code: 70, meaning: "NOT_IMPLEMENTED, or an unexpected failure the harness did not classify" },
];

export function requiredFlag(name: string, type: FlagType, description: string): FlagSpec {
  return { name, type, required: true, repeatable: false, description };
}

export function repeatableFlag(name: string, type: FlagType, description: string): FlagSpec {
  return { name, type, required: false, repeatable: true, description };
}

export function flagShapes(flags: readonly FlagSpec[]): FlagShapes {
  const shapes = new Map<string, FlagShape>();
  for (const flag of flags) {
    shapes.set(flag.name, { takesValue: flag.type !== "bool", repeatable: flag.repeatable });
  }
  return shapes;
}

export function optionalFlag(
  name: string,
  type: FlagType,
  description: string,
  defaultValue?: string | number | boolean,
): FlagSpec {
  return {
    name,
    type,
    required: false,
    repeatable: false,
    description,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}
