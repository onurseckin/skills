/**
 * `vendor-identifiers.ts` catches a vendor name used to NAME something in `.ts` source. It cannot
 * see the shape this same defect takes in a role contract or a reference doc: a host's own dispatch
 * call given as "the shape of the call," with no word anywhere nearby saying which host it belongs
 * to. `agents/coordinator.yaml` and `references/run-playbook.md` both regressed to exactly that -
 * `invoke_subagent({...})` presented as universal - and neither `.yaml` nor `.md` was ever swept.
 *
 * The discrimination that keeps this useful: `references/host-adapters.md`'s adapter table names
 * every host's tool on the very row that identifies the host, and its "Native primitives" section
 * always names the host in the same sentence as the call - both must pass. A block that names the
 * term with no host anywhere in reach is the defect, whether that block is prose or a fenced code
 * example inside a role contract.
 */
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { isExempt, sourceFilesBelow } from "./vendor-identifiers.ts";
import { HOST_DISPATCH_TERMS, HOST_NAME_ALIASES } from "./vendor-names.ts";

export interface UnqualifiedDispatchFinding {
  file: string;
  /** 1-indexed line the term sits on. */
  line: number;
  term: string;
  host: string;
}

export interface ProseScanOptions {
  /** Root-relative paths a reason excuses from the sweep, the same shape as vendor-identifiers.ts. */
  exempt?: readonly string[];
  extensions?: readonly string[];
}

const DEFAULT_PROSE_EXTENSIONS: readonly string[] = [".md", ".yaml"];
const HEADING_PATTERN = /^#{1,6}\s+(.*)$/u;

function hostsNamedIn(text: string): ReadonlySet<string> {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const { host, aliases } of HOST_NAME_ALIASES) {
    if (aliases.some((alias) => lower.includes(alias))) found.add(host);
  }
  return found;
}

interface Paragraph {
  readonly startLine: number;
  readonly lines: readonly string[];
}

/**
 * Contiguous non-blank lines - the unit a reader carries a named host through. A blank line is
 * where one thought ends, so a host named in the paragraph above a fenced example does not qualify
 * a term two paragraphs later; a heading above it (Markdown only, see below) still can.
 */
function paragraphsOf(lines: readonly string[]): Paragraph[] {
  const blocks: Paragraph[] = [];
  let current: string[] = [];
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      if (current.length > 0) blocks.push({ startLine: start + 1, lines: current });
      current = [];
      continue;
    }
    if (current.length === 0) start = index;
    current.push(line);
  }
  if (current.length > 0) blocks.push({ startLine: start + 1, lines: current });
  return blocks;
}

function wordBoundaryPattern(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
}

/**
 * Every host-dispatch term in `source` with no host named in reach: its own paragraph or, in
 * Markdown, the nearest heading above it (a YAML file has no heading syntax of its own - `#` there
 * is a comment, not a section marker - so a `.yaml` role contract is judged on paragraph alone).
 * `### 1. Google Antigravity` followed by a blank line and a bullet naming no host by itself is
 * exactly why headings must carry forward: the section is the reach, not just its opening line.
 */
export function scanProseForUnqualifiedDispatch(
  source: string,
  file: string,
  isMarkdown: boolean,
): UnqualifiedDispatchFinding[] {
  const findings: UnqualifiedDispatchFinding[] = [];
  let sectionHosts: ReadonlySet<string> = new Set();
  for (const block of paragraphsOf(source.split("\n"))) {
    const heading = isMarkdown ? HEADING_PATTERN.exec(block.lines[0] ?? "") : null;
    if (heading !== null) sectionHosts = hostsNamedIn(heading[1] ?? "");
    const qualifying = new Set([...sectionHosts, ...hostsNamedIn(block.lines.join("\n"))]);
    for (const { host, terms } of HOST_DISPATCH_TERMS) {
      if (qualifying.has(host)) continue;
      for (const term of terms) {
        const pattern = wordBoundaryPattern(term);
        block.lines.forEach((line, offset) => {
          if (pattern.test(line)) findings.push({ file, line: block.startLine + offset, term, host });
        });
      }
    }
  }
  return findings;
}

/** Every unqualified host-dispatch term below `root`, across every `.md`/`.yaml` file found there. */
export function scanTreeForUnqualifiedDispatch(
  root: string,
  options: ProseScanOptions = {},
): UnqualifiedDispatchFinding[] {
  const exempt = options.exempt ?? [];
  const extensions = options.extensions ?? DEFAULT_PROSE_EXTENSIONS;
  const findings: UnqualifiedDispatchFinding[] = [];
  for (const path of sourceFilesBelow(root, extensions)) {
    const relativePath = relative(root, path).split(sep).join("/");
    if (isExempt(relativePath, exempt)) continue;
    const isMarkdown = relativePath.endsWith(".md");
    findings.push(
      ...scanProseForUnqualifiedDispatch(readFileSync(path, "utf-8"), relativePath, isMarkdown),
    );
  }
  return findings;
}
