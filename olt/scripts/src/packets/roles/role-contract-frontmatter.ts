import {
  CONTINUATION_LINE,
  ITEM_LINE,
  KEY_LINE,
  invalid,
  type DocumentKind,
  type ListField,
  type ParsedFrontmatter,
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
