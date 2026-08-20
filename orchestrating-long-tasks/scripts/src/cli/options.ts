import { HarnessError } from "../errors/harness-error.ts";
import type { FlagValue, FlagValues } from "./arguments.ts";

export type Flags = Readonly<Record<string, FlagValues>>;

// Array.isArray widens a readonly tuple to any[], so the multi-occurrence check is hand-rolled.
function occurrences(value: FlagValues): readonly FlagValue[] {
  return typeof value === "string" || value === true ? [value] : value;
}

function isMulti(value: FlagValues): boolean {
  return typeof value !== "string" && value !== true;
}

// A plain index read resolves an absent `--constructor` to Object.prototype.constructor, so an
// unsupplied flag would look supplied; only own keys count as given.
function given(flags: Flags, name: string): FlagValues | undefined {
  return Object.hasOwn(flags, name) ? flags[name] : undefined;
}

export interface CommandContext {
  stdin?: Uint8Array;
}

export function assertFlags(flags: Flags, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  const unknown = Object.keys(flags).filter((name) => !permitted.has(name));
  if (unknown.length) throw new HarnessError("INVALID_ARGUMENT", `unknown option: --${unknown[0]}`);
}

export function textFlag(flags: Flags, name: string, required = true): string | undefined {
  const value = given(flags, name);
  if (value === undefined && !required) return undefined;
  // A repeatable flag parses to a list even when given once; reading it as a scalar would silently
  // drop occurrences, so it is a hard error rather than a quiet first-wins.
  if (value !== undefined && isMulti(value)) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} is repeatable; read it as a list`);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
  }
  return value;
}

// Repeatable flags: every occurrence, in the order given. A bare occurrence carries no text, so it
// is rejected instead of being recorded as an empty entry.
export function listFlag(
  flags: Flags,
  name: string,
  required = false,
): readonly string[] | undefined {
  const value = given(flags, name);
  if (value === undefined) {
    if (required) throw new HarnessError("INVALID_ARGUMENT", `--${name} is required`);
    return undefined;
  }
  const values = occurrences(value).map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
    }
    return entry;
  });
  return values;
}

export function boolFlag(flags: Flags, name: string): boolean {
  const value = given(flags, name);
  if (value === undefined) return false;
  if (value !== true) throw new HarnessError("INVALID_ARGUMENT", `--${name} does not take a value`);
  return true;
}

export function integerFlag(
  flags: Flags,
  name: string,
  options: { required?: boolean; minimum?: number; maximum?: number } = {},
): number | undefined {
  const raw = textFlag(flags, name, options.required ?? false);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < (options.minimum ?? Number.MIN_SAFE_INTEGER) ||
    value > (options.maximum ?? Number.MAX_SAFE_INTEGER)
  ) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must be a bounded integer`);
  }
  return value;
}

export function actorFlag(flags: Flags): string {
  return textFlag(flags, "actor")!;
}
