import { basename, extname, relative } from "node:path";
import type {
  DiscoveryItem,
  CodeQualityFinding,
  TestCoverageFinding,
  CognitiveGapFinding,
  DormantCriteriaFinding,
  ArchitecturalHealthFinding,
} from "../types.ts";
import { mapPriority, sanitizeSlug } from "../scanners/index.ts";

export function transformFindingsToDiscoveries(params: {
  readonly codeQualityFindings: readonly CodeQualityFinding[];
  readonly testCoverageFindings: readonly TestCoverageFinding[];
  readonly architecturalHealthFindings: readonly ArchitecturalHealthFinding[];
  readonly dormantCriteriaFindings: readonly DormantCriteriaFinding[];
  readonly addDiscovery: (d: DiscoveryItem) => void;
}): void {
  const {
    codeQualityFindings,
    testCoverageFindings,
    architecturalHealthFindings,
    dormantCriteriaFindings,
    addDiscovery,
  } = params;

  for (const cq of codeQualityFindings) {
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

  for (const tc of testCoverageFindings) {
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

  for (const ah of architecturalHealthFindings) {
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

  for (const dc of dormantCriteriaFindings) {
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
}
