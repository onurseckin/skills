import { basename, extname, relative } from "node:path";
import { scanCodeQuality } from "../scanners/index.ts";
import { scanTestCoverage } from "../scanners/index.ts";
import { scanCognitiveGaps, scanDormantCriteria } from "../scanners/index.ts";
import { scanArchitecturalHealth } from "../scanners/index.ts";
import { readFeedbackQueue } from "../../../feedback/queue/index.ts";
import { auditDefectLog } from "../../../defects/index.ts";
import { readTaskQueue } from "../../../../task/queue/index.ts";
import type {
  TaskDiscoveryOptions,
  DiscoveryItem,
  CodeQualityFinding,
  TestCoverageFinding,
  CognitiveGapFinding,
  DormantCriteriaFinding,
  ArchitecturalHealthFinding,
  TaskQueueItem,
  DefectEntry,
} from "../types.ts";
import type { FeedbackItem } from "../../../feedback/queue/index.ts";
import { mapPriority, mapFeedbackPriorityToTaskPriority, sanitizeSlug } from "../scanners/index.ts";
import { transformFindingsToDiscoveries } from "./transformers.ts";

export interface DiscoveryScanOutputs {
  readonly rawDiscoveries: readonly DiscoveryItem[];
  readonly openDefects: readonly DefectEntry[];
  readonly findings: {
    readonly codeQuality: readonly CodeQualityFinding[];
    readonly testCoverage: readonly TestCoverageFinding[];
    readonly cognitiveGaps: readonly CognitiveGapFinding[];
    readonly dormantCriteria: readonly DormantCriteriaFinding[];
    readonly architecturalHealth: readonly ArchitecturalHealthFinding[];
    readonly feedbackPending: readonly FeedbackItem[];
    readonly openDefects: readonly DefectEntry[];
  };
  readonly existingQueue: readonly TaskQueueItem[];
  readonly existingTaskIds: ReadonlySet<string>;
  readonly existingTaskLabels: ReadonlySet<string>;
  readonly nowIso: string;
  readonly maxTasks: number;
}

export function performDiscoveryScans(options: TaskDiscoveryOptions): DiscoveryScanOutputs {
  const nowIso = new Date().toISOString();
  const maxTasks = options.maxTasks ? options.maxTasks : 5;
  const existingQueue = readTaskQueue(options.taskQueuePath);
  const existingTaskIds = new Set(existingQueue.map((t: TaskQueueItem): string => t.id));
  const existingTaskLabels = new Set(
    existingQueue.map((t: TaskQueueItem): string => t.title.toLowerCase().trim()),
  );

  const codeQualityResult =
    options.enableCodeQualityScan !== false
      ? scanCodeQuality({
          sourceRoots: options.sourceRoots,
          fileExtensions: undefined,
          excludePatterns: undefined,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

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

  const cognitiveGapResult =
    options.enableCognitiveGapScan !== false
      ? scanCognitiveGaps({
          sourceRoots: options.sourceRoots,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

  const dormantCriteriaResult =
    options.enableDormantCriteriaScan !== false
      ? scanDormantCriteria({
          charterPath: options.charterPath,
          taskQueuePath: options.taskQueuePath,
          recentTasksHistory: existingQueue,
          maxFindings: 5,
        })
      : { findings: [], goalsCheckedCount: 0, dormantCount: 0, durationMs: 0 };

  const architecturalHealthResult =
    options.enableArchitecturalHealthScan !== false
      ? scanArchitecturalHealth({
          sourceRoots: options.sourceRoots,
          maxFindings: 10,
        })
      : { findings: [], filesScanned: 0, totalFindings: 0, durationMs: 0 };

  const pendingFeedback =
    options.enableFeedbackQueueScan !== false
      ? readFeedbackQueue(options.feedbackQueuePath).filter(
          (f: FeedbackItem): boolean => f.status === "PENDING",
        )
      : [];

  const openDefects =
    options.enableDefectScan !== false
      ? auditDefectLog(options.capsulesDir ? [options.capsulesDir] : [".capsules/"]).defects.filter(
          (b: DefectEntry): boolean => b.status === "open",
        )
      : [];

  const rawDiscoveries: DiscoveryItem[] = [];
  const seenDiscoveryKeys = new Set<string>();

  const addDiscovery = (item: DiscoveryItem) => {
    const key = `${item.category}:${item.targetFiles.join(",")}:${item.title}`;
    if (!seenDiscoveryKeys.has(key)) {
      seenDiscoveryKeys.add(key);
      rawDiscoveries.push(item);
    }
  };

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

  for (const bl of openDefects) {
    const desc = bl.observation || bl.description || bl.message || "Unspecified defect";
    const slug = sanitizeSlug(bl.id);
    const scope = ["olt/scripts/src/mind/", "tests/unit/mind/"];
    const titleSnippet = bl.observation ? bl.observation.slice(0, 50) : desc.slice(0, 50);
    const criteriaSnippet = bl.observation ? bl.observation.slice(0, 80) : desc.slice(0, 80);
    const remediation = bl.remediation || bl.prescribed_remediation || "Fix root cause of defect";
    addDiscovery({
      id: `defect-${slug}`,
      category: "DEFECT_REMEDIATION",
      title: `Remediate Defect: ${titleSnippet}`,
      description: desc,
      priority: "CRITICAL",
      targetFiles: scope,
      writeScope: scope,
      gate: "bun test tests/unit/mind && bun run typecheck",
      charterGoals: ["G2"],
      acceptanceCriteria: [
        `Resolve open defect ${bl.id}: ${criteriaSnippet}`,
        "Verify regression immunity with unit tests",
      ],
      remediation,
      sourceType: "defect_remediation",
      sourceReference: bl.id,
      metadata: { defect_id: bl.id, category: bl.category },
    });
  }

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

  transformFindingsToDiscoveries({
    codeQualityFindings: codeQualityResult.findings,
    testCoverageFindings: testCoverageResult.findings,
    architecturalHealthFindings: architecturalHealthResult.findings,
    dormantCriteriaFindings: dormantCriteriaResult.findings,
    addDiscovery,
  });

  return {
    rawDiscoveries,
    openDefects,
    findings: {
      codeQuality: codeQualityResult.findings,
      testCoverage: testCoverageResult.findings,
      cognitiveGaps: cognitiveGapResult.findings,
      dormantCriteria: dormantCriteriaResult.findings,
      architecturalHealth: architecturalHealthResult.findings,
      feedbackPending: pendingFeedback,
      openDefects,
    },
    existingQueue,
    existingTaskIds,
    existingTaskLabels,
    nowIso,
    maxTasks,
  };
}
