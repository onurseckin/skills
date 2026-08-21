import { HarnessError } from "../errors/harness-error.ts";
import { findCommand } from "./registry/index.ts";

export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  const invocation = argv[0];
  if (invocation === undefined || findCommand(invocation)?.readsStdin !== true) return false;
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
  if (rest.length === 0 || rest[0]!.startsWith("--")) return { argv };
  const flagNames = orchestrateFlagNames();
  const strayFlag = rest
    .slice(1)
    .find((token) => token.startsWith("--") && flagNames.has(token.slice(2)));
  if (strayFlag !== undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${strayFlag} cannot follow inline prompt text — it would be captured as prompt bytes ` +
        "instead of taking effect. Pass it through --prompt-file or piped stdin instead.",
    );
  }
  return { argv: [argv[0]!], inlinePrompt: rest.join(" ") };
}

export function shouldAutoReadOrchestrateStdin(argv: readonly string[], isTTY: boolean): boolean {
  if (argv[0] !== "orchestrate" || isTTY) return false;
  const rest = argv.slice(1);
  if (rest.length > 0 && !rest[0]!.startsWith("--")) return false;
  return !rest.includes("--prompt-file");
}
