import type { FlagShape, FlagShapes } from "../arguments.ts";
import type { CommandContext, Flags } from "../options.ts";

export type FlagType = "string" | "int" | "bool";

export interface FlagSpec {
  readonly name: string;
  readonly type: FlagType;
  readonly required: boolean;
  readonly repeatable: boolean;
  readonly default?: string | number | boolean;
  readonly description: string;
}

export interface ExitCodeSpec {
  readonly code: number;
  readonly meaning: string;
}

export type CommandDomain =
  | "plan"
  | "queue"
  | "task"
  | "run"
  | "critic"
  | "summary"
  | "inspection"
  | "orchestrator"
  | "install"
  | "agent"
  | "branch"
  | "orphan"
  | "authority"
  | "diagnostics"
  | "gate";

export type CommandHandler = (
  flags: Flags,
  context: CommandContext,
  remainder: readonly string[],
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly domain: CommandDomain;
  readonly summary: string;
  readonly description: string;
  readonly flags: readonly FlagSpec[];
  readonly readsStdin: boolean;
  readonly takesRemainder: boolean;
  readonly exitCodes: readonly ExitCodeSpec[];
  readonly examples: readonly string[];
  readonly handler: CommandHandler;
}

export const DEFAULT_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - markdown brief on stdout, or JSON when --format json is set" },
  {
    code: 3,
    meaning:
      "INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY / UNSUPPORTED_PLATFORM - rejected before the capsule changed",
  },
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
