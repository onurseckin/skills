import { findCommand } from "./registry/index.ts";

export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  const invocation = argv[0];
  if (invocation === undefined || findCommand(invocation)?.readsStdin !== true) return false;
  const boundary = argv.indexOf("--");
  const options = boundary === -1 ? argv : argv.slice(0, boundary);
  return options.includes("--prompt-stdin");
}

export interface OrchestrateArgv {
  /** argv to hand to `execute()` — the free-text tail, when present, is stripped out of this. */
  readonly argv: readonly string[];
  /** B16's bare form: everything typed after `orchestrate` when it isn't itself a flag. */
  readonly inlinePrompt?: string;
}

// The bare form only fires when the very first token after the command name is not a flag — a real
// prompt essentially never opens with "--", and this keeps the rule a single unambiguous check
// instead of trying to interleave free text with recognised flags token by token. A caller who
// needs --repo or --run alongside a real file/pipe keeps using the flag form untouched.
export function extractOrchestrateInlinePrompt(argv: readonly string[]): OrchestrateArgv {
  if (argv[0] !== "orchestrate") return { argv };
  const rest = argv.slice(1);
  if (rest.length === 0 || rest[0]!.startsWith("--")) return { argv };
  return { argv: [argv[0]!], inlinePrompt: rest.join(" ") };
}

// The bare-pipe form: `orchestrate` with nothing else after it reads piped stdin automatically.
// Gated on `isTTY` (never on a flag) so it picks up real pipes without ever blocking a bare
// interactive invocation, which would otherwise hang forever waiting for input nobody is sending.
export function shouldAutoReadOrchestrateStdin(argv: readonly string[], isTTY: boolean): boolean {
  if (argv[0] !== "orchestrate" || isTTY) return false;
  const rest = argv.slice(1);
  if (rest.length > 0 && !rest[0]!.startsWith("--")) return false;
  return !rest.includes("--prompt-file");
}
