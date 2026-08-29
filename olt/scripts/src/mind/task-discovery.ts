import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { auditDefectLog, type DefectEntry } from "./defects.ts";
import { parseCharter, resolveCharterPath, type ParsedCharter } from "./charter.ts";
import { readFeedbackQueue, type FeedbackItem, type FeedbackPriority } from "./feedback-queue.ts";
import {
  findSourceDefinition,
  getSourceEmpiricalCommand,
  getSourceRevalidationGate,
  mapDiscoveryCategoryToSourceId,
  MIND_DISCOVERY_SOURCES,
  type MindSourceDefinition,
} from "./sources.ts";
import {
  enqueueTasksBatch,
  readTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskSourceType,
} from "./task-queue.ts";

export type DiscoveryCategory =
  | "CODE_QUALITY"
  | "TEST_COVERAGE"
  | "DORMANT_CRITERIA"
  | "COGNITIVE_GAP"
  | "FEEDBACK_INTAKE"
  | "DEFECT_REMEDIATION"
  | "ARCHITECTURAL_HEALTH"
  | "CONTINUOUS_HARDENING";

export type DiscoverySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";

export type CodeQualityIssueType =
  | "TYPE_SAFETY_ANY"
  | "COMPILER_SUPPRESSION"
  | "LITERAL_FALLBACK"
  | "TODO_FIXME_MARKER"
  | "OVERSIZED_MODULE"
  | "UNEXPORTED_DEAD_CODE"
  | "DOCUMENTATION_DEFICIT";

export interface CodeQualityFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: CodeQualityIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}

export interface CodeQualityScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly maxLineThreshold?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}

export interface CodeQualityScanResult {
  readonly findings: readonly CodeQualityFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}

export type TestCoverageIssueType =
  | "MISSING_TEST_FILE"
  | "SKIPPED_TESTS"
  | "EMPTY_TEST_SUITE"
  | "LOW_ASSERTION_DENSITY";

export interface TestCoverageFinding {
  readonly sourceFile: string;
  readonly testFile?: string | undefined;
  readonly issueType: TestCoverageIssueType;
  readonly description: string;
  readonly suggestedRemediation: string;
  readonly severity: DiscoverySeverity;
}

export interface TestCoverageScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
}

export interface TestCoverageScanResult {
  readonly findings: readonly TestCoverageFinding[];
  readonly sourceFilesScanned: number;
  readonly testFilesScanned: number;
  readonly missingTestCount: number;
  readonly skippedTestCount: number;
  readonly durationMs: number;
}

export type CognitiveIssueType =
  | "COGNITIVE_COMPLEXITY"
  | "COGNITIVE_CHUNKING_OVERLOAD"
  | "UNHANDLED_BOUNDARY"
  | "UNBOUNDED_COLLECTION"
  | "MISSING_ERROR_RECOVERY"
  | "ASYNC_UNCAUGHT_BOUNDARY";

export interface CognitiveGapFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: CognitiveIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}

export interface CognitiveGapScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}

export interface CognitiveGapScanResult {
  readonly findings: readonly CognitiveGapFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}

export interface DormantCriteriaFinding {
  readonly criteriaId: string;
  readonly source:
    | "charter_goal"
    | "charter_stability"
    | "prompt_requirement"
    | "unverified_backlog";
  readonly statement: string;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}

export interface DormantCriteriaScanOptions {
  readonly charterPath?: string | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly recentTasksHistory?: readonly TaskQueueItem[] | undefined;
  readonly maxFindings?: number | undefined;
}

export interface DormantCriteriaScanResult {
  readonly findings: readonly DormantCriteriaFinding[];
  readonly goalsCheckedCount: number;
  readonly dormantCount: number;
  readonly durationMs: number;
}

export type ArchitecturalHealthIssueType =
  | "BROKEN_IMPORT"
  | "ORPHAN_MODULE"
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_ARCHITECTURAL_FILE";

export interface ArchitecturalHealthFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: ArchitecturalHealthIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}

export interface ArchitecturalHealthScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}

export interface ArchitecturalHealthScanResult {
  readonly findings: readonly ArchitecturalHealthFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}

export interface CandidateEvolutionProposal {
  readonly id: string;
  readonly kind: "proposal" | "defect";
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly targetFiles: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly charterGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly priority: TaskPriority;
  readonly sourceType: TaskSourceType;
  readonly estimatedEffort?: "SMALL" | "MEDIUM" | "LARGE" | undefined;
  readonly cognitiveDimension?: string | undefined;
}

export interface DiscoveryItem {
  readonly id: string;
  readonly category: DiscoveryCategory;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly targetFiles: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly charterGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly remediation: string;
  readonly sourceType: TaskSourceType;
  readonly sourceReference?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DiscoveredTaskPlan {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly source_type: TaskSourceType;
  readonly priority: TaskPriority;
  readonly rationale: string;
  readonly assigned_tier:
    | "Tier_0_Mind"
    | "Tier_1_Orchestrator"
    | "Tier_2_Coordinator"
    | "Tier_3_Implementer"
    | "Tier_3_Validator";
  readonly assigned_implementer: string;
  readonly assigned_validator: string;
  readonly candidate_id?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TaskDiscoveryOptions {
  readonly workspaceRoot?: string | undefined;
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly charterPath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly maxTasks?: number | undefined;
  readonly enableCodeQualityScan?: boolean | undefined;
  readonly enableTestCoverageScan?: boolean | undefined;
  readonly enableCognitiveGapScan?: boolean | undefined;
  readonly enableDormantCriteriaScan?: boolean | undefined;
  readonly enableArchitecturalHealthScan?: boolean | undefined;
  readonly enableFeedbackQueueScan?: boolean | undefined;
  readonly enableDefectScan?: boolean | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly actor?: string | undefined;
}

export interface TaskDiscoveryResult {
  readonly scannedAt: string;
  readonly findings: {
    readonly codeQuality: readonly CodeQualityFinding[];
    readonly testCoverage: readonly TestCoverageFinding[];
    readonly cognitiveGaps: readonly CognitiveGapFinding[];
    readonly dormantCriteria: readonly DormantCriteriaFinding[];
    readonly architecturalHealth: readonly ArchitecturalHealthFinding[];
    readonly feedbackPending: readonly FeedbackItem[];
    readonly openDefects: readonly DefectEntry[];
  };
  readonly discoveries: readonly DiscoveryItem[];
  readonly candidateProposals: readonly CandidateEvolutionProposal[];
  readonly synthesizedPlans: readonly DiscoveredTaskPlan[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly stats: {
    readonly totalFindings: number;
    readonly codeQualityCount: number;
    readonly testCoverageCount: number;
    readonly cognitiveGapCount: number;
    readonly dormantCriteriaCount: number;
    readonly architecturalHealthCount: number;
    readonly feedbackCount: number;
    readonly defectCount: number;
    readonly synthesizedCount: number;
    readonly enqueuedCount: number;
  };
  readonly summary: string;
}

const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = [".ts", ".js", ".tsx", ".jsx"];
const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "node_modules",
  ".git",
  ".capsules",
  "dist",
  "build",
];

function sanitizeSlug(input: string): string {
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

function collectFilesRecursively(
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

        // Check 4: any type annotations (e.g. `: any`, `<any>`, `as any`, `Promise<any>`)
        if (
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*") &&
          (/\b:\s*any\b/.test(trimmed) ||
            /\b<any>\b/.test(trimmed) ||
            /\bas\s+any\b/.test(trimmed) ||
            /\bArray<any>\b/.test(trimmed) ||
            /\bPromise<any>\b/.test(trimmed) ||
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
export function scanTestCoverage(options: TestCoverageScanOptions = {}): TestCoverageScanResult {
  const startTime = Date.now();
  const sourceRoots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const testRoots =
    options.testRoots && options.testRoots.length > 0 ? options.testRoots : ["tests/unit", "tests"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  const sourceFiles: string[] = [];
  for (const root of sourceRoots) {
    const resolved = resolve(root);
    collectFilesRecursively(resolved, resolved, extensions, excludes, sourceFiles);
  }

  const testFiles: string[] = [];
  for (const root of testRoots) {
    const resolved = resolve(root);
    collectFilesRecursively(resolved, resolved, extensions, excludes, testFiles);
  }

  const testFileMap = new Map<string, string>();
  for (const tf of testFiles) {
    testFileMap.set(basename(tf), tf);
  }

  const findings: TestCoverageFinding[] = [];
  let missingTestCount = 0;
  let skippedTestCount = 0;

  for (const sf of sourceFiles) {
    if (findings.length >= maxFindings) break;

    const base = basename(sf, extname(sf));
    // Skip index or type-only definition files from strict 1:1 test requirement if small
    if (base === "index" || base === "types" || base.endsWith(".d")) {
      continue;
    }

    const expectedTestName1 = `${base}.test.ts`;
    const expectedTestName2 = `${base}.spec.ts`;

    const matchedTest = testFileMap.get(expectedTestName1)
      ? testFileMap.get(expectedTestName1)
      : testFileMap.get(expectedTestName2);

    if (!matchedTest) {
      missingTestCount++;
      findings.push({
        sourceFile: sf,
        issueType: "MISSING_TEST_FILE",
        description: `Missing dedicated unit test suite for source module: ${basename(sf)}`,
        suggestedRemediation: `Create unit test suite at tests/unit/${relative(process.cwd(), sf)
          .replace(/scripts\/src\//, "")
          .replace(/\.ts$/, ".test.ts")}`,
        severity: "HIGH",
      });
    }
  }

  // Scan existing test files for skipped tests, empty suites, and low assertion density
  for (const tf of testFiles) {
    if (findings.length >= maxFindings) break;

    try {
      const content = readFileSync(tf, "utf8");
      if (
        content.includes("test.skip(") ||
        content.includes("describe.skip(") ||
        content.includes("it.skip(") ||
        content.includes("xit(") ||
        content.includes("xtest(")
      ) {
        skippedTestCount++;
        findings.push({
          sourceFile: tf,
          testFile: tf,
          issueType: "SKIPPED_TESTS",
          description: `Skipped test cases detected in test suite: ${basename(tf)}`,
          suggestedRemediation:
            "Re-enable skipped tests and repair any underlying assertion failures.",
          severity: "MEDIUM",
        });
      }

      const hasTestBlock = content.includes("test(") || content.includes("it(");
      if (!hasTestBlock && !content.includes("describe(")) {
        findings.push({
          sourceFile: tf,
          testFile: tf,
          issueType: "EMPTY_TEST_SUITE",
          description: `Empty test suite without test assertions: ${basename(tf)}`,
          suggestedRemediation:
            "Implement comprehensive assertions covering positive and negative cases.",
          severity: "HIGH",
        });
      } else if (hasTestBlock) {
        // Assertion density check: count expect() assertions
        const expectMatches = content.match(/\bexpect\s*\(/g);
        const expectCount = expectMatches ? expectMatches.length : 0;
        if (expectCount === 0) {
          findings.push({
            sourceFile: tf,
            testFile: tf,
            issueType: "LOW_ASSERTION_DENSITY",
            description: `Test suite ${basename(tf)} has zero expect() assertion calls`,
            suggestedRemediation:
              "Add explicit expect() assertions verifying return values and invariants.",
            severity: "HIGH",
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return {
    findings,
    sourceFilesScanned: sourceFiles.length,
    testFilesScanned: testFiles.length,
    missingTestCount,
    skippedTestCount,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Scans codebase files for cognitive complexity and architectural gap issues:
 * - Deeply nested logic blocks exceeding indentation thresholds
 * - Cognitive parameter overloading (> 5 positional parameters)
 * - Unhandled raw JSON parses lacking try/catch protection
 * - Unbounded collections or infinite loops lacking bounds
 * - Missing error recovery (empty catch blocks)
 * - Async uncaught boundaries
 */
export function scanCognitiveGaps(options: CognitiveGapScanOptions = {}): CognitiveGapScanResult {
  const startTime = Date.now();
  const roots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  const allFiles: string[] = [];
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    collectFilesRecursively(resolvedRoot, resolvedRoot, extensions, excludes, allFiles);
  }

  const findings: CognitiveGapFinding[] = [];

  for (const file of allFiles) {
    if (findings.length >= maxFindings) break;

    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= maxFindings) break;
        const line = lines[i];
        if (!line) continue;
        const lineNum = i + 1;
        const trimmed = line.trim();

        // Check 1: Deep nesting (> 20 leading spaces or > 5 tabs) indicating cognitive overload
        const leadingSpaces = line.search(/\S/);
        if (leadingSpaces >= 20 && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
          findings.push({
            file,
            line: lineNum,
            issueType: "COGNITIVE_COMPLEXITY",
            description: `Excessive nesting depth (${leadingSpaces} spaces) on line ${lineNum}: "${trimmed.slice(0, 50)}"`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation:
              "Extract deeply nested conditionals or loops into focused helper functions.",
          });
        }

        // Check 2: Cognitive Chunking Overload - Function definition with > 5 parameters
        if (
          /function\s+\w+\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/.test(line) ||
          /\(\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^)]*\)\s*=>/.test(
            line,
          )
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "COGNITIVE_CHUNKING_OVERLOAD",
            description: `Function exceeds Cowan/Miller chunking capacity with >5 positional parameters on line ${lineNum}`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation:
              "Consolidate parameters into a structured options interface object.",
          });
        }

        // Check 3: Raw JSON.parse without safe parser wrapper or try-catch context in immediate vicinity
        if (
          trimmed.includes("JSON.parse(") &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*")
        ) {
          const priorLines = lines.slice(Math.max(0, i - 4), i).join(" ");
          if (
            !priorLines.includes("try {") &&
            !priorLines.includes("try{") &&
            !priorLines.includes("try ")
          ) {
            findings.push({
              file,
              line: lineNum,
              issueType: "UNHANDLED_BOUNDARY",
              description: `Unprotected JSON.parse boundary on line ${lineNum}: "${trimmed.slice(0, 50)}"`,
              snippet: trimmed,
              severity: "HIGH",
              suggestedRemediation:
                "Wrap JSON.parse in try/catch or use a resilient parsing utility.",
            });
          }
        }

        // Check 4: Unbounded collection / infinite loop
        if (
          trimmed.startsWith("while (true)") ||
          trimmed.startsWith("while(true)") ||
          trimmed.startsWith("while (1)")
        ) {
          const bodyLines: string[] = [];
          let depth = 0;
          for (let k = i; k < lines.length; k++) {
            const l = lines[k] ? lines[k]!.trim() : "";
            const openBraces = l.match(/\{/g);
            const closeBraces = l.match(/\}/g);
            if (openBraces) depth += openBraces.length;
            if (closeBraces) depth -= closeBraces.length;
            if (k > i) bodyLines.push(l);
            if (depth <= 0 && k > i) break;
          }
          const body = bodyLines.join(" ");
          if (!body.includes("break") && !body.includes("return") && !body.includes("throw")) {
            findings.push({
              file,
              line: lineNum,
              issueType: "UNBOUNDED_COLLECTION",
              description: `Unbounded while(true) loop lacking explicit termination bound on line ${lineNum}`,
              snippet: trimmed,
              severity: "HIGH",
              suggestedRemediation: "Add bounded loop counter or explicit termination conditions.",
            });
          }
        }

        // Check 5: Missing error recovery (empty catch blocks - single line and multi-line)
        const isCatchHeader =
          trimmed.startsWith("catch") || trimmed.endsWith("catch {") || trimmed.includes("} catch");
        const nextTrimmed = lines[i + 1] ? lines[i + 1]!.trim() : "";
        const nextNextTrimmed = lines[i + 2] ? lines[i + 2]!.trim() : "";
        const isMultiLineEmptyCatch =
          isCatchHeader &&
          (nextTrimmed === "}" || (nextTrimmed.startsWith("//") && nextNextTrimmed === "}"));

        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(trimmed) || isMultiLineEmptyCatch) {
          findings.push({
            file,
            line: lineNum,
            issueType: "MISSING_ERROR_RECOVERY",
            description: `Empty catch block swallowing errors silently on line ${lineNum}`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation: "Log error, rethrow, or handle with resilient fallback recovery.",
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
 * Scans charter goals and recent task history to discover dormant criteria:
 * - Goals defined in mind.yaml that have zero associated tasks or tests
 * - Stability checks that have not been exercised
 */
export function scanDormantCriteria(
  options: DormantCriteriaScanOptions = {},
): DormantCriteriaScanResult {
  const startTime = Date.now();
  const charterPath = resolveDiscoveryCharterPath(options.charterPath);
  const maxFindings = options.maxFindings ? options.maxFindings : 20;

  const findings: DormantCriteriaFinding[] = [];
  let goalsCheckedCount = 0;

  if (!existsSync(charterPath)) {
    return {
      findings: [
        {
          criteriaId: "missing-charter",
          source: "charter_goal",
          statement: "Charter document is missing at expected location",
          severity: "CRITICAL",
          suggestedRemediation:
            "Create olt/agents/mind.yaml with valid identity, goals, and repo_roots sections.",
        },
      ],
      goalsCheckedCount: 0,
      dormantCount: 1,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const rawContent = readFileSync(charterPath, "utf8");
    const parsed = parseCharter(rawContent);

    // Read task history from queue or provided history
    const taskHistory = options.recentTasksHistory
      ? options.recentTasksHistory
      : readTaskQueue(options.taskQueuePath);
    const targetedGoals = new Set<string>();

    for (const task of taskHistory) {
      for (const g of task.charter_goals) {
        targetedGoals.add(g.toUpperCase().trim());
      }
    }

    goalsCheckedCount = parsed.goals.length;

    for (const goal of parsed.goals) {
      if (findings.length >= maxFindings) break;
      const normalizedId = goal.id.toUpperCase().trim();

      if (!targetedGoals.has(normalizedId)) {
        findings.push({
          criteriaId: goal.id,
          source: "charter_goal",
          statement: goal.statement,
          severity: "MEDIUM",
          suggestedRemediation: `Synthesize dedicated task targeting dormant charter goal ${goal.id}: "${goal.statement}"`,
        });
      }
    }

    // Check stability checks
    const stabilityChecks = parsed.stability ? parsed.stability : [];
    for (const check of stabilityChecks) {
      if (findings.length >= maxFindings) break;
      if (!check.command.trim()) {
        findings.push({
          criteriaId: `stability-${sanitizeSlug(check.command)}`,
          source: "charter_stability",
          statement: `Stability check: ${check.command}`,
          severity: "LOW",
          suggestedRemediation: `Ensure automated test verifies exit code ${check.expectedExit} for command "${check.command}"`,
        });
      }
    }
  } catch (err) {
    if (err instanceof HarnessError) {
      findings.push({
        criteriaId: "charter-parse-error",
        source: "charter_goal",
        statement: `Charter validation failed: ${err.message}`,
        severity: "CRITICAL",
        suggestedRemediation:
          "Repair olt/agents/mind.yaml formatting per CONTRACTS.md §7 standards.",
      });
    }
  }

  return {
    findings,
    goalsCheckedCount,
    dormantCount: findings.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Scans architectural health across source modules:
 * - Broken relative imports pointing to missing files
 * - Circular module import dependencies
 * - Orphan modules not imported anywhere in tree
 */
export function scanArchitecturalHealth(
  options: ArchitecturalHealthScanOptions = {},
): ArchitecturalHealthScanResult {
  const startTime = Date.now();
  const roots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxFindings = options.maxFindings ? options.maxFindings : 30;

  const allFiles: string[] = [];
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    collectFilesRecursively(resolvedRoot, resolvedRoot, extensions, excludes, allFiles);
  }

  const findings: ArchitecturalHealthFinding[] = [];
  const fileImportMap = new Map<string, string[]>();

  // Pass 1: Parse imports per file
  for (const file of allFiles) {
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      const importedPaths: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= maxFindings) break;
        const line = lines[i];
        if (!line) continue;
        const trimmed = line.trim();

        // Extract relative imports: from "./..." or from "../..."
        const importMatch = /from\s+["'](\.\.?\/[^"']+)["']/.exec(trimmed);
        if (importMatch && importMatch[1]) {
          const importRel = importMatch[1];
          const dir = dirname(file);
          let targetPath = resolve(dir, importRel);

          // If no extension or ts/js extension
          if (!existsSync(targetPath)) {
            if (existsSync(`${targetPath}.ts`)) {
              targetPath = `${targetPath}.ts`;
            } else if (existsSync(`${targetPath}.tsx`)) {
              targetPath = `${targetPath}.tsx`;
            } else if (existsSync(`${targetPath}.js`)) {
              targetPath = `${targetPath}.js`;
            } else if (existsSync(join(targetPath, "index.ts"))) {
              targetPath = join(targetPath, "index.ts");
            } else {
              findings.push({
                file,
                line: i + 1,
                issueType: "BROKEN_IMPORT",
                description: `Broken relative import target '${importRel}' on line ${i + 1}`,
                snippet: trimmed,
                severity: "HIGH",
                suggestedRemediation: `Repair broken import path '${importRel}' in ${basename(file)}.`,
              });
            }
          }

          importedPaths.push(targetPath);
        }
      }

      fileImportMap.set(file, importedPaths);
    } catch {
      // Ignore unreadable
    }
  }

  // Pass 2: Detect Circular Dependencies (A -> B and B -> A)
  for (const [fileA, importsA] of fileImportMap.entries()) {
    if (findings.length >= maxFindings) break;
    for (const fileB of importsA) {
      if (fileA === fileB) continue;
      const importsB = fileImportMap.get(fileB);
      if (importsB && importsB.includes(fileA) && fileA < fileB) {
        findings.push({
          file: fileA,
          issueType: "CIRCULAR_DEPENDENCY",
          description: `Direct circular import dependency detected between ${basename(fileA)} and ${basename(fileB)}`,
          severity: "HIGH",
          suggestedRemediation: `Break circular dependency between ${basename(fileA)} and ${basename(fileB)} using common interfaces or extraction.`,
        });
      }
    }
  }

  return {
    findings,
    filesScanned: allFiles.length,
    totalFindings: findings.length,
    durationMs: Date.now() - startTime,
  };
}

function mapPriority(severity: DiscoverySeverity): TaskPriority {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    case "BACKGROUND":
      return "BACKGROUND";
    default:
      return "MEDIUM";
  }
}

function mapFeedbackPriorityToTaskPriority(p: FeedbackPriority): TaskPriority {
  switch (p) {
    case "CRITICAL_USER_FEEDBACK":
      return "CRITICAL";
    case "HIGH_ARCHITECTURAL_FEATURE":
      return "HIGH";
    case "USER_DIRECTIVE":
      return "HIGH";
    case "NORMAL":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

/**
 * Proposes structured candidate evolutions from discovered system gaps.
 */
export function proposeCandidateEvolutions(findings: {
  readonly codeQuality?: readonly CodeQualityFinding[] | undefined;
  readonly testCoverage?: readonly TestCoverageFinding[] | undefined;
  readonly cognitiveGaps?: readonly CognitiveGapFinding[] | undefined;
  readonly dormantCriteria?: readonly DormantCriteriaFinding[] | undefined;
  readonly architecturalHealth?: readonly ArchitecturalHealthFinding[] | undefined;
  readonly feedbackPending?: readonly FeedbackItem[] | undefined;
  readonly openDefects?: readonly DefectEntry[] | undefined;
}): readonly CandidateEvolutionProposal[] {
  const proposals: CandidateEvolutionProposal[] = [];

  // 1. Propose from cognitive gaps
  if (findings.cognitiveGaps) {
    for (const cg of findings.cognitiveGaps) {
      const fileBase = basename(cg.file, extname(cg.file));
      const slug = `${sanitizeSlug(fileBase)}-${sanitizeSlug(cg.issueType)}`;
      proposals.push({
        id: `cand-evo-cog-${slug}`,
        kind: "proposal",
        title: `Cognitive Gap: Remediate ${cg.issueType} in ${basename(cg.file)}`,
        statement: cg.description,
        rationale: `Cognitive ergonomics and readability: ${cg.suggestedRemediation}`,
        targetFiles: [cg.file],
        writeScope: [cg.file],
        gate: "bun test tests/unit/mind && bun run typecheck",
        charterGoals: ["G1", "G2"],
        acceptanceCriteria: [
          cg.suggestedRemediation,
          `Ensure cognitive complexity reduction in ${basename(cg.file)}`,
        ],
        priority: mapPriority(cg.severity),
        sourceType: "self_evolution",
        estimatedEffort: cg.severity === "HIGH" ? "MEDIUM" : "SMALL",
        cognitiveDimension: cg.issueType,
      });
    }
  }

  // 2. Propose from architectural health
  if (findings.architecturalHealth) {
    for (const ah of findings.architecturalHealth) {
      const fileBase = basename(ah.file, extname(ah.file));
      const slug = `${sanitizeSlug(fileBase)}-${sanitizeSlug(ah.issueType)}`;
      proposals.push({
        id: `cand-evo-arch-${slug}`,
        kind: "defect",
        title: `Architectural Health: Fix ${ah.issueType} in ${basename(ah.file)}`,
        statement: ah.description,
        rationale: ah.suggestedRemediation,
        targetFiles: [ah.file],
        writeScope: [ah.file],
        gate: "bun test tests/unit/mind && bun run typecheck",
        charterGoals: ["G1"],
        acceptanceCriteria: [
          ah.suggestedRemediation,
          `Ensure clean architectural topology in ${basename(ah.file)}`,
        ],
        priority: mapPriority(ah.severity),
        sourceType: "self_evolution",
        estimatedEffort: "MEDIUM",
      });
    }
  }

  // 3. Propose from feedback items
  if (findings.feedbackPending) {
    for (const fb of findings.feedbackPending) {
      const slug = sanitizeSlug(fb.id);
      proposals.push({
        id: `cand-evo-fb-${slug}`,
        kind: "proposal",
        title: fb.title,
        statement: fb.title,
        rationale: fb.content ? fb.content : fb.title,
        targetFiles: [`olt/scripts/src/mind/${slug}.ts`],
        writeScope: [`olt/scripts/src/mind/${slug}.ts`, `tests/unit/mind/${slug}.test.ts`],
        gate: `bun test tests/unit/mind/${slug}.test.ts && bun run typecheck`,
        charterGoals: ["G1"],
        acceptanceCriteria: [
          `Fulfill feedback requirement: ${fb.title}`,
          "0 any and 0 compiler suppressions",
        ],
        priority: mapFeedbackPriorityToTaskPriority(fb.priority),
        sourceType: "feedback_intake",
        estimatedEffort: "MEDIUM",
      });
    }
  }

  // 4. Propose from defects
  if (findings.openDefects) {
    for (const bl of findings.openDefects) {
      const slug = sanitizeSlug(bl.id);
      proposals.push({
        id: `cand-evo-defect-${slug}`,
        kind: "defect",
        title: `Remediate Defect: ${bl.observation.slice(0, 50)}`,
        statement: bl.observation,
        rationale: bl.remediation || "Fix root cause of defect with regression immunity",
        targetFiles: ["olt/scripts/src/mind/"],
        writeScope: ["olt/scripts/src/mind/", "tests/unit/mind/"],
        gate: "bun test tests/unit/mind && bun run typecheck",
        charterGoals: ["G2"],
        acceptanceCriteria: [
          `Resolve open defect ${bl.id}`,
          "Verify regression immunity with automated test",
        ],
        priority: "CRITICAL",
        sourceType: "defect_remediation",
        estimatedEffort: "LARGE",
      });
    }
  }

  return proposals;
}

/**
 * Synthesizes a structured DiscoveredTaskPlan from a generic DiscoveryItem.
 * Strictly guarantees Anti-Batching rules, isolated scopes, and 1:1 implementer-validator separation.
 */
export function synthesizeTaskFromDiscovery(item: DiscoveryItem, index = 1): DiscoveredTaskPlan {
  const taskSlug = sanitizeSlug(item.id);
  const taskId = `task-p49-discovery-${index}-${taskSlug}`;
  const implementerRole = `implementer-p49-discovery-${taskSlug}`;
  const validatorRole = `validator-p49-discovery-${taskSlug}`;

  const writeScope =
    item.writeScope.length > 0
      ? item.writeScope
      : item.targetFiles.length > 0
        ? item.targetFiles
        : ["olt/scripts/src/mind/"];

  const gate =
    item.gate.trim().length > 0 ? item.gate : "bun test tests/unit/mind && bun run typecheck";

  const acceptanceCriteria =
    item.acceptanceCriteria.length > 0
      ? item.acceptanceCriteria
      : [
          `Remediate discovery issue: ${item.description.slice(0, 100)}`,
          `Verify gate passes cleanly: ${gate}`,
          "Enforce 100% strict TypeScript types with 0 any and 0 compiler suppressions",
        ];

  const sourceId = mapDiscoveryCategoryToSourceId(item.category);
  const empiricalCommand = getSourceEmpiricalCommand(sourceId);

  return {
    id: taskId,
    label: item.title.slice(0, 100),
    write_scope: writeScope,
    gate,
    charter_goals: item.charterGoals.length > 0 ? item.charterGoals : ["G1"],
    acceptance_criteria: acceptanceCriteria,
    dependencies: [],
    source_type: item.sourceType,
    priority: item.priority,
    rationale: item.description,
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: implementerRole,
    assigned_validator: validatorRole,
    candidate_id: item.sourceReference,
    metadata: {
      discovery_category: item.category,
      discovery_source_id: sourceId,
      empirical_command: empiricalCommand,
      assigned_implementer: implementerRole,
      assigned_validator: validatorRole,
      source_reference: item.sourceReference ? item.sourceReference : null,
      ...item.metadata,
    },
  };
}

/**
 * Formats a concise markdown brief of discovery results conforming to line limits.
 */
export function formatTaskDiscoveryBrief(result: TaskDiscoveryResult): string {
  const lines: string[] = [
    `### Mind Cognitive Task Discovery: ${result.stats.totalFindings} Finding(s)`,
    `- **Scanned At**: \`${result.scannedAt}\``,
    `- **Code Quality**: ${result.stats.codeQualityCount} finding(s)`,
    `- **Test Coverage**: ${result.stats.testCoverageCount} gap(s)`,
    `- **Cognitive Gaps**: ${result.stats.cognitiveGapCount} gap(s)`,
    `- **Dormant Criteria**: ${result.stats.dormantCriteriaCount} goal(s)`,
    `- **Architectural Health**: ${result.stats.architecturalHealthCount} finding(s)`,
    `- **Pending Feedback**: ${result.stats.feedbackCount} item(s)`,
    `- **Open Defects**: ${result.stats.defectCount} item(s)`,
    `- **Synthesized Plans**: ${result.synthesizedPlans.length} task(s)`,
    `- **Auto-Enqueued**: ${result.enqueuedTasks.length} task(s)`,
  ];

  if (result.synthesizedPlans.length > 0) {
    lines.push("", "#### Synthesized Tasks:");
    for (const plan of result.synthesizedPlans.slice(0, 5)) {
      lines.push(`- **${plan.id}** [${plan.priority}]: ${plan.label}`);
    }
  }

  return lines.join("\n");
}

/**
 * Main Autonomous Mind Task Discovery Engine.
 * Scans all 8 canonical categories: code quality, test coverage, cognitive gaps,
 * dormant criteria, architectural health, pending feedback, defect logs, and continuous hardening.
 * Auto-synthesizes actionable, anti-batched self-evolution tasks for idle Mind loops with deduplication.
 */
export function discoverTasks(options: TaskDiscoveryOptions = {}): TaskDiscoveryResult {
  const nowIso = new Date().toISOString();
  const maxTasks = options.maxTasks ? options.maxTasks : 5;
  const existingQueue = readTaskQueue(options.taskQueuePath);
  const existingTaskIds = new Set(existingQueue.map((t) => t.id));
  const existingTaskLabels = new Set(existingQueue.map((t) => t.title.toLowerCase().trim()));

  // Step 1: Scan Code Quality
  const codeQualityResult =
    options.enableCodeQualityScan !== false
      ? scanCodeQuality({
          sourceRoots: options.sourceRoots,
          fileExtensions: undefined,
          excludePatterns: undefined,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

  // Step 2: Scan Test Coverage
  const testCoverageResult =
    options.enableTestCoverageScan !== false
      ? scanTestCoverage({
          sourceRoots: options.sourceRoots,
          testRoots: options.testRoots,
          maxFindings: 10,
        })
      : {
          findings: [],
          sourceFilesScanned: 0,
          testFilesScanned: 0,
          missingTestCount: 0,
          skippedTestCount: 0,
          durationMs: 0,
        };

  // Step 3: Scan Cognitive Gaps
  const cognitiveGapResult =
    options.enableCognitiveGapScan !== false
      ? scanCognitiveGaps({
          sourceRoots: options.sourceRoots,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

  // Step 4: Scan Dormant Criteria
  const dormantCriteriaResult =
    options.enableDormantCriteriaScan !== false
      ? scanDormantCriteria({
          charterPath: options.charterPath,
          taskQueuePath: options.taskQueuePath,
          recentTasksHistory: existingQueue,
          maxFindings: 5,
        })
      : { findings: [], goalsCheckedCount: 0, dormantCount: 0, durationMs: 0 };

  // Step 5: Scan Architectural Health
  const architecturalHealthResult =
    options.enableArchitecturalHealthScan !== false
      ? scanArchitecturalHealth({
          sourceRoots: options.sourceRoots,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

  // Step 6: Scan Pending Feedback Items
  const pendingFeedback =
    options.enableFeedbackQueueScan !== false
      ? readFeedbackQueue(options.feedbackQueuePath).filter((f) => f.status === "PENDING")
      : [];

  // Step 7: Scan Open Defects
  const openDefects =
    options.enableDefectScan !== false
      ? auditDefectLog(options.capsulesDir ? [options.capsulesDir] : [".capsules/"]).defects.filter(
          (b) => b.status === "open",
        )
      : [];

  const rawDiscoveries: DiscoveryItem[] = [];
  const seenDiscoveryKeys = new Set<string>();

  // Helper to deduplicate raw discoveries
  const addDiscovery = (item: DiscoveryItem) => {
    const key = `${item.category}:${item.targetFiles.join(",")}:${item.title}`;
    if (!seenDiscoveryKeys.has(key)) {
      seenDiscoveryKeys.add(key);
      rawDiscoveries.push(item);
    }
  };

  // Transform Feedback Items into Discoveries
  for (const fb of pendingFeedback) {
    const slug = sanitizeSlug(fb.id);
    const scope = [`olt/scripts/src/mind/${slug}.ts`, `tests/unit/mind/${slug}.test.ts`];
    addDiscovery({
      id: `fb-${slug}`,
      category: "FEEDBACK_INTAKE",
      title: fb.title,
      description: fb.content ? fb.content : fb.title,
      priority: mapFeedbackPriorityToTaskPriority(fb.priority),
      targetFiles: scope,
      writeScope: scope,
      gate: `bun test tests/unit/mind/${slug}.test.ts && bun run typecheck`,
      charterGoals: ["G1"],
      acceptanceCriteria: [
        `Fulfill feedback directive: ${fb.title}`,
        "Maintain zero compiler warnings and strict types",
      ],
      remediation: `Implement feedback directive ${fb.id}`,
      sourceType: "feedback_intake",
      sourceReference: fb.id,
      metadata: { feedback_id: fb.id, priority: fb.priority },
    });
  }

  // Transform Open Defects into Discoveries
  for (const bl of openDefects) {
    const slug = sanitizeSlug(bl.id);
    const scope = ["olt/scripts/src/mind/", "tests/unit/mind/"];
    addDiscovery({
      id: `defect-${slug}`,
      category: "DEFECT_REMEDIATION",
      title: `Remediate Defect: ${bl.observation.slice(0, 50)}`,
      description: bl.observation,
      priority: "CRITICAL",
      targetFiles: scope,
      writeScope: scope,
      gate: "bun test tests/unit/mind && bun run typecheck",
      charterGoals: ["G2"],
      acceptanceCriteria: [
        `Resolve open defect ${bl.id}: ${bl.observation.slice(0, 80)}`,
        "Verify regression immunity with unit tests",
      ],
      remediation: bl.remediation || bl.prescribed_remediation || "Fix root cause of defect",
      sourceType: "defect_remediation",
      sourceReference: bl.id,
      metadata: { defect_id: bl.id, category: bl.category },
    });
  }

  // Transform Cognitive Gaps into Discoveries
  for (const cg of cognitiveGapResult.findings) {
    const fileBase = basename(cg.file, extname(cg.file));
    const slug = `${sanitizeSlug(fileBase)}-${sanitizeSlug(cg.issueType)}`;
    const relFile = relative(process.cwd(), cg.file);
    const testFile = relFile.startsWith("olt/")
      ? `tests/unit/${relFile.replace("olt/scripts/src/", "").replace(/\.ts$/, ".test.ts")}`
      : `tests/unit/${fileBase}.test.ts`;

    addDiscovery({
      id: `cog-${slug}`,
      category: "COGNITIVE_GAP",
      title: `Cognitive Gap: Remediate ${cg.issueType} in ${basename(cg.file)}`,
      description: cg.description,
      priority: mapPriority(cg.severity),
      targetFiles: [cg.file],
      writeScope: [cg.file, testFile],
      gate: `bun test ${testFile} && bun run typecheck`,
      charterGoals: ["G1", "G2"],
      acceptanceCriteria: [
        cg.suggestedRemediation,
        `Ensure reduced cognitive complexity and strict verification in ${basename(cg.file)}`,
      ],
      remediation: cg.suggestedRemediation,
      sourceType: "self_evolution",
      sourceReference: `${cg.file}:${cg.line ? cg.line : 1}`,
      metadata: { issue_type: cg.issueType, line: cg.line },
    });
  }

  // Transform Code Quality Findings into Discoveries
  for (const cq of codeQualityResult.findings) {
    const fileBase = basename(cq.file, extname(cq.file));
    const slug = `${sanitizeSlug(fileBase)}-${sanitizeSlug(cq.issueType)}`;
    const relFile = relative(process.cwd(), cq.file);
    const testFile = relFile.startsWith("olt/")
      ? `tests/unit/${relFile.replace("olt/scripts/src/", "").replace(/\.ts$/, ".test.ts")}`
      : `tests/unit/${fileBase}.test.ts`;

    addDiscovery({
      id: `cq-${slug}`,
      category: "CODE_QUALITY",
      title: `Code Quality: Fix ${cq.issueType} in ${basename(cq.file)}`,
      description: cq.description,
      priority: mapPriority(cq.severity),
      targetFiles: [cq.file],
      writeScope: [cq.file, testFile],
      gate: `bun test ${testFile} && bun run typecheck`,
      charterGoals: ["G1"],
      acceptanceCriteria: [
        cq.suggestedRemediation,
        `Ensure 0 any and 0 compiler suppressions in ${basename(cq.file)}`,
      ],
      remediation: cq.suggestedRemediation,
      sourceType: "self_evolution",
      sourceReference: `${cq.file}:${cq.line ? cq.line : 1}`,
      metadata: { issue_type: cq.issueType, line: cq.line },
    });
  }

  // Transform Test Coverage Findings into Discoveries
  for (const tc of testCoverageResult.findings) {
    const fileBase = basename(tc.sourceFile, extname(tc.sourceFile));
    const slug = `${sanitizeSlug(fileBase)}-coverage`;
    const relSource = relative(process.cwd(), tc.sourceFile);
    const targetTestFile = tc.testFile
      ? tc.testFile
      : relSource.startsWith("olt/")
        ? `tests/unit/${relSource.replace("olt/scripts/src/", "").replace(/\.ts$/, ".test.ts")}`
        : `tests/unit/${fileBase}.test.ts`;

    addDiscovery({
      id: `cov-${slug}`,
      category: "TEST_COVERAGE",
      title: `Test Coverage: Add unit test suite for ${basename(tc.sourceFile)}`,
      description: tc.description,
      priority: mapPriority(tc.severity),
      targetFiles: [tc.sourceFile],
      writeScope: [tc.sourceFile, targetTestFile],
      gate: `bun test ${targetTestFile} && bun run typecheck`,
      charterGoals: ["G3"],
      acceptanceCriteria: [
        tc.suggestedRemediation,
        `All unit tests in ${basename(targetTestFile)} execute cleanly with 100% pass rate`,
      ],
      remediation: tc.suggestedRemediation,
      sourceType: "self_evolution",
      sourceReference: tc.sourceFile,
      metadata: { issue_type: tc.issueType, test_file: targetTestFile },
    });
  }

  // Transform Architectural Health Findings into Discoveries
  for (const ah of architecturalHealthResult.findings) {
    const fileBase = basename(ah.file, extname(ah.file));
    const slug = `${sanitizeSlug(fileBase)}-${sanitizeSlug(ah.issueType)}`;
    addDiscovery({
      id: `arch-${slug}`,
      category: "ARCHITECTURAL_HEALTH",
      title: `Architectural Health: Fix ${ah.issueType} in ${basename(ah.file)}`,
      description: ah.description,
      priority: mapPriority(ah.severity),
      targetFiles: [ah.file],
      writeScope: [ah.file],
      gate: "bun test tests/unit/mind && bun run typecheck",
      charterGoals: ["G1"],
      acceptanceCriteria: [
        ah.suggestedRemediation,
        `Verify structural integrity in ${basename(ah.file)}`,
      ],
      remediation: ah.suggestedRemediation,
      sourceType: "self_evolution",
      sourceReference: `${ah.file}:${ah.line ? ah.line : 1}`,
      metadata: { issue_type: ah.issueType, line: ah.line },
    });
  }

  // Transform Dormant Criteria into Discoveries
  for (const dc of dormantCriteriaResult.findings) {
    const slug = sanitizeSlug(dc.criteriaId);
    addDiscovery({
      id: `dormant-${slug}`,
      category: "DORMANT_CRITERIA",
      title: `Dormant Criteria: Activate ${dc.criteriaId}`,
      description: `Unaddressed charter requirement: "${dc.statement}"`,
      priority: mapPriority(dc.severity),
      targetFiles: ["olt/scripts/src/mind/"],
      writeScope: ["olt/scripts/src/mind/", "tests/unit/mind/"],
      gate: "bun test tests/unit/mind && bun run typecheck",
      charterGoals: [dc.criteriaId],
      acceptanceCriteria: [
        dc.suggestedRemediation,
        `Verify implementation satisfies charter goal ${dc.criteriaId}`,
      ],
      remediation: dc.suggestedRemediation,
      sourceType: "self_evolution",
      sourceReference: dc.criteriaId,
      metadata: { criteria_id: dc.criteriaId, source: dc.source },
    });
  }

  // Propose Candidate Evolutions
  const candidateProposals = proposeCandidateEvolutions({
    codeQuality: codeQualityResult.findings,
    testCoverage: testCoverageResult.findings,
    cognitiveGaps: cognitiveGapResult.findings,
    dormantCriteria: dormantCriteriaResult.findings,
    architecturalHealth: architecturalHealthResult.findings,
    feedbackPending: pendingFeedback,
    openDefects,
  });

  // Deduplicate and synthesize plans against existing queue
  const synthesizedPlans: DiscoveredTaskPlan[] = [];
  let planIndex = 1;

  for (const disc of rawDiscoveries) {
    if (synthesizedPlans.length >= maxTasks) break;
    const plan = synthesizeTaskFromDiscovery(disc, planIndex);
    const labelLower = plan.label.toLowerCase().trim();
    if (!existingTaskIds.has(plan.id) && !existingTaskLabels.has(labelLower)) {
      synthesizedPlans.push(plan);
      planIndex++;
    }
  }

  // Step 8: Fallback Continuous Invariant Hardening Task if 0 discoveries
  if (synthesizedPlans.length === 0) {
    const hardeningScope = [
      "olt/scripts/src/mind/task-discovery.ts",
      "olt/scripts/src/mind/self-evolution.ts",
      "tests/unit/mind/task-discovery.test.ts",
    ];
    const fallbackPlan: DiscoveredTaskPlan = {
      id: `task-p49-discovery-hardening-${Date.now().toString().slice(-6)}`,
      label: "Perpetual Invariant Hardening & Zero-Suppression Assurance",
      write_scope: hardeningScope,
      gate: "bun test tests/unit/mind/task-discovery.test.ts && bun run typecheck",
      charter_goals: ["G1"],
      acceptance_criteria: [
        "Maintain 100% strict TypeScript types across mind engine",
        "0 compiler suppressions and strict invariant compliance",
        "All mind discovery unit tests pass cleanly",
      ],
      dependencies: [],
      source_type: "self_evolution",
      priority: "HIGH",
      rationale:
        "Autonomic perpetual self-evolution maintaining continuous invariant hardening and type safety.",
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: "implementer-p49-hardening",
      assigned_validator: "validator-p49-hardening",
      metadata: {
        discovery_category: "CONTINUOUS_HARDENING",
        assigned_implementer: "implementer-p49-hardening",
        assigned_validator: "validator-p49-hardening",
      },
    };
    synthesizedPlans.push(fallbackPlan);
  }

  // Auto-enqueue if requested
  let enqueuedTasks: readonly TaskQueueItem[] = [];
  if (options.autoEnqueue) {
    const batchInputs: NewTaskQueueInput[] = synthesizedPlans.map((p) => ({
      id: p.id,
      title: p.label,
      description: p.rationale,
      priority: p.priority,
      write_scope: p.write_scope,
      gate: p.gate,
      charter_goals: p.charter_goals,
      acceptance_criteria: p.acceptance_criteria,
      dependencies: p.dependencies,
      source_type: p.source_type,
      assigned_tier: p.assigned_tier,
      metadata: p.metadata,
    }));
    enqueuedTasks = enqueueTasksBatch(batchInputs, options.taskQueuePath);
  }

  const totalFindings =
    codeQualityResult.totalFindings +
    testCoverageResult.missingTestCount +
    testCoverageResult.skippedTestCount +
    cognitiveGapResult.totalFindings +
    dormantCriteriaResult.dormantCount +
    architecturalHealthResult.totalFindings +
    pendingFeedback.length +
    openDefects.length;

  const summary = `Mind Task Discovery: identified ${totalFindings} finding(s) across code quality (${codeQualityResult.totalFindings}), test coverage (${testCoverageResult.missingTestCount} missing), cognitive gaps (${cognitiveGapResult.totalFindings}), dormant criteria (${dormantCriteriaResult.dormantCount}), architectural health (${architecturalHealthResult.totalFindings}), feedback (${pendingFeedback.length}), and defects (${openDefects.length}). Synthesized ${synthesizedPlans.length} actionable task(s).`;

  return {
    scannedAt: nowIso,
    findings: {
      codeQuality: codeQualityResult.findings,
      testCoverage: testCoverageResult.findings,
      cognitiveGaps: cognitiveGapResult.findings,
      dormantCriteria: dormantCriteriaResult.findings,
      architecturalHealth: architecturalHealthResult.findings,
      feedbackPending: pendingFeedback,
      openDefects,
    },
    discoveries: rawDiscoveries,
    candidateProposals,
    synthesizedPlans,
    enqueuedTasks,
    stats: {
      totalFindings,
      codeQualityCount: codeQualityResult.totalFindings,
      testCoverageCount: testCoverageResult.missingTestCount + testCoverageResult.skippedTestCount,
      cognitiveGapCount: cognitiveGapResult.totalFindings,
      dormantCriteriaCount: dormantCriteriaResult.dormantCount,
      architecturalHealthCount: architecturalHealthResult.totalFindings,
      feedbackCount: pendingFeedback.length,
      defectCount: openDefects.length,
      synthesizedCount: synthesizedPlans.length,
      enqueuedCount: enqueuedTasks.length,
    },
    summary,
  };
}
