import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  type AgentRole,
} from "../core/contracts/index.ts";
import {
  isValidatorDomain,
  VALIDATOR_DOMAINS,
  type ValidatorDomain,
} from "../core/contracts/index.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../core/errors/index.ts";
import { parseUnifiedAgentManifest } from "../authority/manifest-schema.ts";

const AGENTS_ROOT = fileURLToPath(new URL("../../../agents", import.meta.url));
const CHECKLISTS_ROOT = fileURLToPath(new URL("../../../checklists", import.meta.url));
const LIST_FIELDS = ["may", "must_not", "commands", "spawns"] as const;
const KEY_LINE = /^([a-z][a-z_-]*):(?:[ \t]+(.*))?$/u;
const ITEM_LINE = /^[ \t]+- (.*)$/u;
const CONTINUATION_LINE = /^[ \t]+(\S.*)$/u;

type ListField = (typeof LIST_FIELDS)[number];
type DocumentKind = "role contract" | "checklist";

export { isValidatorDomain, VALIDATOR_DOMAINS, type ValidatorDomain };

const DOMAIN_ID_PREFIX: Readonly<Record<ValidatorDomain, string>> = {
  "code-quality": "CQ",
  product: "PROD",
  security: "SEC",
  "system-design": "SYS",
  "ui-design": "UI",
};

export interface RoleContract {
  role: AgentRole;
  tier: number;
  may: readonly string[];
  must_not: readonly string[];
  commands: readonly string[];
  spawns: readonly AgentRole[];
  domain?: ValidatorDomain | undefined;
  checklist?: Checklist | undefined;
  text: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface ChecklistItem {
  id: string;
  rule: string;
  rationale: string;
  howToCheck: string;
  severity: "critical" | "important" | "minor";
  sources: readonly string[];
}

export interface Checklist {
  domain: ValidatorDomain;
  title: string;
  items: readonly ChecklistItem[];
  text: string;
  bytes: Uint8Array;
  sha256: string;
}

function invalid(kind: DocumentKind, source: string, detail: string): never {
  throw new HarnessError("INTEGRITY", `${kind} ${source} is invalid: ${detail}`);
}

interface ParsedFrontmatter {
  scalars: Map<string, string>;
  lists: Map<string, string[]>;
}

function readFrontmatter(
  lines: readonly string[],
  source: string,
  listFields: ReadonlySet<string>,
  kind: DocumentKind,
): ParsedFrontmatter {
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const seen = new Set<string>();
  let open: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") {
      open = null;
      continue;
    }
    const item = ITEM_LINE.exec(line);
    if (item) {
      if (!open) invalid(kind, source, `list item outside a list: ${line.trim()}`);
      const value = item[1]!.trim();
      if (value === "") invalid(kind, source, `empty ${open} entry`);
      lists.get(open)!.push(value);
      continue;
    }
    const continuation = CONTINUATION_LINE.exec(line);
    if (continuation) {
      const entries = open ? lists.get(open)! : [];
      const last = entries.at(-1);
      if (last === undefined) invalid(kind, source, `dangling continuation: ${line.trim()}`);
      entries[entries.length - 1] = `${last} ${continuation[1]!.trim()}`;
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (!key) invalid(kind, source, `unparsable line: ${line}`);
    const name = key[1]!;
    if (seen.has(name)) invalid(kind, source, `duplicate key: ${name}`);
    seen.add(name);
    const rest = key[2]?.trim() ?? "";
    if (listFields.has(name)) {
      if (rest !== "" && rest !== "[]") invalid(kind, source, `${name} must be a block list or []`);
      lists.set(name, []);
      open = rest === "[]" ? null : name;
      continue;
    }
    if (rest === "") invalid(kind, source, `${name} has no value`);
    scalars.set(name, rest);
    open = null;
  }
  return { scalars, lists };
}

function requireList(frontmatter: ParsedFrontmatter, field: ListField, source: string): string[] {
  const values = frontmatter.lists.get(field);
  if (!values) invalid("role contract", source, `missing key: ${field}`);
  if (new Set(values).size !== values.length)
    invalid("role contract", source, `duplicate ${field} entry`);
  if (field !== "spawns" && field !== "commands" && values.length === 0)
    invalid("role contract", source, `${field} must not be empty`);
  return values;
}

export function parseRoleContract(bytes: Uint8Array, source: string): RoleContract {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("role contract", source, "document is not valid UTF-8");
  }

  if (!text.trimStart().startsWith("---")) {
    if (source.endsWith(".md")) {
      invalid("role contract", source, "missing opening frontmatter fence");
    }
    const manifest = parseUnifiedAgentManifest(text, source);
    const role = (manifest.role ?? manifest.name) as AgentRole;
    if (!isAgentRole(role)) {
      invalid("role contract", source, `role is not a canonical agent role: ${role}`);
    }
    const commands = manifest.permissions?.commands ?? [];
    if (isCognitiveValidatorRole(role) && !isMechanicValidatorRole(role)) {
      if (commands.includes("run:exec")) {
        invalid(
          "role contract",
          source,
          `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
        );
      }
    }
    return {
      role,
      tier: typeof manifest.tier === "number" ? manifest.tier : 3,
      may: manifest.permissions?.may ?? [],
      must_not: manifest.permissions?.must_not ?? [],
      commands,
      spawns: (manifest.permissions?.spawns ?? []) as AgentRole[],
      domain:
        typeof manifest.domain === "string" ? (manifest.domain as ValidatorDomain) : undefined,
      text,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (end === -1) invalid("role contract", source, "frontmatter fence is unterminated");
  const frontmatter = readFrontmatter(
    lines.slice(1, end),
    source,
    new Set(LIST_FIELDS),
    "role contract",
  );
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (body === "") invalid("role contract", source, "document has no prose after the frontmatter");
  const unknown = [...frontmatter.scalars.keys()].filter(
    (key) => key !== "role" && key !== "tier" && key !== "domain",
  );
  if (unknown.length > 0) invalid("role contract", source, `unknown key: ${unknown.join(", ")}`);
  const role = frontmatter.scalars.get("role");
  if (role === undefined) invalid("role contract", source, "missing key: role");
  if (!isAgentRole(role))
    invalid("role contract", source, `role is not a canonical agent role: ${role}`);
  const rawTier = frontmatter.scalars.get("tier");
  if (rawTier === undefined) invalid("role contract", source, "missing key: tier");
  let tier = /^\d+$/u.test(rawTier) ? Number(rawTier) : Number.NaN;
  if (rawTier === "independent") {
    tier = 3;
  } else if (!Number.isSafeInteger(tier) || tier < 0 || tier > 3) {
    invalid("role contract", source, `tier must be an integer from 0 to 3: ${rawTier}`);
  }
  const rawDomain = frontmatter.scalars.get("domain");
  let domain: ValidatorDomain | undefined;
  if (rawDomain !== undefined) {
    if (role !== "validator" && role !== "meta-auditor")
      invalid(
        "role contract",
        source,
        `domain is only valid for validator or meta-auditor roles: ${rawDomain}`,
      );
    if (role === "validator") {
      if (!isValidatorDomain(rawDomain))
        invalid(
          "role contract",
          source,
          `domain is not a recognized validator domain: ${rawDomain}`,
        );
      domain = rawDomain;
    }
  }
  const spawns: AgentRole[] = [];
  for (const spawned of requireList(frontmatter, "spawns", source)) {
    if (!isAgentRole(spawned))
      invalid("role contract", source, `spawns names an unknown role: ${spawned}`);
    if (spawned === role) invalid("role contract", source, "a role may not spawn itself");
    spawns.push(spawned);
  }
  const commands = requireList(frontmatter, "commands", source);
  if (isCognitiveValidatorRole(role) && !isMechanicValidatorRole(role)) {
    if (commands.includes("run:exec")) {
      invalid(
        "role contract",
        source,
        `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
      );
    }
  }
  return {
    role,
    tier,
    may: requireList(frontmatter, "may", source),
    must_not: requireList(frontmatter, "must_not", source),
    commands,
    spawns,
    ...(domain !== undefined ? { domain } : {}),
    text,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function isCognitiveValidatorContract(contract: RoleContract): boolean {
  return isCognitiveValidatorRole(contract.role);
}

export function isMechanicValidatorContract(contract: RoleContract): boolean {
  return isMechanicValidatorRole(contract.role);
}

export function resolveRoleContractPath(role: AgentRole): string {
  const yamlPath = join(AGENTS_ROOT, `${role}.yaml`);
  if (existsSync(yamlPath)) return yamlPath;
  const ymlPath = join(AGENTS_ROOT, `${role}.yml`);
  if (existsSync(ymlPath)) return ymlPath;
  return yamlPath;
}

function normalizeRoleName(role: string): string {
  const lower = role.toLowerCase().trim();
  if (lower === "critic") return "completeness-critic";
  if (lower === "worker") return "implementer";
  if (lower === "orch") return "orchestrator";
  if (lower === "coord") return "coordinator";
  return lower;
}

export function loadRoleContract(
  role: AgentRole,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): RoleContract {
  const path = resolveRoleContractPath(role);
  let rawBytes: Uint8Array;
  try {
    rawBytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `role contract is unreadable: ${path}: ${String(error)}`);
  }

  const contract = parseRoleContract(rawBytes, `${role}.yaml`);
  if (contract.role !== role && normalizeRoleName(contract.role) !== normalizeRoleName(role)) {
    throw new HarnessError("INTEGRITY", `role contract ${path} declares role ${contract.role}`);
  }
  return contract;
}

const CHECKLIST_ITEM_LIST_FIELDS = new Set(["sources"]);
const CHECKLIST_ITEM_SCALAR_FIELDS = ["rule", "rationale", "how-to-check", "severity"] as const;
const CHECKLIST_SEVERITIES = new Set(["critical", "important", "minor"]);
const CHECKLIST_ID = /^[A-Z]{2,6}(?:-[A-Z0-9]+)+-[0-9]{3}$/u;
const CHECKLIST_DOMAIN_LINE = /^Domain: ([a-z-]+)$/u;

export function parseChecklist(bytes: Uint8Array, source: string): Checklist {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("checklist", source, "document is not valid UTF-8");
  }
  const lines = text.split("\n");
  const titleMatch = /^# (.+)$/u.exec(lines[0] ?? "");
  if (!titleMatch) invalid("checklist", source, "document does not open with an H1 title");
  const title = titleMatch[1]!.trim();
  const domainMatch = CHECKLIST_DOMAIN_LINE.exec(lines[1] ?? "");
  if (!domainMatch) invalid("checklist", source, "second line must be `Domain: <slug>`");
  const rawDomain = domainMatch[1]!;
  if (!isValidatorDomain(rawDomain))
    invalid("checklist", source, `unrecognized domain: ${rawDomain}`);
  const domain = rawDomain;
  const expectedPrefix = `${DOMAIN_ID_PREFIX[domain]}-`;

  const headingIndices: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^## /u.test(lines[index]!)) headingIndices.push(index);
  }
  if (headingIndices.length === 0)
    invalid("checklist", source, "document declares no checklist items");

  const seenIds = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const [position, start] of headingIndices.entries()) {
    const end = position + 1 < headingIndices.length ? headingIndices[position + 1]! : lines.length;
    const id = lines[start]!.slice(3).trim();
    if (!CHECKLIST_ID.test(id))
      invalid("checklist", source, `item id does not match the checklist id format: ${id}`);
    if (!id.startsWith(expectedPrefix))
      invalid(
        "checklist",
        source,
        `item id ${id} does not carry the ${domain} prefix ${expectedPrefix}`,
      );
    if (seenIds.has(id)) invalid("checklist", source, `duplicate item id: ${id}`);
    seenIds.add(id);
    const { scalars, lists } = readFrontmatter(
      lines.slice(start + 1, end),
      `${source}#${id}`,
      CHECKLIST_ITEM_LIST_FIELDS,
      "checklist",
    );
    const unknown = [...scalars.keys()].filter(
      (key) => !(CHECKLIST_ITEM_SCALAR_FIELDS as readonly string[]).includes(key),
    );
    if (unknown.length > 0)
      invalid("checklist", source, `${id}: unknown key: ${unknown.join(", ")}`);
    for (const field of CHECKLIST_ITEM_SCALAR_FIELDS)
      if (!scalars.has(field)) invalid("checklist", source, `${id}: missing key: ${field}`);
    const severity = scalars.get("severity")!;
    if (!CHECKLIST_SEVERITIES.has(severity))
      invalid(
        "checklist",
        source,
        `${id}: severity must be critical, important or minor: ${severity}`,
      );
    const sources = lists.get("sources");
    if (!sources || sources.length === 0)
      invalid("checklist", source, `${id}: sources must not be empty`);
    items.push({
      id,
      rule: scalars.get("rule")!,
      rationale: scalars.get("rationale")!,
      howToCheck: scalars.get("how-to-check")!,
      severity: severity as ChecklistItem["severity"],
      sources,
    });
  }
  return {
    domain,
    title,
    items,
    text,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function resolveChecklistPath(domain: ValidatorDomain): string {
  return join(CHECKLISTS_ROOT, `${domain}.md`);
}

export function loadChecklist(
  domain: ValidatorDomain,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): Checklist {
  const path = resolveChecklistPath(domain);
  let bytes: Uint8Array;
  try {
    bytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `checklist is unreadable: ${path}: ${String(error)}`);
  }
  const checklist = parseChecklist(bytes, `checklists/${domain}.md`);
  if (checklist.domain !== domain)
    throw new HarnessError("INTEGRITY", `checklist ${path} declares domain ${checklist.domain}`);
  return checklist;
}

export function resolveValidatorDomainContractPath(domain: ValidatorDomain): string {
  const domainYaml = join(AGENTS_ROOT, `validator-${domain}.yaml`);
  if (existsSync(domainYaml)) return domainYaml;
  return join(AGENTS_ROOT, "validator.yaml");
}

function extractValidatorDomainSection(
  instructions: string,
  domain: ValidatorDomain,
): string | null {
  const blocks = instructions.split(/\n(?=---\s*\nrole:\s*validator)/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("---")) continue;
    const lines = trimmed.split("\n");
    const end = lines.indexOf("---", 1);
    if (end === -1) continue;
    const frontmatterText = lines.slice(1, end).join("\n");
    const domainMatch = frontmatterText.match(/^domain:\s*([a-z-]+)$/m);
    if (domainMatch && domainMatch[1] === domain) {
      return trimmed;
    }
  }
  return null;
}

export function loadValidatorDomainContract(
  domain: ValidatorDomain,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): RoleContract {
  const path = resolveValidatorDomainContractPath(domain);
  let bytes: Uint8Array;
  try {
    bytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `role contract is unreadable: ${path}: ${String(error)}`);
  }

  const textContent = new TextDecoder("utf-8").decode(bytes);
  let contract: RoleContract;

  if (textContent.trimStart().startsWith("---")) {
    contract = parseRoleContract(bytes, `validator-${domain}.md`);
  } else {
    const manifest = parseUnifiedAgentManifest(textContent, path);
    if (manifest.role !== "validator" && manifest.name !== "validator") {
      throw new HarnessError(
        "INTEGRITY",
        `validator domain contract ${path} declares role ${manifest.role}`,
      );
    }

    const instructions = manifest.instructions || "";
    const matchedSection = extractValidatorDomainSection(instructions, domain);

    if (matchedSection) {
      contract = parseRoleContract(
        new TextEncoder().encode(matchedSection),
        `validator-${domain}.md`,
      );
    } else {
      const domainVal =
        typeof manifest.domain === "string" ? (manifest.domain as ValidatorDomain) : domain;
      contract = {
        role: "validator",
        tier: typeof manifest.tier === "number" ? manifest.tier : 3,
        may: manifest.permissions.may,
        must_not: manifest.permissions.must_not,
        commands: manifest.permissions.commands,
        spawns: manifest.permissions.spawns as AgentRole[],
        domain: domainVal,
        text: instructions,
        bytes: new TextEncoder().encode(instructions),
        sha256: createHash("sha256").update(new TextEncoder().encode(instructions)).digest("hex"),
      };
    }
  }

  if (contract.role !== "validator")
    throw new HarnessError(
      "INTEGRITY",
      `validator domain contract ${path} declares role ${contract.role}`,
    );
  if (contract.domain !== domain)
    throw new HarnessError(
      "INTEGRITY",
      `validator domain contract ${path} declares domain ${contract.domain ?? "none"}`,
    );
  const checklist = loadChecklist(domain, read);
  const text = `${contract.text.trimEnd()}\n\n## Standing checklist: ${checklist.title}\n\n${checklist.text.trim()}\n`;
  const bytes_ = Buffer.concat([
    Buffer.from(contract.bytes),
    Buffer.from("\n\0checklist\0\n"),
    Buffer.from(checklist.bytes),
  ]);
  return {
    role: contract.role,
    tier: contract.tier,
    may: contract.may,
    must_not: contract.must_not,
    commands: contract.commands,
    spawns: contract.spawns,
    domain,
    checklist,
    text,
    bytes: bytes_,
    sha256: createHash("sha256").update(bytes_).digest("hex"),
  };
}
