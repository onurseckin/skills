import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentRole, type AgentRole } from "../contracts/packets.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../errors/harness-error.ts";

const ROLES_ROOT = fileURLToPath(new URL("../../../roles", import.meta.url));
const LIST_FIELDS = ["may", "must_not", "commands", "spawns"] as const;
const KEY_LINE = /^([a-z_]+):(?:[ \t]+(.*))?$/u;
const ITEM_LINE = /^[ \t]+- (.*)$/u;
const CONTINUATION_LINE = /^[ \t]+(\S.*)$/u;

type ListField = (typeof LIST_FIELDS)[number];

export interface RoleContract {
  role: AgentRole;
  tier: number;
  may: readonly string[];
  must_not: readonly string[];
  commands: readonly string[];
  spawns: readonly AgentRole[];
  text: string;
  bytes: Uint8Array;
  sha256: string;
}

function invalid(source: string, detail: string): never {
  throw new HarnessError("INTEGRITY", `role contract ${source} is invalid: ${detail}`);
}

function isListField(key: string): key is ListField {
  return (LIST_FIELDS as readonly string[]).includes(key);
}

interface Frontmatter {
  scalars: Map<string, string>;
  lists: Map<ListField, string[]>;
}

function readFrontmatter(lines: readonly string[], source: string): Frontmatter {
  const scalars = new Map<string, string>();
  const lists = new Map<ListField, string[]>();
  const seen = new Set<string>();
  let open: ListField | null = null;
  for (const line of lines) {
    if (line.trim() === "") {
      open = null;
      continue;
    }
    const item = ITEM_LINE.exec(line);
    if (item) {
      if (!open) invalid(source, `list item outside a list: ${line.trim()}`);
      const value = item[1]!.trim();
      if (value === "") invalid(source, `empty ${open} entry`);
      lists.get(open)!.push(value);
      continue;
    }
    const continuation = CONTINUATION_LINE.exec(line);
    if (continuation) {
      const entries = open ? lists.get(open)! : [];
      const last = entries.at(-1);
      if (last === undefined) invalid(source, `dangling continuation: ${line.trim()}`);
      entries[entries.length - 1] = `${last} ${continuation[1]!.trim()}`;
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (!key) invalid(source, `unparsable line: ${line}`);
    const name = key[1]!;
    if (seen.has(name)) invalid(source, `duplicate key: ${name}`);
    seen.add(name);
    const rest = key[2]?.trim() ?? "";
    if (isListField(name)) {
      if (rest !== "" && rest !== "[]") invalid(source, `${name} must be a block list or []`);
      lists.set(name, []);
      open = rest === "[]" ? null : name;
      continue;
    }
    if (rest === "") invalid(source, `${name} has no value`);
    scalars.set(name, rest);
    open = null;
  }
  return { scalars, lists };
}

function requireList(frontmatter: Frontmatter, field: ListField, source: string): string[] {
  const values = frontmatter.lists.get(field);
  if (!values) invalid(source, `missing key: ${field}`);
  if (new Set(values).size !== values.length) invalid(source, `duplicate ${field} entry`);
  if (field !== "spawns" && values.length === 0) invalid(source, `${field} must not be empty`);
  return values;
}

export function parseRoleContract(bytes: Uint8Array, source: string): RoleContract {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid(source, "document is not valid UTF-8");
  }
  const lines = text.split("\n");
  if (lines[0] !== "---") invalid(source, "document does not open with a frontmatter fence");
  const end = lines.indexOf("---", 1);
  if (end === -1) invalid(source, "frontmatter fence is unterminated");
  const frontmatter = readFrontmatter(lines.slice(1, end), source);
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (body === "") invalid(source, "document has no prose after the frontmatter");
  const unknown = [...frontmatter.scalars.keys()].filter((key) => key !== "role" && key !== "tier");
  if (unknown.length > 0) invalid(source, `unknown key: ${unknown.join(", ")}`);
  const role = frontmatter.scalars.get("role");
  if (role === undefined) invalid(source, "missing key: role");
  if (!isAgentRole(role)) invalid(source, `role is not a canonical agent role: ${role}`);
  const rawTier = frontmatter.scalars.get("tier");
  if (rawTier === undefined) invalid(source, "missing key: tier");
  // Number() would silently accept 0x3, 3.0 and 3e0; the tier is a written digit, not an expression.
  const tier = /^\d+$/u.test(rawTier) ? Number(rawTier) : Number.NaN;
  if (!Number.isSafeInteger(tier) || tier < 1 || tier > 3)
    invalid(source, `tier must be an integer from 1 to 3: ${rawTier}`);
  const spawns: AgentRole[] = [];
  for (const spawned of requireList(frontmatter, "spawns", source)) {
    if (!isAgentRole(spawned)) invalid(source, `spawns names an unknown role: ${spawned}`);
    if (spawned === role) invalid(source, "a role may not spawn itself");
    spawns.push(spawned);
  }
  return {
    role,
    tier,
    may: requireList(frontmatter, "may", source),
    must_not: requireList(frontmatter, "must_not", source),
    commands: requireList(frontmatter, "commands", source),
    spawns,
    text,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function resolveRoleContractPath(role: AgentRole): string {
  return join(ROLES_ROOT, `${role}.md`);
}

export function loadRoleContract(role: AgentRole): RoleContract {
  const path = resolveRoleContractPath(role);
  let bytes: Uint8Array;
  try {
    bytes = readRegularFileNoFollow(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `role contract is unreadable: ${path}: ${String(error)}`);
  }
  const contract = parseRoleContract(bytes, `${role}.md`);
  if (contract.role !== role)
    throw new HarnessError("INTEGRITY", `role contract ${path} declares role ${contract.role}`);
  return contract;
}
