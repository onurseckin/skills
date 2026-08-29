import {
  AMBIGUOUS_WRAPPERS,
  GIT_MUTATING_SUBCOMMANDS,
  READ_ONLY_GIT_SUBCOMMANDS,
} from "./constants.ts";

export interface CommandDispatch {
  readonly tokens: readonly string[];
  readonly denialReason?: string | undefined;
}

export interface GitDispatchCheck {
  readonly errorCode: "PERMISSION_DENIED" | "UNSHIELDED_COMMAND_DEFECT";
  readonly reason: string;
}

export function isOutputWritingGitOption(token: string): boolean {
  return token === "--output" || token.startsWith("--output=");
}

export function normalizeExecutable(token: string): string {
  const basename = token.trim().split(/[\\/]/).pop() ?? "";
  return basename.replace(/\.exe$/i, "").toLowerCase();
}

export function normalizeDispatchTokens(tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) return tokens;
  return [normalizeExecutable(tokens[0]!), ...tokens.slice(1)];
}

export function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

export function analyzeCommandDispatch(argv: readonly string[], depth = 0): CommandDispatch {
  if (depth > 4 || argv.length === 0 || !argv[0]?.trim()) {
    return { tokens: [], denialReason: "Command dispatch is empty or recursively wrapped." };
  }

  const tokens = normalizeDispatchTokens(argv);
  const executable = tokens[0]!;

  if (executable === "env") {
    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index]!;
      if (token === "--") {
        index++;
        break;
      }
      if (token === "-S" || token.startsWith("--split-string")) {
        return { tokens, denialReason: "env split-string semantics are not authorized." };
      }
      if (token === "-i" || token === "--ignore-environment") {
        index++;
        continue;
      }
      if (token === "-u" || token === "--unset") {
        if (!tokens[index + 1] || tokens[index + 1]!.startsWith("-")) {
          return { tokens, denialReason: `env option '${token}' requires an environment name.` };
        }
        index += 2;
        continue;
      }
      if (token.startsWith("--unset=") && token.length > "--unset=".length) {
        index++;
        continue;
      }
      if (isEnvironmentAssignment(token)) {
        index++;
        continue;
      }
      if (token.startsWith("-")) {
        return { tokens, denialReason: `Unsupported env option '${token}' is ambiguous.` };
      }
      break;
    }

    if (index >= tokens.length) {
      return { tokens, denialReason: "env invocation does not contain a command." };
    }
    return analyzeCommandDispatch(tokens.slice(index), depth + 1);
  }

  if (AMBIGUOUS_WRAPPERS.has(executable)) {
    return {
      tokens,
      denialReason: `Wrapper '${executable}' has execution semantics that cannot be safely authorized.`,
    };
  }

  return { tokens };
}

export function inspectGitDispatch(tokens: readonly string[]): GitDispatchCheck | undefined {
  if (tokens[0] !== "git") return undefined;

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "-C" || token === "--git-dir" || token === "--work-tree") {
      if (!tokens[index + 1] || tokens[index + 1]!.startsWith("-")) {
        return {
          errorCode: "UNSHIELDED_COMMAND_DEFECT",
          reason: `Git global option '${token}' requires a literal path value.`,
        };
      }
      index += 2;
      continue;
    }
    if (
      (token.startsWith("-C") && token.length > 2) ||
      (token.startsWith("--git-dir=") && token.length > "--git-dir=".length) ||
      (token.startsWith("--work-tree=") && token.length > "--work-tree=".length)
    ) {
      index++;
      continue;
    }
    if (token === "-c" || token.startsWith("-c") || token === "--config-env") {
      return {
        errorCode: "UNSHIELDED_COMMAND_DEFECT",
        reason: `Git configuration option '${token}' can activate aliases or extensions.`,
      };
    }
    if (token.startsWith("-")) {
      return {
        errorCode: "UNSHIELDED_COMMAND_DEFECT",
        reason: `Unsupported Git global option '${token}' is ambiguous.`,
      };
    }
    break;
  }

  const subcommand = tokens[index]?.toLowerCase();
  if (!subcommand) {
    return { errorCode: "UNSHIELDED_COMMAND_DEFECT", reason: "Git command has no subcommand." };
  }
  if (GIT_MUTATING_SUBCOMMANDS.has(subcommand)) {
    return {
      errorCode: "PERMISSION_DENIED",
      reason: `Git mutation '${subcommand}' is prohibited for constrained roles.`,
    };
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return {
      errorCode: "UNSHIELDED_COMMAND_DEFECT",
      reason: `Git extension or unrecognized subcommand '${subcommand}' is not authorized.`,
    };
  }
  if (tokens.slice(index + 1).some(isOutputWritingGitOption)) {
    return {
      errorCode: "UNSHIELDED_COMMAND_DEFECT",
      reason: `Git '${subcommand}' output redirection can write external files.`,
    };
  }
  return undefined;
}
