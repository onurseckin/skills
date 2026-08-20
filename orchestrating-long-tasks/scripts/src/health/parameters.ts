import { lineOf } from "./scanner.ts";
import type { SourceFile } from "./sources.ts";
import { finding, type HealthFinding } from "./types.ts";

const FUNCTION_HEADER = /\bfunction\s*\*?\s*([A-Za-z0-9_$]+)\s*(?:<[^>(]*>)?\s*\(/gu;

/** Index of the character after the `)` that closes the parameter list opened at `open`. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * The `{` that opens the body, not the one that opens a return type. `): Array<{ id: string }> {`
 * has two, and reading the wrong one made every parameter look unread.
 */
function bodyStart(text: string, afterParams: number): number {
  let depth = 0;
  let previous = "";
  let beforePrevious = "";
  for (let index = afterParams + 1; index < text.length; index += 1) {
    const char = text[index] ?? "";
    // `>` closes a generic return type, so it cannot be tested as a character: only the pair `=>`
    // continues a type into the next `{`.
    const continues =
      previous !== "" && ("|&<,(:".includes(previous) || `${beforePrevious}${previous}` === "=>");
    if (char === "{" && depth === 0 && !continues) return index;
    if ("{[(<".includes(char)) depth += 1;
    else if ("}])>".includes(char)) depth -= 1;
    if (!/\s/u.test(char)) {
      beforePrevious = previous;
      previous = char;
    }
  }
  return -1;
}

function bodyRange(text: string, afterParams: number): { start: number; end: number } | null {
  const open = bodyStart(text, afterParams);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { start: open, end: index };
    }
  }
  return null;
}

/**
 * Top-level commas only: a parameter's own type may contain commas of its own. The `>` of an arrow
 * type is masked first, because counting it as a closing bracket unbalanced every callback type.
 */
function splitParameters(list: string): string[] {
  const masked = list.replace(/=>/gu, "==");
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const [index, char] of [...list].entries()) {
    const shape = masked[index] ?? char;
    if ("([{<".includes(shape)) depth += 1;
    if (")]}>".includes(shape)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Index of the bracket closing the pattern that starts at index 0. */
function closingBracket(pattern: string): number {
  const open = pattern[0] ?? "";
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (const [index, char] of [...pattern].entries()) {
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return pattern.length;
}

/** The names a parameter binds. A destructured parameter binds each of its properties. */
function boundNames(parameter: string): string[] {
  const withoutDefault = parameter.split("=")[0] ?? "";
  const trimmed = withoutDefault.replace(/^\s*(?:readonly\s+)?\.\.\./u, "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // The pattern's own closing bracket, not the last one in the parameter: the type annotation
    // that follows it has brackets of its own.
    const inner = trimmed.slice(1, closingBracket(trimmed));
    return splitParameters(inner)
      .map((entry) => (entry.includes(":") ? (entry.split(":")[1] ?? "") : entry).trim())
      .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name));
  }
  const name = (trimmed.split(":")[0] ?? "").trim();
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? [name] : [];
}

/**
 * B9.2 asks for parameters that are never read. `detectHostTelemetry` ignoring its `agentId` and
 * stamping one model on every node is the defect this looks for; a leading underscore is the
 * language's own way of saying the parameter is there for position only.
 */
export function scanUnreadParameters(file: SourceFile): HealthFinding[] {
  const view = file.scan.identifiers;
  const findings: HealthFinding[] = [];
  for (const header of view.matchAll(FUNCTION_HEADER)) {
    const open = header.index + header[0].length - 1;
    const close = matchingParen(view, open);
    if (close < 0) continue;
    const body = bodyRange(view, close);
    if (body === null) continue;
    const source = view.slice(body.start, body.end);
    for (const parameter of splitParameters(view.slice(open + 1, close))) {
      for (const name of boundNames(parameter)) {
        if (name.startsWith("_")) continue;
        if (new RegExp(`\\b${name}\\b`, "u").test(source)) continue;
        findings.push(
          finding(
            "unused-code",
            `unread-parameter:${file.relative}:${header[1]}:${name}`,
            file.relative,
            `\`${header[1]}\` never reads its parameter \`${name}\`; the caller's value is silently discarded`,
            lineOf(view, header.index),
          ),
        );
      }
    }
  }
  return findings;
}
