import { suggestFlag } from "./arguments.ts";
import { CliError, type FlagValue, type FlagValues, type Flags } from "./registry/index.ts";

function occurrences(value: FlagValues): readonly FlagValue[] {
  if (typeof value === "string" || value === true) {
    return [value];
  }
  return value;
}

function isMulti(value: FlagValues): boolean {
  return typeof value !== "string" && value !== true;
}

function given(flags: Flags, name: string): FlagValues | undefined {
  return Object.hasOwn(flags, name) ? flags[name] : undefined;
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
  const suggestion = suggestFlag(target, allowed);
  const hint = suggestion === undefined ? "" : `; did you mean ${suggestion.text}?`;
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
