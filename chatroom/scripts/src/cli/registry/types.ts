export type FlagType = "string" | "int" | "bool";

export type FlagValue = string | true;

export type FlagValues = FlagValue | readonly FlagValue[];

export interface FlagShape {
  readonly takesValue: boolean;
  readonly repeatable: boolean;
}

export type FlagShapes = ReadonlyMap<string, FlagShape>;

export type Flags = Readonly<Record<string, FlagValues>>;

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

export interface CommandContext {
  readonly stdin?: Uint8Array;
  readonly executingRuntime?: string;
  readonly inlinePrompt?: string;
}

export type CommandHandler = (
  flags: Flags,
  context: CommandContext,
  remainder: readonly string[],
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly description: string;
  readonly flags: readonly FlagSpec[];
  readonly readsStdin: boolean;
  readonly takesRemainder: boolean;
  readonly exitCodes: readonly ExitCodeSpec[];
  readonly examples: readonly string[];
  readonly handler: CommandHandler;
}

export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(
    code: string,
    message: string,
    exitCode = code === "NOT_IMPLEMENTED" ? 70 : 3,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export const DEFAULT_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - JSON or formatted output" },
  { code: 3, meaning: "INVALID_ARGUMENT / INVALID_STATE / INTEGRITY" },
  { code: 4, meaning: "LOCK_TIMEOUT" },
  { code: 70, meaning: "NOT_IMPLEMENTED" },
];

export function requiredFlag(name: string, type: FlagType, description: string): FlagSpec {
  return { name, type, required: true, repeatable: false, description };
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
