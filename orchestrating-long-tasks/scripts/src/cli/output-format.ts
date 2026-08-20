export interface OutputFormatScan {
  readonly json: boolean;
  readonly argv: readonly string[];
}

// The scan stops at the first bare `--`: everything past it belongs to a child process, so a
// `run:exec ... -- bun test --format json` tail must reach the child untouched.
export function stripOutputFormat(argv: readonly string[]): OutputFormatScan {
  const boundary = argv.indexOf("--");
  const end = boundary === -1 ? argv.length : boundary;
  const json = argv.some(
    (arg, index) =>
      index < end &&
      (arg === "--format=json" || (arg === "--format" && argv[index + 1] === "json")),
  );
  const filtered = argv.filter(
    (arg, index) =>
      index >= end ||
      (arg !== "--format=json" &&
        arg !== "--format" &&
        (index === 0 || argv[index - 1] !== "--format")),
  );
  return { json, argv: filtered };
}
