import { formatTable } from "./formatters/line-limiter.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  DEFAULT_EXIT_CODES,
  type CommandSpec,
  type ExitCodeSpec,
  type FlagSpec,
} from "./registry/index.ts";

export const MANIFEST_SCHEMA = "orchestrating-long-tasks/cli-capabilities@1";

interface FlagManifest {
  name: string;
  type: FlagSpec["type"];
  required: boolean;
  repeatable: boolean;
  default: string | number | boolean | null;
  description: string;
}

interface CommandManifest {
  name: string;
  aliases: string[];
  domain: CommandSpec["domain"];
  summary: string;
  description: string;
  flags: FlagManifest[];
  reads_stdin: boolean;
  takes_remainder: boolean;
  exit_codes: ExitCodeSpec[];
  examples: string[];
}

export interface CapabilityManifest {
  schema: string;
  source: string;
  commands: CommandManifest[];
}

// The manifest carries no timestamp: a freshness test compares it byte for byte with this render.
export function capabilityManifest(): CapabilityManifest {
  return {
    schema: MANIFEST_SCHEMA,
    source: "orchestrating-long-tasks/scripts/src/cli/registry",
    commands: COMMAND_REGISTRY.map((spec) => ({
      name: spec.name,
      aliases: [...spec.aliases],
      domain: spec.domain,
      summary: spec.summary,
      description: spec.description,
      flags: spec.flags.map((flag) => ({
        name: flag.name,
        type: flag.type,
        required: flag.required,
        repeatable: flag.repeatable,
        default: flag.default ?? null,
        description: flag.description,
      })),
      reads_stdin: spec.readsStdin,
      takes_remainder: spec.takesRemainder,
      exit_codes: spec.exitCodes.map((exit) => ({ code: exit.code, meaning: exit.meaning })),
      examples: [...spec.examples],
    })),
  };
}

export function renderManifestJson(): string {
  return `${JSON.stringify(capabilityManifest(), null, 2)}\n`;
}

function commandSection(spec: CommandSpec): string[] {
  const lines = [
    `### \`${spec.name}\``,
    "",
    spec.summary,
    "",
    spec.description,
    "",
    `- **Aliases**: ${spec.aliases.length === 0 ? "none" : spec.aliases.map((alias) => `\`${alias}\``).join(", ")}`,
    `- **Stdin**: ${spec.readsStdin ? "reads stdin when `--prompt-stdin` is set" : "not read"}`,
    `- **Arguments after \`--\`**: ${spec.takesRemainder ? "forwarded to the child process" : "rejected"}`,
    "",
  ];
  if (spec.flags.length > 0) {
    lines.push(
      ...formatTable(
        ["Flag", "Type", "Required", "Repeatable", "Default", "Description"],
        spec.flags.map((flag) => [
          `\`--${flag.name}\``,
          flag.type,
          flag.required ? "yes" : "no",
          flag.repeatable ? "yes" : "no",
          flag.default === undefined ? "-" : `\`${String(flag.default)}\``,
          flag.description,
        ]),
      ),
      "",
    );
  }
  if (spec.examples.length > 0) {
    lines.push("```bash", ...spec.examples, "```", "");
  }
  return lines;
}

export function renderManifestMarkdown(): string {
  const lines = [
    "# CLI Capability Manifest",
    "",
    "Generated from `orchestrating-long-tasks/scripts/src/cli/registry` by `scripts/generate-cli-manifest.ts`. Do not edit by hand.",
    "",
    "Every command runs as `bun orchestrating-long-tasks/scripts/harness.ts <command> [--flag value]`.",
    "Output is a markdown brief of at most 30 lines; `--format json` returns the structured result instead.",
    "`bun harness.ts help` lists the commands and `bun harness.ts help <command>` prints this detail for one of them.",
    "",
    "## Exit codes",
    "",
    ...formatTable(
      ["Code", "Meaning"],
      DEFAULT_EXIT_CODES.map((exit) => [`\`${exit.code}\``, exit.meaning]),
    ),
    "",
    "`run:exec` is the one exception: it exits 0 whenever the child ran at all, and reports the child's",
    "own status in `exit_code`.",
    "",
  ];
  for (const domain of COMMAND_DOMAINS) {
    const specs = COMMAND_REGISTRY.filter((spec) => spec.domain === domain);
    if (specs.length === 0) continue;
    lines.push(`## ${domain}`, "");
    for (const spec of specs) lines.push(...commandSection(spec));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
