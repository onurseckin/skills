export type FlagType = "string" | "int" | "bool";
export type FlagValue = string | true;
export type FlagValues = FlagValue | readonly FlagValue[];
export type Flags = Readonly<Record<string, FlagValues>>;

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

function levenshteinDistance(source: string, target: string): number {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const distances = Array.from<number>({ length: rows * cols });
  for (let row = 0; row < rows; row += 1) {
    distances[row * cols] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    distances[col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = source[row - 1] === target[col - 1] ? 0 : 1;
      const deletion = (distances[(row - 1) * cols + col] ?? 0) + 1;
      const insertion = (distances[row * cols + col - 1] ?? 0) + 1;
      const substitution = (distances[(row - 1) * cols + col - 1] ?? 0) + substitutionCost;
      distances[row * cols + col] = Math.min(deletion, insertion, substitution);
    }
  }
  return distances[(rows - 1) * cols + (cols - 1)] ?? 0;
}

function nearestFlagName(flagName: string, candidates: readonly string[]): string | undefined {
  let bestCandidate: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dist = levenshteinDistance(flagName, candidate);
    if (dist < bestDistance && dist <= 3) {
      bestDistance = dist;
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

function given(flags: Flags, name: string): FlagValues | undefined {
  return Object.hasOwn(flags, name) ? flags[name] : undefined;
}

function occurrences(value: FlagValues): readonly FlagValue[] {
  if (typeof value === "string" || value === true) {
    return [value];
  }
  return value;
}

function isMulti(value: FlagValues): boolean {
  return typeof value !== "string" && value !== true;
}

export function assertFlags(flags: Flags, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  const unknown = Object.keys(flags).filter((name) => !permitted.has(name));
  if (unknown.length === 0) {
    return;
  }
  const target = unknown[0];
  if (target === undefined) {
    return;
  }
  const suggestion = nearestFlagName(target, allowed);
  const hint = suggestion === undefined ? "" : `; did you mean ${suggestion}?`;
  throw new CliError("INVALID_ARGUMENT", `unknown option: --${target}${hint}`, 3);
}

export function textFlag(flags: Flags, name: string, required = false): string | undefined {
  const value = given(flags, name);
  if (value === undefined) {
    if (required) {
      throw new CliError("INVALID_ARGUMENT", `--${name} is required`, 3);
    }
    return undefined;
  }
  if (isMulti(value)) {
    throw new CliError("INVALID_ARGUMENT", `--${name} is repeatable; read it as a list`, 3);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new CliError("INVALID_ARGUMENT", `--${name} must have a non-blank value`, 3);
  }
  return value;
}

export function listFlag(
  flags: Flags,
  name: string,
  required = false,
): readonly string[] | undefined {
  const value = given(flags, name);
  if (value === undefined) {
    if (required) {
      throw new CliError("INVALID_ARGUMENT", `--${name} is required`, 3);
    }
    return undefined;
  }
  const entries = occurrences(value);
  const results: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new CliError("INVALID_ARGUMENT", `--${name} must have a non-blank value`, 3);
    }
    results.push(entry);
  }
  return results;
}

export function boolFlag(flags: Flags, name: string): boolean {
  const value = given(flags, name);
  if (value === undefined) {
    return false;
  }
  if (value !== true) {
    throw new CliError("INVALID_ARGUMENT", `--${name} does not take a value`, 3);
  }
  return true;
}

export function intFlag(
  flags: Flags,
  name: string,
  options: { required?: boolean; minimum?: number; maximum?: number } = {},
): number | undefined {
  const direct = given(flags, name);
  if (typeof direct === "number") {
    if (
      !Number.isSafeInteger(direct) ||
      direct < (options.minimum ?? Number.MIN_SAFE_INTEGER) ||
      direct > (options.maximum ?? Number.MAX_SAFE_INTEGER)
    ) {
      throw new CliError("INVALID_ARGUMENT", `--${name} must be a bounded integer`, 3);
    }
    return direct;
  }
  const raw = textFlag(flags, name, options.required ?? false);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < (options.minimum ?? Number.MIN_SAFE_INTEGER) ||
    parsed > (options.maximum ?? Number.MAX_SAFE_INTEGER)
  ) {
    throw new CliError("INVALID_ARGUMENT", `--${name} must be a bounded integer`, 3);
  }
  return parsed;
}

export const integerFlag = intFlag;
