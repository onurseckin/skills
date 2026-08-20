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
  /** argv to hand to `execute()` — the free-text tail, when present, is stripped out of this. */
  readonly argv: readonly string[];
  /** B16's bare form: everything typed after `orchestrate` when it isn't itself a flag. */
  readonly inlinePrompt?: string;
}

// Real `orchestrate` flags (--repo, --run, ...) that must never be silently swallowed as prompt
// bytes. Read from the registry rather than hand-listed, so a flag added to the command later is
// covered automatically instead of quietly reopening this gap.
function orchestrateFlagNames(): ReadonlySet<string> {
  return new Set((findCommand("orchestrate")?.flags ?? []).map((flag) => flag.name));
}

// The bare form only fires when the very first token after the command name is not a flag — a real
// prompt essentially never opens with "--", and this keeps the rule a single unambiguous check
// instead of trying to interleave free text with recognised flags token by token. A caller who
// needs --repo or --run alongside a real file/pipe keeps using the flag form untouched.
//
// A registered flag name appearing LATER in the tail (`orchestrate fix the bug --repo /other`) is
// refused rather than folded into the prompt: silently swallowing it would both corrupt the
// byte-for-byte prompt capture with flag syntax the user did not mean as prose, and discard the
// flag's actual effect without any error — observed concretely as `--repo` losing its value and the
// run silently opening against `cwd` instead of the repo the caller named.
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

// The bare-pipe form: `orchestrate` with nothing else after it reads piped stdin automatically.
// Gated on `isTTY` (never on a flag) so it picks up real pipes without ever blocking a bare
// interactive invocation, which would otherwise hang forever waiting for input nobody is sending.
export function shouldAutoReadOrchestrateStdin(argv: readonly string[], isTTY: boolean): boolean {
  if (argv[0] !== "orchestrate" || isTTY) return false;
  const rest = argv.slice(1);
  if (rest.length > 0 && !rest[0]!.startsWith("--")) return false;
  return !rest.includes("--prompt-file");
}
