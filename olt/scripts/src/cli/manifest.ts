import { formatTable } from "./formatters/line-limiter.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  DEFAULT_EXIT_CODES,
  type CommandSpec,
  type FlagSpec,
} from "./registry/index.ts";

export const MANIFEST_SCHEMA = "olt/cli-capabilities@1";

export interface FlagManifest {
  name: string;
  type: FlagSpec["type"];
  required: boolean;
  repeatable: boolean;
  default: string | number | boolean | null;
}

export interface CommandManifest {
  name: string;
  aliases: string[];
  domain: CommandSpec["domain"];
  summary: string;
  flags: FlagManifest[];
  reads_stdin: boolean;
  takes_remainder: boolean;
}

export interface CapabilityManifest {
  schema: string;
  source: string;
  commands: CommandManifest[];
}

export function capabilityManifest(): CapabilityManifest {
  return {
    schema: MANIFEST_SCHEMA,
    source: "olt/scripts/src/cli/registry",
    commands: COMMAND_REGISTRY.map((spec) => ({
      name: spec.name,
      aliases: [...spec.aliases],
      domain: spec.domain,
      summary: spec.summary,
      flags: spec.flags.map((flag) => ({
        name: flag.name,
        type: flag.type,
        required: flag.required,
        repeatable: flag.repeatable,
        default: flag.default ?? null,
      })),
      reads_stdin: spec.readsStdin,
      takes_remainder: spec.takesRemainder,
    })),
  };
}

export function commandSlice(commandName: string): CommandManifest | undefined {
  const manifest = capabilityManifest();
  return manifest.commands.find((c) => c.name === commandName || c.aliases.includes(commandName));
}

export function domainSlice(domain: CommandSpec["domain"]): CapabilityManifest {
  const manifest = capabilityManifest();
  return {
    schema: manifest.schema,
    source: manifest.source,
    commands: manifest.commands.filter((c) => c.domain === domain),
  };
}

export function commandSection(spec: CommandSpec): string[] {
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

export function domainCommandSpecs(domain: CommandSpec["domain"]): readonly CommandSpec[] {
  return COMMAND_REGISTRY.filter((spec) => spec.domain === domain);
}

export function renderDomainMarkdown(domain: CommandSpec["domain"]): string {
  const specs = domainCommandSpecs(domain);
  const lines = [
    `# CLI Capability Manifest — ${domain}`,
    "",
    `Generated from \`olt/scripts/src/cli/registry\` by \`olt/scripts/generate-cli-manifest.ts\`. Do not edit by`,
    "hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).",
    "",
  ];
  for (const spec of specs) lines.push(...commandSection(spec));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderManifestMarkdown(): string {
  const lines = [
    "# CLI Capability Manifest",
    "",
    "Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by",
    "hand.",
    "",
    "Every command runs as `bun olt/scripts/harness.ts <command> [--flag value]`.",
    "Output is a markdown brief of at most 30 lines; `--format json` returns the structured result instead.",
    "`bun harness.ts help` lists the commands and `bun harness.ts help <command>` prints this detail for one of them.",
    "",
    "Full per-command detail (flags, stdin rule, exit codes, examples) lives one file per domain under",
    "[`cli-capabilities/domains/`](cli-capabilities/). The structured equivalent — one JSONL record per command",
    "plus one pretty-printed JSON file per command — lives under",
    "[`cli-capabilities/`](cli-capabilities/): read `cli-capabilities/index.jsonl` for a single self-contained",
    "record per command, or `cli-capabilities/commands/<domain>/<command>.json` for one command's complete flag",
    "definitions. `cli-capabilities/manifest.json` maps domains to both.",
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
    "## Domains",
    "",
    ...formatTable(
      ["Domain", "Commands", "Detail"],
      COMMAND_DOMAINS.map((domain) => {
        const count = domainCommandSpecs(domain).length;
        return [
          domain,
          String(count),
          `[cli-capabilities/domains/${domain}.md](cli-capabilities/domains/${domain}.md)`,
        ];
      }).filter((row) => row[1] !== "0"),
    ),
    "",
    "## Commands",
    "",
    ...formatTable(
      ["Command", "Domain", "Summary"],
      COMMAND_REGISTRY.map((spec) => [`\`${spec.name}\``, spec.domain, spec.summary]),
    ),
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
