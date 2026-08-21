import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { isExempt, sourceFilesBelow } from "./vendor-identifiers.ts";
import { HOST_DISPATCH_TERMS, HOST_NAME_ALIASES } from "./vendor-names.ts";

export interface UnqualifiedDispatchFinding {
  file: string;
  line: number;
  term: string;
  host: string;
}

export interface ProseScanOptions {
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
          if (pattern.test(line))
            findings.push({ file, line: block.startLine + offset, term, host });
        });
      }
    }
  }
  return findings;
}

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
