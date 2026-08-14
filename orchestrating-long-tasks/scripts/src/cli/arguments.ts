import { HarnessError } from "../errors/harness-error.ts";

export type FlagValue = string | true;
export interface ParsedArguments {
  command: string;
  flags: Record<string, FlagValue>;
  remainder: string[];
}

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command, ...tokens] = argv;
  if (!command?.trim() || command.startsWith("-")) {
    throw new HarnessError("INVALID_ARGUMENT", "a command is required");
  }
  const flags: Record<string, FlagValue> = {};
  const remainder: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--") {
      remainder.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      throw new HarnessError("INVALID_ARGUMENT", `unexpected positional argument: ${token}`);
    }
    const name = token.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new HarnessError("INVALID_ARGUMENT", `invalid option: ${token}`);
    }
    if (name in flags) throw new HarnessError("INVALID_ARGUMENT", `duplicate option: --${name}`);
    const following = tokens[index + 1];
    if (following !== undefined && !following.startsWith("--")) {
      flags[name] = following;
      index += 1;
    } else if (following === undefined && ["run", "repo", "task", "actor"].includes(name)) {
      throw new HarnessError("INVALID_ARGUMENT", `option --${name} requires a value`);
    } else flags[name] = true;
  }
  return { command, flags, remainder };
}
