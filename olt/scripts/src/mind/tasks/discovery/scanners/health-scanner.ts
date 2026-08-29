import { resolve, dirname, basename, extname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_EXCLUDE_PATTERNS, DEFAULT_SOURCE_EXTENSIONS } from "../types.ts";
import type {
  ArchitecturalHealthFinding,
  ArchitecturalHealthScanOptions,
  ArchitecturalHealthScanResult,
  CandidateEvolutionProposal,
  CodeQualityFinding,
  CognitiveGapFinding,
  DiscoverySeverity,
  DormantCriteriaFinding,
  TestCoverageFinding,
  DefectEntry,
  FeedbackItem,
} from "../types.ts";
import type { TaskPriority } from "../../queue/index.ts";
import type { FeedbackPriority } from "../../../feedback/queue/index.ts";
import { collectFilesRecursively, sanitizeSlug } from "./quality-scanner.ts";

export { sanitizeSlug };

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

        const importMatch = /from\s+["'](\.\.?\/[^"']+)["']/.exec(trimmed);
        if (importMatch && importMatch[1]) {
          const importRel = importMatch[1];
          const dir = dirname(file);
          let targetPath = resolve(dir, importRel);

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
    } catch {}
  }

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

export function mapPriority(severity: DiscoverySeverity): TaskPriority {
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

export function mapFeedbackPriorityToTaskPriority(p: FeedbackPriority): TaskPriority {
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

  if (findings.openDefects) {
    for (const bl of findings.openDefects) {
      if (bl.observation) {
        const slug = sanitizeSlug(bl.id);
        proposals.push({
          id: `cand-evo-defect-${slug}`,
          kind: "defect",
          title: `Remediate Defect: ${bl.observation?.slice(0, 50) ?? ""}`,
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
  }

  return proposals;
}
