import { HarnessError } from "../core/errors/index.ts";
import { findCommand } from "./registry/index.ts";

export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  const invocation = argv[0];
  if (invocation === undefined) return false;
  const cmd = findCommand(invocation);
  const allowsStdin =
    cmd?.readsStdin === true ||
    invocation === "init" ||
    invocation === "run:init" ||
    invocation === "orchestrator" ||
    invocation === "orchestrator:run" ||
    invocation === "orchestrate";
  if (!allowsStdin) return false;
  const boundary = argv.indexOf("--");
  const options = boundary === -1 ? argv : argv.slice(0, boundary);
  return options.includes("--prompt-stdin");
}

export interface OrchestrateArgv {
  readonly argv: readonly string[];
  readonly inlinePrompt?: string;
}

function orchestrateFlagNames(): ReadonlySet<string> {
  return new Set((findCommand("orchestrate")?.flags ?? []).map((flag) => flag.name));
}

export function extractOrchestrateInlinePrompt(argv: readonly string[]): OrchestrateArgv {
  if (argv[0] !== "orchestrate") return { argv };
  const rest = argv.slice(1);
  if (rest.length === 0) return { argv };

  const flagNames = orchestrateFlagNames();
  const filteredArgv: string[] = [argv[0]!];
  const promptTokens: string[] = [];

  let i = 0;
  while (i < rest.length) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      if (promptTokens.length > 0) {
        if (flagNames.has(flagName)) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `${token} cannot follow inline prompt text — it would be captured as prompt bytes ` +
              "instead of taking effect. Pass it through --prompt-file or piped stdin instead.",
          );
        } else {
          promptTokens.push(token);
          i++;
          continue;
        }
      }

      if (flagNames.has(flagName)) {
        filteredArgv.push(token);
        i++;
        if (
          flagName === "run" ||
          flagName === "run-id" ||
          flagName === "repo" ||
          flagName === "prompt-file" ||
          flagName === "runtime-source" ||
          flagName === "capture-mode"
        ) {
          if (i < rest.length && !rest[i]!.startsWith("--")) {
            filteredArgv.push(rest[i]!);
            i++;
          }
        }
      } else {
        promptTokens.push(token);
        i++;
      }
    } else {
      promptTokens.push(token);
      i++;
    }
  }

  if (promptTokens.length === 0) {
    return { argv: filteredArgv };
  }

  return { argv: filteredArgv, inlinePrompt: promptTokens.join(" ") };
}

export function shouldAutoReadOrchestrateStdin(argv: readonly string[], isTTY: boolean): boolean {
  if (argv[0] !== "orchestrate" || isTTY) return false;
  if (argv.includes("--prompt-file")) return false;
  const rest = argv.slice(1);
  const flagNames = orchestrateFlagNames();

  let hasPositionalPrompt = false;
  let i = 0;
  while (i < rest.length) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      if (flagNames.has(flagName)) {
        i++;
        if (
          flagName === "run" ||
          flagName === "run-id" ||
          flagName === "repo" ||
          flagName === "prompt-file" ||
          flagName === "runtime-source" ||
          flagName === "capture-mode"
        ) {
          if (i < rest.length && !rest[i]!.startsWith("--")) {
            i++;
          }
        }
      } else {
        hasPositionalPrompt = true;
        break;
      }
    } else {
      hasPositionalPrompt = true;
      break;
    }
  }

  if (hasPositionalPrompt) return false;
  return true;
}
