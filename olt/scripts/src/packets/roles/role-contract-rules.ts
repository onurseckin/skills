import { createHash } from "node:crypto";
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  type AgentRole,
} from "../../core/contracts/index.ts";
import { parseUnifiedAgentManifest } from "../../authority/manifest-schema.ts";
import {
  isValidatorDomain,
  type ValidatorDomain,
  type RoleContract,
  type Checklist,
  type ChecklistItem,
  type DocumentKind,
  type ListField,
  type ParsedFrontmatter,
  LIST_FIELDS,
  KEY_LINE,
  ITEM_LINE,
  CONTINUATION_LINE,
  DOMAIN_ID_PREFIX,
  CHECKLIST_ITEM_LIST_FIELDS,
  CHECKLIST_ITEM_SCALAR_FIELDS,
  CHECKLIST_SEVERITIES,
  CHECKLIST_ID,
  CHECKLIST_DOMAIN_LINE,
  invalid,
} from "./role-contract-types.ts";

export function readFrontmatter(
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

export function requireList(
  frontmatter: ParsedFrontmatter,
  field: ListField,
  source: string,
): string[] {
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
    if (source.endsWith(".md"))
      invalid("role contract", source, "missing opening frontmatter fence");
    const manifest = parseUnifiedAgentManifest(text, source);
    const role = (manifest.role ?? manifest.name) as AgentRole;
    if (!isAgentRole(role))
      invalid("role contract", source, `role is not a canonical agent role: ${role}`);
    const commands = (manifest.permissions?.commands ?? []).map((cmd) => {
      if (cmd === "mind:queue:drain" || cmd === "todo:drain") return "queue:drain";
      if (cmd === "mind:queue:seal" || cmd === "todo:seal") return "queue:seal";
      if (cmd === "mind:queue:clean" || cmd === "todo:clean") return "queue:clean";
      if (cmd === "mind:queue:add" || cmd === "todo:add") return "queue:add";
      if (cmd === "mind:queue:list" || cmd === "todo:list") return "queue:status";
      return cmd;
    });
    if (
      isCognitiveValidatorRole(role) &&
      !isMechanicValidatorRole(role) &&
      commands.includes("run:exec")
    ) {
      invalid(
        "role contract",
        source,
        `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
      );
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
    (k) => k !== "role" && k !== "tier" && k !== "domain",
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
    if (role !== "validator")
      invalid("role contract", source, `domain is only valid for validator roles: ${rawDomain}`);
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
  const rawCommands = requireList(frontmatter, "commands", source);
  const commands = rawCommands.map((cmd) => {
    if (cmd === "mind:queue:drain" || cmd === "todo:drain") return "queue:drain";
    if (cmd === "mind:queue:seal" || cmd === "todo:seal") return "queue:seal";
    if (cmd === "mind:queue:clean" || cmd === "todo:clean") return "queue:clean";
    if (cmd === "mind:queue:add" || cmd === "todo:add") return "queue:add";
    if (cmd === "mind:queue:list" || cmd === "todo:list") return "queue:status";
    return cmd;
  });
  if (
    isCognitiveValidatorRole(role) &&
    !isMechanicValidatorRole(role) &&
    commands.includes("run:exec")
  ) {
    invalid(
      "role contract",
      source,
      `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
    );
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
  for (let i = 0; i < lines.length; i += 1) {
    if (/^## /u.test(lines[i]!)) headingIndices.push(i);
  }
  if (headingIndices.length === 0)
    invalid("checklist", source, "document declares no checklist items");

  const seenIds = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const [pos, start] of headingIndices.entries()) {
    const end = pos + 1 < headingIndices.length ? headingIndices[pos + 1]! : lines.length;
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
      (k) => !(CHECKLIST_ITEM_SCALAR_FIELDS as readonly string[]).includes(k),
    );
    if (unknown.length > 0)
      invalid("checklist", source, `${id}: unknown key: ${unknown.join(", ")}`);
    for (const f of CHECKLIST_ITEM_SCALAR_FIELDS) {
      if (!scalars.has(f)) invalid("checklist", source, `${id}: missing key: ${f}`);
    }
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
