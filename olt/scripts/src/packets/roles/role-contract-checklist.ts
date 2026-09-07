import { createHash } from "node:crypto";
import { readFrontmatter } from "./role-contract-frontmatter.ts";
import {
  isValidatorDomain,
  type Checklist,
  type ChecklistItem,
  DOMAIN_ID_PREFIX,
  CHECKLIST_ITEM_LIST_FIELDS,
  CHECKLIST_ITEM_SCALAR_FIELDS,
  CHECKLIST_SEVERITIES,
  CHECKLIST_ID,
  CHECKLIST_DOMAIN_LINE,
  invalid,
} from "./role-contract-types.ts";

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
    if (lines[i]!.startsWith("## ")) headingIndices.push(i);
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
