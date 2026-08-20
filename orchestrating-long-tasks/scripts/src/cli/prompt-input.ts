import { findCommand } from "./registry/index.ts";

export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  const invocation = argv[0];
  if (invocation === undefined || findCommand(invocation)?.readsStdin !== true) return false;
  const boundary = argv.indexOf("--");
  const options = boundary === -1 ? argv : argv.slice(0, boundary);
  return options.includes("--prompt-stdin");
}
