import { flagPositions } from "./arguments.ts";
import {
  CliError,
  allCommands,
  findCommand,
  flagShapes,
  type CommandSpec,
  type FlagSpec,
} from "./registry/index.ts";

export interface HelpRequest {
  readonly command: string | null;
}

export function helpRequest(argv: readonly string[]): HelpRequest | null {
  const boundary = argv.indexOf("--");
  const scanned = boundary === -1 ? argv : argv.slice(0, boundary);
  const first = scanned[0];
  if (first === undefined) {
    return null;
  }

  if (first === "help") {
    const rest = scanned.slice(1);
    const nonFlag = rest.filter((arg) => !arg.startsWith("-"));
    const commandArg = nonFlag[0];
    return { command: commandArg !== undefined ? commandArg : null };
  }

  const named = !first.startsWith("-");
  const spec = named ? findCommand(first) : undefined;
  const tokens = named ? scanned.slice(1) : scanned;
  const shapes = spec === undefined ? undefined : flagShapes(spec.flags);
  const flags = flagPositions(tokens, shapes);

  if (flags.includes("help") || scanned.includes("-h") || scanned.includes("--help")) {
    return { command: named ? first : null };
  }

  return null;
}

function sanitizeCell(cell: string): string {
  return cell.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
}

function formatMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): readonly string[] {
  const cleanHeaders = headers.map(sanitizeCell);
  const cleanRows = rows.map((row) => row.map(sanitizeCell));
  const headerLine = `| ${cleanHeaders.join(" | ")} |`;
  const separatorLine = `| ${cleanHeaders.map(() => ":---").join(" | ")} |`;
  const rowLines = cleanRows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines];
}

function flagRow(flag: FlagSpec): readonly string[] {
  return [
    `\`--${flag.name}\``,
    flag.type,
    flag.required ? "yes" : "no",
    flag.repeatable ? "yes" : "no",
    flag.default === undefined ? "-" : `\`${String(flag.default)}\``,
    flag.description,
  ];
}

export function formatCommandHelp(specOrName: CommandSpec | string): string {
  const spec = typeof specOrName === "string" ? findCommand(specOrName) : specOrName;
  if (spec === undefined) {
    throw new CliError("INVALID_ARGUMENT", `unknown command: ${specOrName}`, 3);
  }

  const lines = [
    `### \`${spec.name}\``,
    "",
    spec.summary,
    "",
    spec.description,
    "",
    `- **Aliases**: ${spec.aliases.length === 0 ? "none" : spec.aliases.map((alias) => `\`${alias}\``).join(", ")}`,
    `- **Stdin**: ${spec.readsStdin ? "reads stdin" : "not read"}`,
    `- **Arguments after \`--\`**: ${spec.takesRemainder ? "accepted" : "rejected"}`,
    "",
  ];

  if (spec.flags.length > 0) {
    lines.push(
      ...formatMarkdownTable(
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

function renderOverview(): string {
  const commands = allCommands();
  const rows = commands.map((spec) => [
    `\`${spec.name}\``,
    spec.aliases.length === 0 ? "-" : spec.aliases.map((alias) => `\`${alias}\``).join(", "),
    spec.summary,
  ]);

  const lines = [
    "### Chatroom CLI",
    "",
    "Usage: `chat <command> [--flag value]`",
    "",
    ...formatMarkdownTable(["Command", "Aliases", "Summary"], rows),
    "",
    "Run `chat help <command>` to see flags and usage for a specific command.",
  ];

  return lines.join("\n");
}

export function renderHelp(command: string | null): string {
  if (command === null) {
    return renderOverview();
  }
  return formatCommandHelp(command);
}
