import type {
  DefectEntry,
  DefectCategory,
  DefectSeverity,
  DefectStatus,
} from "../../../defects/index.ts";
import { auditDefectLog, categorizeDefect } from "../../../defects/index.ts";
import type { DiscoveryItem, DiscoverySeverity, TaskPriority } from "../types.ts";

export type DefectRemediationIssueType =
  | "UNRESOLVED_DEFECT"
  | "BOUNDARY_VIOLATION"
  | "MODEL_REASONING_ERROR"
  | "CODE_DEFECT"
  | "DOCUMENTATION"
  | "SECURITY_RISK"
  | "MODULARITY_VIOLATION"
  | "MISSING_RESOLUTION_PROOF";

export interface DefectRemediationFinding {
  readonly defectId: string;
  readonly issueType: DefectRemediationIssueType;
  readonly category: DefectCategory | string;
  readonly severity: DiscoverySeverity;
  readonly description: string;
  readonly suggestedRemediation: string;
  readonly defect: DefectEntry;
  readonly sourceFile?: string | undefined;
  readonly line?: number | undefined;
}

export interface DefectRemediationScanOptions {
  readonly capsulesDir?: string | undefined;
  readonly capsulesDirs?: readonly string[] | undefined;
  readonly defects?: readonly DefectEntry[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly includeCategories?: readonly string[] | undefined;
  readonly excludeCategories?: readonly string[] | undefined;
  readonly includeResolved?: boolean | undefined;
}

export interface DefectRemediationScanResult {
  readonly findings: readonly DefectRemediationFinding[];
  readonly openDefects: readonly DefectEntry[];
  readonly resolvedDefects: readonly DefectEntry[];
  readonly totalDefects: number;
  readonly capsulesScanned: readonly string[];
  readonly durationMs: number;
}

export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isDefectEntry(val: unknown): val is DefectEntry {
  if (!val || typeof val !== "object") return false;
  const candidate = val as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    candidate["id"].trim().length > 0 &&
    typeof candidate["status"] === "string"
  );
}

export function mapDefectSeverityToDiscoverySeverity(severity?: string): DiscoverySeverity {
  switch ((severity || "").toLowerCase().trim()) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "warning":
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    case "info":
      return "BACKGROUND";
    default:
      return "HIGH";
  }
}

export function mapDefectSeverityToPriority(severity?: string): TaskPriority {
  switch ((severity || "").toLowerCase().trim()) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "warning":
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    case "info":
      return "BACKGROUND";
    default:
      return "HIGH";
  }
}

export function mapCategoryToIssueType(category?: string): DefectRemediationIssueType {
  switch ((category || "").toLowerCase().trim()) {
    case "boundary_violation":
      return "BOUNDARY_VIOLATION";
    case "model_reasoning_error":
      return "MODEL_REASONING_ERROR";
    case "code_defect":
      return "CODE_DEFECT";
    case "documentation":
      return "DOCUMENTATION";
    case "security_risk":
      return "SECURITY_RISK";
    case "modularity_violation":
      return "MODULARITY_VIOLATION";
    default:
      return "UNRESOLVED_DEFECT";
  }
}

export function filterOpenDefects(defects: readonly DefectEntry[]): readonly DefectEntry[] {
  return defects.filter((d: DefectEntry): boolean => {
    const s = (d.status || "").toLowerCase().trim();
    return s === "open" || s === "reopened" || s === "in_progress";
  });
}

export function extractDefectRemediation(defect: DefectEntry): string {
  return (
    defect.prescribed_remediation ??
    defect.remediation ??
    defect.observation ??
    defect.description ??
    defect.message ??
    "Fix root cause of defect"
  );
}

export function mapDefectToDiscoveryItem(defect: DefectEntry): DiscoveryItem {
  const slug = sanitizeSlug(defect.id);
  const desc = defect.observation ?? defect.description ?? defect.message ?? "Unspecified defect";
  const category = (defect.category ?? "code_defect").toLowerCase();
  const charterGoal = category === "boundary_violation" ? "G1" : "G2";
  const priority = mapDefectSeverityToPriority(defect.severity);
  const scope = ["olt/scripts/src/mind/", "tests/unit/mind/"];
  const remediation = extractDefectRemediation(defect);

  return {
    id: `defect-${slug}`,
    category: "DEFECT_REMEDIATION",
    title: `Remediate Defect: ${desc.slice(0, 50)}`,
    description: desc,
    priority,
    targetFiles: scope,
    writeScope: scope,
    gate: "bun test tests/unit/mind && bun run typecheck",
    charterGoals: [charterGoal],
    acceptanceCriteria: [
      `Resolve open defect ${defect.id}: ${desc.slice(0, 80)}`,
      "Verify regression immunity with unit tests",
    ],
    remediation,
    sourceType: "defect_remediation",
    sourceReference: defect.id,
    metadata: {
      defect_id: defect.id,
      category: defect.category,
      severity: defect.severity,
      error_code: defect.error_code,
    },
  };
}

export function scanDefectRemediations(
  options: DefectRemediationScanOptions = {},
): DefectRemediationScanResult {
  const startTime = Date.now();
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  let allDefects: readonly DefectEntry[] = [];
  let capsulesScanned: readonly string[] = [];

  if (options.defects && options.defects.length > 0) {
    allDefects = options.defects;
  } else {
    const targets = options.capsulesDirs
      ? options.capsulesDirs
      : options.capsulesDir
        ? [options.capsulesDir]
        : [".capsules/"];
    const report = auditDefectLog(targets);
    allDefects = report.defects;
    capsulesScanned = report.capsules_audited;
  }

  const openDefects: DefectEntry[] = [];
  const resolvedDefects: DefectEntry[] = [];

  for (const d of allDefects) {
    const status = (d.status || "").toLowerCase().trim();
    if (status === "resolved" || status === "completed") {
      resolvedDefects.push(d);
    } else if (
      status !== "wontfix" &&
      status !== "wont_fix" &&
      status !== "declined" &&
      status !== "closed"
    ) {
      openDefects.push(d);
    }
  }

  const targetList = options.includeResolved ? [...openDefects, ...resolvedDefects] : openDefects;
  const findings: DefectRemediationFinding[] = [];

  for (const defect of targetList) {
    if (findings.length >= maxFindings) break;

    const cat = (defect.category || categorizeDefect(defect)).toLowerCase();
    if (
      options.includeCategories &&
      !options.includeCategories.map((c) => c.toLowerCase()).includes(cat)
    ) {
      continue;
    }
    if (
      options.excludeCategories &&
      options.excludeCategories.map((c) => c.toLowerCase()).includes(cat)
    ) {
      continue;
    }

    const desc = defect.observation ?? defect.description ?? defect.message ?? "Unspecified defect";
    const rem = defect.remediation ?? defect.prescribed_remediation ?? "Fix root cause of defect";
    const issueType = mapCategoryToIssueType(defect.category);
    const severity = mapDefectSeverityToDiscoverySeverity(defect.severity);

    let sourceFile: string | undefined = undefined;
    let line: number | undefined = undefined;

    if (defect.context && typeof defect.context === "object") {
      const ctx = defect.context as Record<string, unknown>;
      if (typeof ctx["file"] === "string") {
        sourceFile = ctx["file"];
      }
      if (typeof ctx["line"] === "number") {
        line = ctx["line"];
      }
    }

    findings.push({
      defectId: defect.id,
      issueType,
      category: defect.category || cat,
      severity,
      description: desc,
      suggestedRemediation: rem,
      defect,
      sourceFile,
      line,
    });
  }

  return {
    findings,
    openDefects,
    resolvedDefects,
    totalDefects: allDefects.length,
    capsulesScanned,
    durationMs: Date.now() - startTime,
  };
}
