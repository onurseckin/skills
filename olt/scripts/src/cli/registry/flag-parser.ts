import { HarnessError } from "../../core/errors/index.ts";
import { suggestFlag } from "../arguments.ts";
import type { CommandSpec, FlagSpec } from "./types.ts";

const FLAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function resolveAllowedNames(flags: readonly FlagSpec[]): Set<string> {
  const allowed = new Set<string>();
  for (const flag of flags) {
    allowed.add(flag.name);
    if (flag.name === "run") allowed.add("run-id");
    if (flag.name === "run-id") allowed.add("run");
    if (flag.name === "task") allowed.add("task-id");
    if (flag.name === "task-id") allowed.add("task");
  }
  return allowed;
}

function parseTokens(
  argv: readonly string[],
  spec: CommandSpec,
): {
  flags: Record<string, (string | true)[]>;
  remainder: string[];
} {
  const tokens =
    argv.length > 0 && (argv[0] === spec.name || spec.aliases.includes(argv[0]!))
      ? argv.slice(1)
      : argv;
  const flagMap: Record<string, (string | true)[]> = {};
  const remainder: string[] = [];
  const allowed = resolveAllowedNames(spec.flags);
  const allowedList = spec.flags.map((f) => f.name);
  const nonValuedFlags = new Set(spec.flags.filter((f) => f.type === "bool").map((f) => f.name));

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === "--") {
      remainder.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `unexpected positional argument: ${token}`,
        [],
        undefined,
        "prefix it with -- to name a flag",
      );
    }
    const name = token.slice(2);
    if (!FLAG_NAME_PATTERN.test(name)) {
      throw new HarnessError("INVALID_ARGUMENT", `invalid option: ${token}`);
    }
    if (!allowed.has(name)) {
      const suggestion = suggestFlag(name, allowedList);
      const hint = suggestion === undefined ? "" : `; did you mean ${suggestion.text}?`;
      throw new HarnessError("INVALID_ARGUMENT", `unknown option: --${name}${hint}`);
    }
    const isBool = nonValuedFlags.has(name);
    const following = tokens[i + 1];
    let val: string | true = true;
    if (!isBool) {
      if (following === undefined || following === "--" || following.startsWith("--")) {
        throw new HarnessError("INVALID_ARGUMENT", `option --${name} requires a value`);
      }
      val = following;
      i += 1;
    }
    const existing = flagMap[name];
    if (existing !== undefined) {
      const specFlag = spec.flags.find(
        (f) =>
          f.name === name ||
          (name === "run-id" && f.name === "run") ||
          (name === "task-id" && f.name === "task"),
      );
      if (specFlag && !specFlag.repeatable) {
        throw new HarnessError("INVALID_ARGUMENT", `duplicate option: --${name}`);
      }
      existing.push(val);
    } else {
      flagMap[name] = [val];
    }
  }

  if (!spec.takesRemainder && remainder.length > 0) {
    throw new HarnessError("INVALID_ARGUMENT", `command ${spec.name} does not accept -- arguments`);
  }

  return { flags: flagMap, remainder };
}

function coerceInt(raw: string | true, name: string): number {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must be a valid integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must be a valid integer`);
  }
  return parsed;
}

function coerceString(raw: string | true, name: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
  }
  return raw;
}

export function parseCommandFlags<T extends Record<string, unknown>>(
  argv: readonly string[],
  spec: CommandSpec,
): T {
  const { flags, remainder } = parseTokens(argv, spec);
  const result: Record<string, unknown> = {};

  for (const flag of spec.flags) {
    let rawValues = flags[flag.name];
    if (rawValues === undefined) {
      if (flag.name === "run") rawValues = flags["run-id"];
      else if (flag.name === "run-id") rawValues = flags["run"];
      else if (flag.name === "task") rawValues = flags["task-id"];
      else if (flag.name === "task-id") rawValues = flags["task"];
    }

    if (rawValues === undefined || rawValues.length === 0) {
      if (flag.required) {
        throw new HarnessError("INVALID_ARGUMENT", `missing required option: --${flag.name}`);
      }
      if (flag.default !== undefined) {
        result[flag.name] = flag.default;
      } else if (flag.type === "bool") {
        result[flag.name] = false;
      }
      continue;
    }

    if (flag.type === "bool") {
      result[flag.name] = true;
    } else if (flag.type === "int") {
      if (flag.repeatable) {
        result[flag.name] = rawValues.map((v) => coerceInt(v, flag.name));
      } else {
        result[flag.name] = coerceInt(rawValues[0]!, flag.name);
      }
    } else if (flag.type === "string") {
      if (flag.repeatable) {
        result[flag.name] = rawValues.map((v) => coerceString(v, flag.name));
      } else {
        result[flag.name] = coerceString(rawValues[0]!, flag.name);
      }
    }
  }

  if (spec.takesRemainder) {
    result.remainder = remainder;
  }

  return result as T;
}
