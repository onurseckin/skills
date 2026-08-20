import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { VENDOR_NAMES } from "./vendor-names.ts";

const VENDOR_SET = new Set(VENDOR_NAMES);

export interface VendorIdentifierFinding {
  /** Path relative to the scanned root. */
  file: string;
  /** 1-indexed line, or 0 when the vendor name is in the path rather than the source. */
  line: number;
  /** Where it was found: an identifier in the source, or a segment of the file's own path. */
  position: "identifier" | "path";
  identifier: string;
  vendor: string;
}

export interface VendorScanOptions {
  /**
   * Root-relative paths whose whole job is to speak one product's protocol. Each is a deliberate,
   * reviewable decision, and a path listed here that no longer exists fails the check rather than
   * lingering as a permission nobody needs.
   */
  exempt?: readonly string[];
  extensions?: readonly string[];
}

const DEFAULT_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/**
 * Comments and literals blanked out, newlines kept so line numbers survive. A vendor name is
 * allowed to appear as a recorded value or in prose; only what NAMES something is in scope, which
 * is exactly what is left once the quotes and comments are gone.
 *
 * A `${...}` hole inside a template is code again, and a string inside that hole is a literal
 * again, so the scan follows the nesting rather than treating a whole template as one blob.
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  // Each frame is either code or the body of a template literal; `braces` tracks the nesting that
  // tells a closing `}` of an ordinary block apart from the one that ends an interpolation.
  const frames: Array<{ template: boolean; braces: number }> = [{ template: false, braces: 0 }];
  let index = 0;
  let previous = "";

  const blank = (character: string): void => {
    out.push(character === "\n" ? "\n" : " ");
  };
  const skipEscape = (): void => {
    blank(" ");
    blank(source[index + 1] ?? " ");
    index += 2;
  };
  const skipQuoted = (quote: string): void => {
    blank(" ");
    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\") {
        skipEscape();
        continue;
      }
      blank(source[index]!);
      index += 1;
    }
    blank(" ");
    index += 1;
  };

  while (index < source.length) {
    const frame = frames[frames.length - 1]!;
    const character = source[index]!;
    const next = source[index + 1];

    if (frame.template) {
      if (character === "\\") {
        skipEscape();
        continue;
      }
      if (character === "`") {
        frames.pop();
        blank(" ");
        index += 1;
        continue;
      }
      if (character === "$" && next === "{") {
        frames.push({ template: false, braces: 0 });
        blank(" ");
        blank(" ");
        index += 2;
        continue;
      }
      blank(character);
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        blank(" ");
        index += 1;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        blank(source[index]!);
        index += 1;
      }
      blank(" ");
      blank(" ");
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      skipQuoted(character);
      continue;
    }
    if (character === "`") {
      frames.push({ template: true, braces: 0 });
      blank(" ");
      index += 1;
      continue;
    }
    // A `/` right after an operator opens a regular expression, not a division; its body is a
    // literal like any other, and leaving it in would let a quote inside a pattern swallow real code.
    if (character === "/" && /[=(,:[!&|?{;+\-*%<>~^]/u.test(previous)) {
      blank(" ");
      index += 1;
      let inClass = false;
      while (index < source.length && source[index] !== "\n") {
        if (source[index] === "\\") {
          skipEscape();
          continue;
        }
        if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        else if (source[index] === "/" && !inClass) break;
        blank(" ");
        index += 1;
      }
      blank(" ");
      index += 1;
      continue;
    }
    if (character === "{") frame.braces += 1;
    if (character === "}") {
      if (frame.braces === 0 && frames.length > 1) {
        frames.pop();
        blank(" ");
        index += 1;
        continue;
      }
      frame.braces -= 1;
    }

    if (!/\s/u.test(character)) previous = character;
    out.push(character);
    index += 1;
  }
  return out.join("");
}

/** `bun_version`, `BunSpawnApi` and `bunVersion` all yield the word `bun`. */
export function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function vendorOf(identifier: string): string | undefined {
  return identifierWords(identifier).find((word) => VENDOR_SET.has(word));
}

/** Every identifier in this source that carries a vendor name, with the line it sits on. */
export function scanSourceForVendorIdentifiers(
  source: string,
  file: string,
): VendorIdentifierFinding[] {
  const stripped = stripCommentsAndStrings(source);
  const findings: VendorIdentifierFinding[] = [];
  for (const match of stripped.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/gu)) {
    const vendor = vendorOf(match[0]);
    if (vendor === undefined) continue;
    const line = stripped.slice(0, match.index).split("\n").length;
    findings.push({ file, line, position: "identifier", identifier: match[0], vendor });
  }
  return findings;
}

/** Exported for reuse by vendor-prose.ts: the same walk, over `.md`/`.yaml` instead of `.ts`. */
export function sourceFilesBelow(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return found;
}

/** Exported for reuse by vendor-prose.ts: the same prefix-match exemption rule, one list per scan. */
export function isExempt(relativePath: string, exempt: readonly string[]): boolean {
  return exempt.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

/**
 * Every vendor-named identifier and every vendor-named file below `root`. A module's own name is
 * checked too: a file called after a product declares that product a first-class concept just as
 * loudly as a type would.
 */
export function scanTreeForVendorIdentifiers(
  root: string,
  options: VendorScanOptions = {},
): VendorIdentifierFinding[] {
  const exempt = options.exempt ?? [];
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const findings: VendorIdentifierFinding[] = [];
  for (const path of sourceFilesBelow(root, extensions)) {
    const relativePath = relative(root, path).split(sep).join("/");
    if (isExempt(relativePath, exempt)) continue;
    for (const segment of relativePath.split("/")) {
      const vendor = vendorOf(segment);
      if (vendor !== undefined) {
        findings.push({
          file: relativePath,
          line: 0,
          position: "path",
          identifier: segment,
          vendor,
        });
      }
    }
    findings.push(...scanSourceForVendorIdentifiers(readFileSync(path, "utf-8"), relativePath));
  }
  return findings;
}

/** Exempt paths that no longer exist, so a permission cannot outlive the thing it covered. */
export function staleExemptions(root: string, exempt: readonly string[]): string[] {
  return exempt.filter((path) => {
    try {
      statSync(join(root, path));
      return false;
    } catch {
      return true;
    }
  });
}
