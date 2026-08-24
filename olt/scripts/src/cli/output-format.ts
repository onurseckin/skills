export interface OutputFormatScan {
  readonly json: boolean;
  readonly argv: readonly string[];
}

export function stripOutputFormat(argv: readonly string[]): OutputFormatScan {
  const boundary = argv.indexOf("--");
  const end = boundary === -1 ? argv.length : boundary;

  let json = false;
  const filtered: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === undefined) continue;

    if (i >= end) {
      filtered.push(arg);
      continue;
    }

    if (arg.startsWith("--format=")) {
      if (arg === "--format=json") {
        json = true;
      }
      continue;
    }

    if (arg === "--format") {
      if (i + 1 < end) {
        if (argv[i + 1] === "json") {
          json = true;
        }
        i++; // skip the value
      }
      continue;
    }

    filtered.push(arg);
  }

  return { json, argv: filtered };
}
