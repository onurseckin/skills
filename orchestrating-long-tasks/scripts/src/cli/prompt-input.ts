export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  if (
    argv[0] !== "init" &&
    argv[0] !== "plan:init" &&
    argv[0] !== "orchestrator:run" &&
    argv[0] !== "orchestrator"
  )
    return false;
  const boundary = argv.indexOf("--");
  const options = boundary === -1 ? argv : argv.slice(0, boundary);
  return options.includes("--prompt-stdin");
}

