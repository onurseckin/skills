import { HarnessError } from "../errors/harness-error.ts";
import { flagPositions } from "./arguments.ts";
import { enforceLineLimit, formatTable } from "./formatters/line-limiter.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  findCommand,
  flagShapes,
  type CommandSpec,
  type FlagSpec,
} from "./registry/index.ts";

export interface HelpRequest {
  readonly command: string | null;
}

// `--help` cannot survive parseArguments (it rejects a leading dash), so the request is recognised
// from raw argv before parsing. Anything after a bare `--` belongs to a child command, and a
// `--help` standing in value position (`plan:add --label --help`) is a label, not a help request —
// hence the flag-position walk rather than a plain includes().
export function helpRequest(argv: readonly string[]): HelpRequest | null {
  const boundary = argv.indexOf("--");
  const scanned = boundary === -1 ? argv : argv.slice(0, boundary);
  const [first, second] = scanned;
  if (first === "help") return { command: second ?? null };
  if (first === undefined) return null;
  const named = !first.startsWith("-");
  const spec = named ? findCommand(first) : undefined;
  const tokens = named ? scanned.slice(1) : scanned;
  const shapes = spec === undefined ? undefined : flagShapes(spec.flags);
  if (!flagPositions(tokens, shapes).includes("help")) return null;
  return { command: named ? first : null };
}

export function renderHelp(command: string | null): string {
  if (command === null) return renderOverview();
  const spec = findCommand(command);
  if (!spec) throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${command}`);
  return renderCommand(spec);
}

function renderOverview(): string {
  const rows = COMMAND_DOMAINS.map((domain) => ({
    domain,
    names: COMMAND_REGISTRY.filter((spec) => spec.domain === domain).map((spec) => spec.name),
  })).filter((entry) => entry.names.length > 0);

  const lines = [
    "### Harness CLI",
    "",
    "`bun harness.ts <command> [--flag value]` prints a markdown brief; `--format json` prints the structured result.",
    "",
    ...formatTable(
      ["Domain", "Commands"],
      rows.map((entry) => [entry.domain, entry.names.map((name) => `\`${name}\``).join(", ")]),
    ),
    "",
    "`bun harness.ts help <command>` prints flags, stdin rules and exit codes for one command.",
    "Full manifest: `orchestrating-long-tasks/references/cli-capabilities.md`.",
  ];
  return enforceLineLimit(lines.join("\n"));
}

function flagRow(flag: FlagSpec): string[] {
  return [
    `\`--${flag.name}\``,
    flag.type,
    flag.required ? "yes" : "no",
    flag.repeatable ? "yes" : "no",
    flag.default === undefined ? "-" : `\`${String(flag.default)}\``,
    flag.description,
  ];
}

function renderCommand(spec: CommandSpec): string {
  const lines = [
    `### \`${spec.name}\``,
    "",
    spec.summary,
    "",
    spec.description,
    "",
    `- **Domain**: ${spec.domain}`,
    `- **Aliases**: ${spec.aliases.length === 0 ? "none" : spec.aliases.map((alias) => `\`${alias}\``).join(", ")}`,
    `- **Stdin**: ${spec.readsStdin ? "reads stdin when `--prompt-stdin` is set" : "not read"}`,
    `- **Arguments after \`--\`**: ${spec.takesRemainder ? "forwarded to the child process" : "rejected"}`,
    "",
  ];
  if (spec.flags.length > 0) {
    lines.push(
      ...formatTable(
        ["Flag", "Type", "Required", "Repeatable", "Default", "Description"],
        spec.flags.map(flagRow),
      ),
      "",
    );
  }
  lines.push("**Exit codes**", "");
  lines.push(...spec.exitCodes.map((exit) => `- \`${exit.code}\`: ${exit.meaning}`));
  if (spec.examples.length > 0) {
    lines.push("", "**Examples**", "", "```bash", ...spec.examples, "```");
  }
  return lines.join("\n");
}
