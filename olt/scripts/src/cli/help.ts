import { HarnessError } from "../core/errors/index.ts";
import { flagPositions } from "./arguments.ts";
import { enforceLineLimit, formatTable } from "./formatters/line-limiter.ts";
import {
  COMMAND_REGISTRY,
  PRIMARY_VERBS,
  commandTier,
  findCommand,
  flagShapes,
  isInternalCommand,
  type CommandSpec,
  type FlagSpec,
} from "./registry/index.ts";

export interface HelpRequest {
  readonly command: string | null;
  readonly internal?: boolean;
}

export interface RenderHelpOptions {
  readonly internal?: boolean;
}

export function helpRequest(argv: readonly string[]): HelpRequest | null {
  const boundary = argv.indexOf("--");
  const scanned = boundary === -1 ? argv : argv.slice(0, boundary);
  const [first] = scanned;
  if (first === undefined) return null;

  const isHelpCommand = first === "help";
  if (isHelpCommand) {
    const rest = scanned.slice(1);
    const internal = rest.includes("--internal") ? true : rest.includes("-i");
    const nonFlagArgs = rest.filter((arg) => !arg.startsWith("-"));
    const commandArg = nonFlagArgs[0];
    return {
      command: commandArg !== undefined ? commandArg : null,
      ...(internal ? { internal: true } : {}),
    };
  }

  const named = !first.startsWith("-");
  const spec = named ? findCommand(first) : undefined;
  const tokens = named ? scanned.slice(1) : scanned;
  const shapes = spec === undefined ? undefined : flagShapes(spec.flags);
  const flags = flagPositions(tokens, shapes);

  const hasHelpFlag = flags.includes("help");
  const hasInternalFlag = flags.includes("internal");

  if (hasHelpFlag) {
    return {
      command: named ? first : null,
      ...(hasInternalFlag ? { internal: true } : {}),
    };
  }

  if (!named && hasInternalFlag) {
    return {
      command: null,
      internal: true,
    };
  }

  return null;
}

export function formatCommandTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  return formatTable(headers, rows);
}

export function formatDomainSummary(
  domain: string,
  commands: readonly CommandSpec[] | readonly string[],
): string {
  const names = commands.map((c) => (typeof c === "string" ? c : c.name));
  return `| ${domain} | ${names.map((name) => `\`${name}\``).join(", ")} |`;
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

export function formatCommandHelp(specOrName: CommandSpec | string): string {
  const spec = typeof specOrName === "string" ? findCommand(specOrName) : specOrName;
  if (!spec) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${specOrName}`);
  }

  const lines = [
    `### \`${spec.name}\``,
    "",
    spec.summary,
    "",
    spec.description,
    "",
    `- **Domain**: ${spec.domain}`,
    `- **Tier**: ${commandTier(spec)}`,
    `- **Aliases**: ${spec.aliases.length === 0 ? "none" : spec.aliases.map((alias) => `\`${alias}\``).join(", ")}`,
    `- **Stdin**: ${spec.readsStdin ? "reads stdin when `--prompt-stdin` is set" : "not read"}`,
    `- **Arguments after \`--\`**: ${spec.takesRemainder ? "forwarded to the child process" : "rejected"}`,
    "",
  ];
  if (spec.flags.length > 0) {
    lines.push(
      ...formatCommandTable(
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

export function renderHelp(command: string | null, options?: RenderHelpOptions | boolean): string {
  let internal = false;
  if (typeof options === "boolean") {
    internal = options;
  } else if (options !== undefined && options.internal !== undefined) {
    internal = options.internal;
  }
  if (command === null) return renderOverview(internal);
  return formatCommandHelp(command);
}

function renderOverview(internal: boolean): string {
  if (internal) {
    const internalCommands = COMMAND_REGISTRY.filter(isInternalCommand);
    const domains = [...new Set(internalCommands.map((spec) => spec.domain))].sort();
    const rows = domains
      .map((domain) => ({
        domain,
        names: internalCommands.filter((spec) => spec.domain === domain).map((spec) => spec.name),
      }))
      .filter((entry) => entry.names.length > 0);

    const lines = [
      "### Harness CLI (Internal Tier)",
      "",
      "`bun harness.ts <command> [--flag value]` prints a markdown brief; `--format json` prints the structured result.",
      "",
      ...formatCommandTable(
        ["Domain", "Commands"],
        rows.map((entry) => [entry.domain, entry.names.map((name) => `\`${name}\``).join(", ")]),
      ),
      "",
      "`bun harness.ts help <command>` prints flags, stdin rules and exit codes for one command.",
      "Full manifest: `olt/references/cli-capabilities.md`.",
    ];
    return lines.join("\n");
  }

  const rows = PRIMARY_VERBS.map((verb) => {
    const commands =
      verb === "doctor"
        ? COMMAND_REGISTRY.filter((spec) => {
            const isDoc =
              spec.name === "doctor"
                ? true
                : spec.name.startsWith("doctor:")
                  ? true
                  : spec.domain === "doctor";
            return isDoc && !isInternalCommand(spec);
          })
        : COMMAND_REGISTRY.filter(
            (spec) =>
              spec.domain === verb &&
              !isInternalCommand(spec) &&
              spec.name !== "doctor" &&
              !spec.name.startsWith("doctor:"),
          );
    return {
      domain: verb,
      names: commands.map((spec) => spec.name),
    };
  }).filter((entry) => entry.names.length > 0);

  const lines = [
    "### Harness CLI",
    "",
    "`bun harness.ts <command> [--flag value]` prints a markdown brief; `--format json` prints the structured result.",
    "",
    ...formatCommandTable(
      ["Domain", "Commands"],
      rows.map((entry) => [entry.domain, entry.names.map((name) => `\`${name}\``).join(", ")]),
    ),
    "",
    "`bun harness.ts help <command>` prints flags, stdin rules and exit codes for one command.",
    "Pass `--internal` to view lower-level internal and diagnostic commands.",
    "Full manifest: `olt/references/cli-capabilities.md`.",
  ];
  return enforceLineLimit(lines.join("\n"));
}
