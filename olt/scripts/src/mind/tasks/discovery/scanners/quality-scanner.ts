import { DEFAULT_SOURCE_EXTENSIONS, DEFAULT_EXCLUDE_PATTERNS } from "../types.ts";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { HarnessError } from "../../../../core/errors/index.ts";
import type {
  CodeQualityFinding,
  CodeQualityScanOptions,
  CodeQualityScanResult,
} from "../types.ts";
import { loadCharter, resolveCharterPath } from "../../../lifecycle/charter/index.ts";
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function resolveDiscoveryCharterPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  return resolveCharterPath(cwd);
}

export function collectFilesRecursively(
  root: string,
  dir: string,
  extensions: readonly string[],
  excludePatterns: readonly string[],
  accumulated: string[] = [],
): string[] {
  if (!existsSync(dir)) return accumulated;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relFromRoot = relative(root, fullPath);
    const segments = relFromRoot.split(/[/\\]/);
    const shouldExclude = segments.some((seg) => excludePatterns.includes(seg));
    if (shouldExclude) continue;

    if (entry.isDirectory()) {
      collectFilesRecursively(root, fullPath, extensions, excludePatterns, accumulated);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        accumulated.push(fullPath);
      }
    }
  }

  return accumulated;
}

/**
 * Scans codebase files for code quality defects:
 * - TypeScript `any` types
 * - Compiler suppressions (@ts-ignore, @ts-nocheck, @ts-expect-error, eslint-disable)
 * - Literal fallbacks / TODOs / FIXMEs / hardcoded stubs
 * - Oversized modules exceeding line thresholds
 * - Unexported dead code (unreferenced top-level private declarations)
 */
export function scanCodeQuality(options: CodeQualityScanOptions = {}): CodeQualityScanResult {
  const startTime = Date.now();
  const roots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxLineThreshold = options.maxLineThreshold ? options.maxLineThreshold : 800;
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  const allFiles: string[] = [];
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    collectFilesRecursively(resolvedRoot, resolvedRoot, extensions, excludes, allFiles);
  }

  const findings: CodeQualityFinding[] = [];

  for (const file of allFiles) {
    if (findings.length >= maxFindings) break;

    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      const isTestFile = file.includes(".test.") || file.includes(".spec.");

      // Check 1: Oversized module
      if (lines.length > maxLineThreshold) {
        findings.push({
          file,
          issueType: "OVERSIZED_MODULE",
          description: `Module length of ${lines.length} lines exceeds recommended limit of ${maxLineThreshold} lines`,
          severity: "LOW",
          suggestedRemediation:
            "Refactor module into modular sub-components or distinct domain helpers.",
        });
      }

      // Check 2: Unexported dead code detection (for non-test modules)
      if (!isTestFile && lines.length > 5) {
        const topLevelDeclRegex =
          /^(?:function|const|let|var|class|interface|type)\s+([A-Za-z0-9_$]+)/;
        for (let idx = 0; idx < lines.length; idx++) {
          if (findings.length >= maxFindings) break;
          const currentLine = lines[idx];
          if (!currentLine) continue;
          const lineTrimmed = currentLine.trim();
          if (
            lineTrimmed.startsWith("export ") ||
            lineTrimmed.startsWith("//") ||
            lineTrimmed.startsWith("/*")
          ) {
            continue;
          }

          const declMatch = topLevelDeclRegex.exec(lineTrimmed);
          if (declMatch && declMatch[1]) {
            const ident = declMatch[1];
            // Skip common boilerplate identifiers
            if (
              ident.startsWith("DEFAULT_") ||
              ident === "map" ||
              ident === "lines" ||
              ident.length < 3
            ) {
              continue;
            }
            const identRegex = new RegExp(`\\b${ident}\\b`, "g");
            const matchCount = content.match(identRegex) ? content.match(identRegex)!.length : 0;
            if (matchCount === 1) {
              findings.push({
                file,
                line: idx + 1,
                issueType: "UNEXPORTED_DEAD_CODE",
                description: `Unexported top-level declaration '${ident}' on line ${idx + 1} is never referenced in file`,
                snippet: lineTrimmed,
                severity: "MEDIUM",
                suggestedRemediation: `Export '${ident}' if intended for external consumption, or remove unused dead code declaration.`,
              });
            }
          }
        }
      }

      // Check lines for suppressions, any keyword, fallbacks, and markers
      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= maxFindings) break;
        const line = lines[i];
        if (!line) continue;
        const lineNum = i + 1;
        const trimmed = line.trim();

        // Check 3: Compiler suppressions
        if (
          trimmed.includes("@" + "ts-ignore") ||
          trimmed.includes("@" + "ts-nocheck") ||
          trimmed.includes("@" + "ts-expect-error") ||
          trimmed.includes("eslint" + "-disable")
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "COMPILER_SUPPRESSION",
            description: `TypeScript compiler suppression detected on line ${lineNum}: "${trimmed.slice(0, 60)}"`,
            snippet: trimmed,
            severity: "HIGH",
            suggestedRemediation:
              "Remove compiler suppression and provide explicit, rigorous TypeScript type definitions.",
          });
        }

        // Check 4: unknown type annotations (e.g. `: unknown`, `<unknown>`, `as any`, `Promise<unknown>`)
        if (
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*") &&
          (/\b:\s*any\b/.test(trimmed) ||
            /\b<unknown>\b/.test(trimmed) ||
            /\bas\s+any\b/.test(trimmed) ||
            /\bArray<unknown>\b/.test(trimmed) ||
            /\bPromise<unknown>\b/.test(trimmed) ||
            /\bRecord<[^,]+,\s*any\b/.test(trimmed) ||
            /\bRecord<any\s*,/.test(trimmed) ||
            /\(\s*[A-Za-z0-9_$]+\s*:\s*any\b/.test(trimmed))
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "TYPE_SAFETY_ANY",
            description: `Unconstrained 'any' type annotation on line ${lineNum}: "${trimmed.slice(0, 60)}"`,
            snippet: trimmed,
            severity: "HIGH",
            suggestedRemediation:
              "Replace 'any' with strict discriminated unions, unknown with type guards, or generic contracts.",
          });
        }

        // Check 5: Literal fallbacks / hardcoded stub returns
        if (
          !isTestFile &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*") &&
          (/\breturn\s+["'](TODO|FIXME|STUB|MOCK|dummy|placeholder)["']/i.test(trimmed) ||
            /\breturn\s+(?:null|undefined)\s+as\s+unknown\s+as\b/.test(trimmed) ||
            /\bconst\s+(?:FALLBACK_|STUB_|DUMMY_|MOCK_)/.test(trimmed) ||
            /\b(?:is_fallback|isFallback|literal_fallback)\s*:\s*true\b/.test(trimmed) ||
            trimmed.includes("// FALLBACK") ||
            trimmed.includes("/* FALLBACK"))
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "LITERAL_FALLBACK",
            description: `Plausible literal fallback or stub detected on line ${lineNum}: "${trimmed.slice(0, 60)}"`,
            snippet: trimmed,
            severity: "HIGH",
            suggestedRemediation:
              "Replace synthetic literal fallback with verified domain logic or explicit failure contract.",
          });
        }

        // Check 6: Unaddressed TODO / FIXME / HACK markers
        if (
          /\b(TODO|FIXME|HACK|XXX|BUG)\b/i.test(trimmed) &&
          (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"))
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "TODO_FIXME_MARKER",
            description: `Unresolved work marker on line ${lineNum}: "${trimmed.slice(0, 60)}"`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation: "Implement planned logic or formalize into a tracked task.",
          });
        }
      }
    } catch {
      // Skip unreadable files gracefully
    }
  }

  return {
    findings,
    filesScanned: allFiles.length,
    totalFindings: findings.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Scans source and test trees to discover test coverage gaps:
 * - Source modules without matching test files in tests/unit/
 * - Skipped test suites (test.skip, describe.skip)
 * - Empty or missing test assertions
 * - Low assertion density (test suites lacking adequate expect assertions)
 */
