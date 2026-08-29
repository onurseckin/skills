import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityManifest,
  domainCommandSpecs,
  MANIFEST_SCHEMA,
  type CapabilityManifest,
  type CommandManifest,
  type FlagManifest,
} from "./manifest.ts";
import { COMMAND_DOMAINS, type CommandDomain } from "./registry/index.ts";

export const SPLIT_MANIFEST_SCHEMA = "olt/cli-capabilities-split@1";

export const INDEX_FILE = "index.jsonl";
export const COMMANDS_DIR = "commands";
export const DOMAINS_DIR = "domains";

export function commandFileSlug(commandName: string): string {
  return commandName.replaceAll(":", "-");
}

export function commandFilePath(domain: CommandDomain, commandName: string): string {
  return `${COMMANDS_DIR}/${domain}/${commandFileSlug(commandName)}.json`;
}

export function domainFilePath(domain: CommandDomain): string {
  return `${DOMAINS_DIR}/${domain}.md`;
}

function flagIndexToken(flag: FlagManifest): string {
  return flag.required ? `${flag.name}!` : flag.name;
}

export interface IndexRecord {
  name: string;
  aliases: string[];
  domain: CommandDomain;
  summary: string;
  flags: string[];
  reads_stdin: boolean;
  takes_remainder: boolean;
  file: string;
}

function indexRecord(command: CommandManifest): IndexRecord {
  return {
    name: command.name,
    aliases: command.aliases,
    domain: command.domain,
    summary: command.summary,
    flags: command.flags.map(flagIndexToken),
    reads_stdin: command.reads_stdin,
    takes_remainder: command.takes_remainder,
    file: commandFilePath(command.domain, command.name),
  };
}

export function renderCommandIndexJsonl(): string {
  const manifest = capabilityManifest();
  return `${manifest.commands.map((command) => JSON.stringify(indexRecord(command))).join("\n")}\n`;
}

export function renderCommandDetailJson(command: CommandManifest): string {
  return `${JSON.stringify(command, null, 2)}\n`;
}

export interface CommandDetailFile {
  path: string;
  content: string;
}

export function renderCommandDetailFiles(): readonly CommandDetailFile[] {
  const manifest = capabilityManifest();
  return manifest.commands.map((command) => ({
    path: commandFilePath(command.domain, command.name),
    content: renderCommandDetailJson(command),
  }));
}

function splitDigest(): string {
  const hash = createHash("sha256");
  hash.update(renderCommandIndexJsonl());
  for (const file of renderCommandDetailFiles()) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
  }
  return hash.digest("hex");
}

export interface DomainManifestEntry {
  domain: CommandDomain;
  command_count: number;
  commands_dir: string;
  markdown_file: string;
}

export interface SplitManifest {
  schema: string;
  source: string;
  index_file: string;
  command_count: number;
  domains: DomainManifestEntry[];
  digest: string;
}

export function splitManifest(): SplitManifest {
  const base = capabilityManifest();
  const domains = COMMAND_DOMAINS.map((domain) => ({
    domain,
    command_count: domainCommandSpecs(domain).length,
    commands_dir: `${COMMANDS_DIR}/${domain}`,
    markdown_file: domainFilePath(domain),
  })).filter((entry) => entry.command_count > 0);
  return {
    schema: SPLIT_MANIFEST_SCHEMA,
    source: base.source,
    index_file: INDEX_FILE,
    command_count: base.commands.length,
    domains,
    digest: splitDigest(),
  };
}

export function renderSplitManifestJson(): string {
  return `${JSON.stringify(splitManifest(), null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`capability split: ${field} must be a string`);
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`capability split: ${field} must be a boolean`);
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`capability split: ${field} must be a string array`);
  }
  return value;
}

function parseFlagType(value: unknown): FlagManifest["type"] {
  if (value === "string" || value === "int" || value === "bool") return value;
  throw new Error(`capability split: unknown flag type ${JSON.stringify(value)}`);
}

function parseFlagDefault(value: unknown): FlagManifest["default"] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new Error("capability split: flag default must be string, number, boolean, or null");
}

function parseFlag(value: unknown): FlagManifest {
  if (!isRecord(value)) throw new Error("capability split: flag entry must be an object");
  return {
    name: assertString(value.name, "flag.name"),
    type: parseFlagType(value.type),
    required: assertBoolean(value.required, "flag.required"),
    repeatable: assertBoolean(value.repeatable, "flag.repeatable"),
    default: parseFlagDefault(value.default ?? null),
  };
}

function parseCommandDomain(value: unknown): CommandDomain {
  const domain = assertString(value, "domain");
  if (!(COMMAND_DOMAINS as readonly string[]).includes(domain)) {
    throw new Error(`capability split: unknown domain ${domain}`);
  }
  return domain as CommandDomain;
}

function parseCommandManifest(value: unknown): CommandManifest {
  if (!isRecord(value)) throw new Error("capability split: command entry must be an object");
  const flags = value.flags;
  if (!Array.isArray(flags)) throw new Error("capability split: command.flags must be an array");
  return {
    name: assertString(value.name, "command.name"),
    aliases: assertStringArray(value.aliases, "command.aliases"),
    domain: parseCommandDomain(value.domain),
    summary: assertString(value.summary, "command.summary"),
    flags: flags.map(parseFlag),
    reads_stdin: assertBoolean(value.reads_stdin, "command.reads_stdin"),
    takes_remainder: assertBoolean(value.takes_remainder, "command.takes_remainder"),
  };
}

export interface LoadCapabilitySplitOptions {
  root?: string;
}

function defaultRoot(): string {
  return fileURLToPath(new URL("../../../references/cli-capabilities/", import.meta.url));
}

export function loadCapabilitySplit(options: LoadCapabilitySplitOptions = {}): CapabilityManifest {
  const root = options.root ?? defaultRoot();
  const indexPath = join(root, INDEX_FILE);
  const lines = readFileSync(indexPath, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0);
  const commands = lines.map((line): CommandManifest => {
    const record: unknown = JSON.parse(line);
    if (!isRecord(record)) throw new Error("capability split: index record must be an object");
    const file = assertString(record.file, "index.file");
    const detailPath = join(root, file);
    const detail: unknown = JSON.parse(readFileSync(detailPath, "utf-8"));
    return parseCommandManifest(detail);
  });
  return {
    schema: MANIFEST_SCHEMA,
    source: "olt/scripts/src/cli/registry",
    commands,
  };
}

export function loadCommandDetail(
  domain: CommandDomain,
  commandName: string,
  options: LoadCapabilitySplitOptions = {},
): CommandManifest {
  const root = options.root ?? defaultRoot();
  const path = join(root, commandFilePath(domain, commandName));
  return parseCommandManifest(JSON.parse(readFileSync(path, "utf-8")));
}
