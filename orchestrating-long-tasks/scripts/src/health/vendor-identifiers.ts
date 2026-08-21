import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { VENDOR_NAMES } from "./vendor-names.ts";

const VENDOR_SET = new Set(VENDOR_NAMES);

export interface VendorIdentifierFinding {
  file: string;
  line: number;
  position: "identifier" | "path";
  identifier: string;
  vendor: string;
}

export interface VendorScanOptions {
  exempt?: readonly string[];
  extensions?: readonly string[];
}

const DEFAULT_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
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

export function isExempt(relativePath: string, exempt: readonly string[]): boolean {
  return exempt.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

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
