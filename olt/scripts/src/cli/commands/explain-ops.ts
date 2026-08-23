import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, type ErrorCode } from "../../errors/codes.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { findCommand } from "../registry/index.ts";
import { textFlag, type Flags } from "../options.ts";
import {
  EXPLAIN_ENTRIES,
  type ExplainCause,
  type ExplainEntry,
  type ExplainExample,
} from "./explain-data.ts";

interface DirectThrowSite {
  readonly line: number;
  readonly message: string;
}

function commandsDir(): string {
  return fileURLToPath(new URL(".", import.meta.url));
}

function scriptsSrcRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

function walkTsFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkTsFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function throwPattern(code: string): RegExp {
  return new RegExp(
    `new HarnessError\\(\\s*"${code}"\\s*,\\s*(\`(?:\\\\.|[^\`\\\\])*\`|"(?:\\\\.|[^"\\\\])*")`,
    "g",
  );
}

function stripDelimiters(literal: string): string {
  return literal.slice(1, -1);
}

function countThrowSites(code: ErrorCode): number {
  const root = scriptsSrcRoot();
  let total = 0;
  for (const file of walkTsFiles(root)) {
    const text = readFileSync(file, "utf8");
    const matches = text.match(throwPattern(code));
    if (matches) total += matches.length;
  }
  return total;
}

function findHandlerFile(functionName: string): string | undefined {
  const dir = commandsDir();
  const declared = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const text = readFileSync(join(dir, entry.name), "utf8");
    if (declared.test(text)) return entry.name;
  }
  return undefined;
}

function directThrowSites(fileName: string, code: ErrorCode): readonly DirectThrowSite[] {
  const text = readFileSync(join(commandsDir(), fileName), "utf8");
  const sites: DirectThrowSite[] = [];
  for (const match of text.matchAll(throwPattern(code))) {
    sites.push({ line: lineOf(text, match.index), message: stripDelimiters(match[1]!) });
  }
  return sites;
}

export function resolveExampleLine(item: ExplainExample, code: ErrorCode): number {
  const path = join(scriptsSrcRoot(), item.file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new HarnessError(
      "INTEGRITY",
      `explain citation ${item.file} for ${code} does not exist as a file under scripts/src`,
    );
  }
  for (const match of text.matchAll(throwPattern(code))) {
    if (stripDelimiters(match[1]!) === item.message) return lineOf(text, match.index);
  }
  throw new HarnessError(
    "INTEGRITY",
    `explain citation ${item.file} has no live throw of ${code} with message "${item.message}"`,
  );
}

function normalizeCode(raw: string): ErrorCode {
  const upper = raw.trim().toUpperCase().replace(/-/g, "_");
  const known = ERROR_CODES.find((code) => code === upper);
  if (!known) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown error code: ${raw}; known codes are ${ERROR_CODES.join(", ")}`,
    );
  }
  return known;
}

function entryFor(code: ErrorCode): ExplainEntry {
  const entry = EXPLAIN_ENTRIES.find((candidate) => candidate.code === code);
  if (!entry) throw new HarnessError("INVALID_STATE", `no explanation authored for ${code}`);
  return entry;
}

function causeLines(cause: ExplainCause, code: ErrorCode, index: number): string[] {
  const citations = cause.examples
    .map((item) => `\`${item.file}:${resolveExampleLine(item, code)}\``)
    .join(", ");
  return [
    `${index + 1}. **${cause.label}**`,
    `   - Trigger: ${cause.trigger}`,
    `   - Remedy: ${cause.remedy}`,
    `   - e.g. ${citations}`,
    "",
  ];
}

interface CommandSection {
  readonly lines: readonly string[];
  readonly matched: boolean;
}

function commandSection(commandName: string, code: ErrorCode): CommandSection {
  const spec = findCommand(commandName)!;
  const handlerFile = findHandlerFile(spec.handler.name);
  if (!handlerFile) {
    return {
      matched: false,
      lines: [
        "",
        `### Direct throw sites in \`${commandName}\``,
        "",
        `Could not locate ${commandName}'s implementation file for a direct scan; the causes above still apply.`,
      ],
    };
  }
  const sites = directThrowSites(handlerFile, code);
  const lines = [
    "",
    `### Direct throw sites in \`${commandName}\` (\`cli/commands/${handlerFile}\`)`,
    "",
  ];
  if (sites.length === 0) {
    return {
      matched: false,
      lines: [
        ...lines,
        `\`${commandName}\`'s own handler does not throw ${code} directly. If this run hit ${code} while running \`${commandName}\`, the throw originated in a module it calls - the causes above are the ground truth for what to check next; run \`doctor\` if unsure.`,
      ],
    };
  }
  return {
    matched: true,
    lines: [...lines, ...sites.map((site) => `- line ${site.line}: ${site.message}`)],
  };
}

function formatMarkdown(
  entry: ExplainEntry,
  liveCount: number,
  section: CommandSection | undefined,
): string {
  const lines = [
    `### \`${entry.code}\``,
    "",
    entry.summary,
    "",
    `**Rule**: ${entry.rule}`,
    "",
    `**Live in this build**: ${liveCount} throw site(s) across \`olt/scripts/src\`.`,
    "",
    "**Common causes**",
    "",
    ...entry.causes.flatMap((cause, index) => causeLines(cause, entry.code, index)),
  ];
  if (section) lines.push(...section.lines);
  return lines.join("\n").trimEnd();
}

export function explainCommand(flags: Flags): Record<string, unknown> {
  const code = normalizeCode(textFlag(flags, "code")!);
  const commandName = textFlag(flags, "command", false);
  if (commandName !== undefined && !findCommand(commandName)) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown command: ${commandName}`);
  }
  const entry = entryFor(code);
  const liveCount = countThrowSites(code);
  const section = commandName === undefined ? undefined : commandSection(commandName, code);
  return {
    markdown: formatMarkdown(entry, liveCount, section),
    code: entry.code,
    summary: entry.summary,
    rule: entry.rule,
    live_throw_sites: liveCount,
    causes: entry.causes.map((cause) => ({
      id: cause.id,
      label: cause.label,
      trigger: cause.trigger,
      remedy: cause.remedy,
      examples: cause.examples.map((item) => ({
        file: item.file,
        line: resolveExampleLine(item, entry.code),
        message: item.message,
      })),
    })),
    ...(commandName === undefined
      ? {}
      : {
          command: commandName,
          command_throws_directly: section!.matched,
        }),
  };
}
