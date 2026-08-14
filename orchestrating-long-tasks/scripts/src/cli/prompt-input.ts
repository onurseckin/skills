export function shouldReadPromptStdin(argv: readonly string[]): boolean {
  if (argv[0] !== "init") return false;
  const boundary = argv.indexOf("--");
  const options = boundary === -1 ? argv : argv.slice(0, boundary);
  return options.includes("--prompt-stdin");
}
