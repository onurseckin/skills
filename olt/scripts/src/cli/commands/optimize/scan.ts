import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";
import { HarnessError, type JsonValue } from "../../../core/index.ts";

export interface ScanViolation {
  readonly file: string;
  readonly pillar: string;
  readonly line?: number | undefined;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface ScanOptions {
  readonly rootDir?: string | undefined;
  readonly pillar?: string | undefined;
  readonly limit?: number | undefined;
  readonly strict?: boolean | undefined;
  readonly files?: Readonly<Record<string, string>> | undefined;
}

export interface ScanResult {
  readonly passed: boolean;
  readonly totalFilesScanned: number;
  readonly violationsCount: number;
  readonly violations: readonly ScanViolation[];
  readonly markdown: string;
}

export interface ScanCommandContext extends CommandContext {
  readonly files?: Readonly<Record<string, string>> | undefined;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".olt",
  "dist",
  "build",
  "coverage",
  ".coverage",
  ".turbo",
  ".cache",
  ".next",
  "out",
]);
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const PURITY_CHECKS: readonly [RegExp, string][] = [
  [/\bsetTimeout\s*\(/, "Test impurity detected: wall-clock timer 'setTimeout'"],
  [/\bsetInterval\s*\(/, "Test impurity detected: wall-clock timer 'setInterval'"],
  [/\bsleep\s*\(/, "Test impurity detected: wall-clock timer 'sleep'"],
  [/\bfetch\s*\(/, "Test impurity detected: network call 'fetch'"],
  [/\bhttp\./, "Test impurity detected: network call 'http.'"],
  [/\bhttps\./, "Test impurity detected: network call 'https.'"],
  [/\bnet\.connect\b/, "Test impurity detected: network call 'net.connect'"],
];

const SUPPRESSIONS: readonly [RegExp, string][] = [
  [/@ts-ignore\b/, "Type safety violation: compiler suppression '@ts-ignore' detected"],
  [/@ts-expect-error\b/, "Type safety violation: compiler suppression '@ts-expect-error' detected"],
  [/@ts-nocheck\b/, "Type safety violation: compiler suppression '@ts-nocheck' detected"],
];

const TYPE_ESCAPES: readonly [RegExp, string][] = [
  [/(?::\s*any\b)/, "Type safety violation: untyped escape hatch ': any' detected"],
  [/\bas\s+any\b/, "Type safety violation: type assertion 'as any' detected"],
  [/<any>/, "Type safety violation: type assertion '<any>' detected"],
  [/\bas\s+unknown\s+as\b/, "Type safety violation: double cast 'as unknown as' detected"],
];

function isTestPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  return (
    norm.includes("/tests/") ||
    norm.startsWith("tests/") ||
    norm.includes("/test/") ||
    norm.startsWith("test/") ||
    /\.(test|spec)\.[a-zA-Z0-9]+$/.test(norm)
  );
}

function isIgnoredPath(p: string): boolean {
  return p
    .replace(/\\/g, "/")
    .split("/")
    .some((part) => IGNORED_DIRS.has(part));
}

function matchesPillar(candidate: string, filter?: string | undefined): boolean {
  if (filter === undefined || filter.length === 0) return true;
  const clean = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  return clean(candidate) === clean(filter);
}

function checkModularity(filePath: string, content: string): ScanViolation[] {
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  const count = content.trim().length === 0 ? 0 : lines.length;
  if (count > 400) {
    return [
      {
        file: filePath,
        pillar: "Modularity",
        line: 401,
        message: `File exceeds 400 SLOC limit (${count} lines)`,
        severity: "error",
      },
    ];
  }
  return [];
}

function checkPurity(filePath: string, content: string): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const [re, msg] of PURITY_CHECKS) {
      if (re.test(line))
        violations.push({
          file: filePath,
          pillar: "Purity",
          line: idx + 1,
          message: msg,
          severity: "error",
        });
    }
  }
  return violations;
}

function checkTypeSafety(filePath: string, content: string): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const lines = content.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const trimmed = line.trim();
    for (const [re, msg] of SUPPRESSIONS) {
      if (re.test(line))
        violations.push({
          file: filePath,
          pillar: "Type Safety",
          line: idx + 1,
          message: msg,
          severity: "error",
        });
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const [re, msg] of TYPE_ESCAPES) {
      if (re.test(line))
        violations.push({
          file: filePath,
          pillar: "Type Safety",
          line: idx + 1,
          message: msg,
          severity: "error",
        });
    }
  }
  return violations;
}

function checkHotPathLatency(filePath: string, content: string): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const lines = content.split("\n");
  let loopDepth = 0;
  let braceDepth = 0;
  const loopEndDepths: number[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    if (/\bJSON\.parse\s*\(\s*JSON\.stringify\s*\(/.test(line)) {
      violations.push({
        file: filePath,
        pillar: "Hot-Path Latency",
        line: idx + 1,
        message: "Redundant allocation: deep clone via JSON.parse(JSON.stringify(...))",
        severity: "warning",
      });
    }

    const isLoop = /\b(for\s*\(|while\s*\(|for\s+await\s*\(|\.forEach\s*\(|\.map\s*\()/.test(line);
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (isLoop) {
      loopEndDepths.push(braceDepth);
      loopDepth++;
    }

    const syncMatch = line.match(
      /\b(readFileSync|writeFileSync|appendFileSync|execSync|spawnSync)\b/,
    );
    if (syncMatch && loopDepth > 0) {
      const matchedFn = syncMatch[1] ?? "sync-io";
      violations.push({
        file: filePath,
        pillar: "Hot-Path Latency",
        line: idx + 1,
        message: `Sequential sync I/O in loop: '${matchedFn}' detected`,
        severity: "warning",
      });
    }

    braceDepth += opens - closes;
    while (
      loopEndDepths.length > 0 &&
      braceDepth <= (loopEndDepths[loopEndDepths.length - 1] ?? 0)
    ) {
      loopEndDepths.pop();
      loopDepth = Math.max(0, loopDepth - 1);
    }
  }
  return violations;
}

function checkErgonomics(filePath: string, content: string): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const lines = content.split("\n");
  const declaredHelpers = new Map<string, number>();

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    const fnMatch = line.match(/^function\s+([a-zA-Z0-9_$]+)\s*\(/);
    const arrowMatch = line.match(
      /^(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)?\s*=>/,
    );
    const exprMatch = line.match(/^(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*function\b/);
    const match = fnMatch ?? arrowMatch ?? exprMatch;

    if (match && !line.startsWith("export ")) {
      const name = match[1] ?? "";
      if (name) {
        if (declaredHelpers.has(name)) {
          violations.push({
            file: filePath,
            pillar: "Ergonomics",
            line: idx + 1,
            message: `Duplicate helper detected: '${name}' is declared multiple times`,
            severity: "warning",
          });
        } else {
          declaredHelpers.set(name, idx + 1);
        }
      }
    }
  }

  for (const [name, lineNum] of declaredHelpers) {
    const count = (content.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (count <= 1) {
      violations.push({
        file: filePath,
        pillar: "Ergonomics",
        line: lineNum,
        message: `Dead unexported utility: '${name}' is declared but never referenced`,
        severity: "warning",
      });
    }
  }
  return violations;
}

function scanFile(filePath: string, content: string): ScanViolation[] {
  if (isTestPath(filePath)) return checkPurity(filePath, content);
  return [
    ...checkModularity(filePath, content),
    ...checkTypeSafety(filePath, content),
    ...checkHotPathLatency(filePath, content),
    ...checkErgonomics(filePath, content),
  ];
}

function walkDirectory(dir: string, fileList: string[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      const entryName = String(entry.name);
      if (entryName.startsWith(".") && entryName !== ".olt") continue;
      if (IGNORED_DIRS.has(entryName)) continue;
      const full = join(dir, entryName);
      if (entry.isDirectory()) walkDirectory(full, fileList);
      else if (entry.isFile() && CODE_EXTS.has(extname(entryName))) fileList.push(full);
    }
  } catch {
    return;
  }
}

function formatMarkdownReport(
  totalFiles: number,
  violations: readonly ScanViolation[],
  pillarCounts: Readonly<Record<string, number>>,
): string {
  const pillars = ["Modularity", "Purity", "Type Safety", "Hot-Path Latency", "Ergonomics"];
  const lines: string[] = [
    "### Codebase Optimization Scan Report",
    "",
    "| Pillar | Status | Violations |",
    "| :--- | :--- | :--- |",
  ];
  for (const p of pillars) {
    const c = pillarCounts[p] ?? 0;
    lines.push(`| ${p} | ${c === 0 ? "PASSED" : "FAILED"} | ${c} |`);
  }
  lines.push("");
  lines.push(
    `**Files Scanned:** ${totalFiles} | **Violations:** ${violations.length} | **Status:** ${violations.length === 0 ? "PASSED" : "FAILED"}`,
  );

  if (violations.length > 0) {
    lines.push("");
    lines.push("| File | Pillar | Line | Message |");
    lines.push("| :--- | :--- | :--- | :--- |");
    const displayed = violations.slice(0, 14);
    for (const v of displayed) {
      const lineStr = v.line !== undefined ? String(v.line) : "-";
      const msg = v.message.length > 60 ? `${v.message.slice(0, 57)}...` : v.message;
      lines.push(`| ${v.file} | ${v.pillar} | ${lineStr} | ${msg} |`);
    }
    if (violations.length > 14) lines.push(`*... and ${violations.length - 14} more violation(s)*`);
  }
  return lines.length > 30 ? lines.slice(0, 30).join("\n") : lines.join("\n");
}

export function scanCodebase(options: ScanOptions): ScanResult {
  const allViolations: ScanViolation[] = [];
  const pillarCounts: Record<string, number> = {};
  let totalFilesScanned = 0;

  if (options.files !== undefined) {
    for (const [filePath, content] of Object.entries(options.files)) {
      if (isIgnoredPath(filePath)) continue;
      totalFilesScanned++;
      for (const v of scanFile(filePath, content)) {
        pillarCounts[v.pillar] = (pillarCounts[v.pillar] ?? 0) + 1;
        if (matchesPillar(v.pillar, options.pillar)) allViolations.push(v);
      }
    }
  } else {
    const root = options.rootDir ?? ".";
    if (existsSync(root)) {
      const files: string[] = [];
      walkDirectory(root, files);
      for (const filePath of files) {
        if (isIgnoredPath(filePath)) continue;
        try {
          const content = readFileSync(filePath, "utf-8");
          totalFilesScanned++;
          for (const v of scanFile(filePath, content)) {
            pillarCounts[v.pillar] = (pillarCounts[v.pillar] ?? 0) + 1;
            if (matchesPillar(v.pillar, options.pillar)) allViolations.push(v);
          }
        } catch {}
      }
    }
  }

  const bounded =
    options.limit !== undefined && options.limit > 0
      ? allViolations.slice(0, options.limit)
      : allViolations;

  const passed = bounded.length === 0;
  const markdown = formatMarkdownReport(totalFilesScanned, bounded, pillarCounts);

  if (options.strict === true && bounded.length > 0) {
    const issues: readonly JsonValue[] = bounded.map((v) => ({
      file: v.file,
      pillar: v.pillar,
      line: v.line ?? null,
      message: v.message,
      severity: v.severity,
    }));
    throw new HarnessError(
      "INVALID_STATE",
      `Codebase optimization scan failed with ${bounded.length} violation(s)`,
      issues,
    );
  }

  return {
    passed,
    totalFilesScanned,
    violationsCount: bounded.length,
    violations: bounded,
    markdown,
  };
}

export async function optimizeScanCommand(
  flags: Flags,
  context?: CommandContext,
): Promise<Record<string, unknown>> {
  const dirFlag = textFlag(flags, "dir", false);
  const rootFlag = textFlag(flags, "root", false);
  const rootDir = dirFlag ?? rootFlag ?? ".";
  const strict = boolFlag(flags, "strict");
  const json = boolFlag(flags, "json");
  const pillar = textFlag(flags, "pillar", false);
  const limit = integerFlag(flags, "limit", { minimum: 1 });
  const memFiles = (context as ScanCommandContext | undefined)?.files;

  const result = scanCodebase({ rootDir, strict, pillar, limit, files: memFiles });
  return {
    passed: result.passed,
    totalFilesScanned: result.totalFilesScanned,
    violationsCount: result.violationsCount,
    violations: result.violations,
    markdown: result.markdown,
    ...(json ? { json: true } : {}),
  };
}
