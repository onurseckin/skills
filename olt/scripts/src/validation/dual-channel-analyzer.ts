import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { CANONICAL_VIEWPORTS } from "../capture/config/default-presets.ts";
import { readHeader } from "../summary/assets/asset-measure.ts";
import {
  normalizeViewportName,
  validateCrossChannelConsistency,
} from "./cross-channel-consistency.ts";
import { extractDomViolations, type FindingAdder } from "./dom-violation-extractor.ts";
import type {
  ClippingViolation,
  CompanionManifestData,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  EvaluatedCriterion,
  OrphanViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
} from "./dual-channel-types.ts";

export type {
  ClippingViolation,
  CompanionManifestData,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  EvaluatedCriterion,
  OrphanViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
};

export { validateCrossChannelConsistency };

const UI_EXTENSIONS = new Set([
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".svg",
]);

const UI_DIR_PATTERNS = [
  /(?:^|[\\/])(components|views|pages|styles|ui|frontend|client|renderer|canvas|layout)(?:[\\/]|$)/i,
];

export function isUiScope(paths: readonly string[]): boolean {
  if (!paths || paths.length === 0) return false;
  for (const p of paths) {
    const lower = p.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = lower.slice(dotIdx);
      if (UI_EXTENSIONS.has(ext)) return true;
    }
    for (const pattern of UI_DIR_PATTERNS) {
      if (pattern.test(lower)) return true;
    }
  }
  return false;
}

const DEFAULT_REQUIRED_VIEWPORTS = ["mobile", "tablet", "desktop"] as const;

const PROTECTED_VIEWPORT_BANDS: ReadonlySet<string> = new Set([
  "mobile",
  "tablet",
  "desktop",
  "ultrawide",
]);

function domInvariantsInspected(vp: ViewportMetrics, report: VisualMetricsReport): string[] {
  const inspected: string[] = [];
  if (vp.overflowViolations) inspected.push("no_overflow");
  if (vp.clippingViolations) inspected.push("no_clipping");
  if (vp.stackingViolations) inspected.push("stacking_order");
  if (vp.contrastViolations) inspected.push("wcag_contrast");
  if (vp.orphanViolations) inspected.push("no_origin_orphans");
  if (vp.renderCacheReset !== undefined || report.renderCacheReset !== undefined) {
    inspected.push("render_cache_clean");
  }
  return inspected;
}

const SCREENSHOT_INVARIANT = "screenshot_non_empty";
const MANIFEST_INVARIANT = "manifest_4_pillars_certified";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PngDimensionRead =
  | { readonly status: "unreadable" }
  | { readonly status: "invalid_png" }
  | { readonly status: "measured"; readonly width: number; readonly height: number };

function resolveScreenshotPath(path: string, runRoot: string | undefined): string {
  if (runRoot === undefined || isAbsolute(path)) return path;
  try {
    const root = realpathSync(runRoot);
    const candidate = resolve(join(root, path));
    if (candidate !== root && !candidate.startsWith(root + sep)) return path;
    return candidate;
  } catch {
    return path;
  }
}

function readPngPixelDimensions(path: string): PngDimensionRead {
  const read = readHeader(path);
  if (read === undefined) return { status: "unreadable" };
  const header = read.header;
  if (header.length < 24) return { status: "invalid_png" };
  if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return { status: "invalid_png" };
  if (header.subarray(12, 16).toString("latin1") !== "IHDR") return { status: "invalid_png" };
  return { status: "measured", width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function measuredWidthOf(
  pngReads: ReadonlyMap<ScreenshotMetadata, PngDimensionRead>,
  sc: ScreenshotMetadata,
): number | undefined {
  const read = pngReads.get(sc);
  return read !== undefined && read.status === "measured" ? read.width : undefined;
}

const MAX_DEVICE_SCALE_FACTOR = 4;

function selfReportedDimensionsWithinTolerance(
  measuredWidth: number,
  measuredHeight: number,
  claimedWidth: number | undefined,
  claimedHeight: number | undefined,
): boolean {
  if (
    typeof claimedWidth !== "number" ||
    typeof claimedHeight !== "number" ||
    Number.isNaN(claimedWidth) ||
    Number.isNaN(claimedHeight) ||
    claimedWidth <= 0 ||
    claimedHeight <= 0
  ) {
    return false;
  }
  for (let scale = 1; scale <= MAX_DEVICE_SCALE_FACTOR; scale++) {
    if (measuredWidth === claimedWidth * scale && measuredHeight === claimedHeight * scale) {
      return true;
    }
  }
  return false;
}

export interface PngVerificationResult {
  readonly reads: ReadonlyMap<ScreenshotMetadata, PngDimensionRead>;
  readonly verifiedClaims: ReadonlySet<ScreenshotMetadata>;
}

function verifyScreenshotPixelDimensions(
  screenshots: readonly ScreenshotMetadata[],
  addFinding: FindingAdder,
  runRoot?: string,
): PngVerificationResult {
  const reads = new Map<ScreenshotMetadata, PngDimensionRead>();
  const verifiedClaims = new Set<ScreenshotMetadata>();
  for (const sc of screenshots) {
    const pngRead = readPngPixelDimensions(resolveScreenshotPath(sc.path, runRoot));
    reads.set(sc, pngRead);
    if (pngRead.status === "unreadable") {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) could not be opened to verify its real pixel dimensions (the file is missing or unreadable). A screenshot whose bytes were never inspected cannot count as captured evidence.`,
        "Ensure the screenshot path points to a PNG file that genuinely exists on disk and was produced by the real browser rendering pipeline, not a fabricated or metadata-only entry.",
        undefined,
        sc.viewport,
      );
      continue;
    }
    if (pngRead.status === "invalid_png") {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) is not a valid PNG image (missing PNG signature or IHDR chunk at the expected byte offsets).`,
        "Ensure the captured evidence file is a genuine PNG rasterization produced by the browser rendering pipeline.",
        undefined,
        sc.viewport,
      );
      continue;
    }

    const claimedName = sc.viewport === undefined ? sc.name : sc.viewport;
    const claimedViewport = normalizeViewportName(claimedName, undefined);
    const canonical = CANONICAL_VIEWPORTS[claimedViewport];
    if (canonical === undefined) {
      const consistent = selfReportedDimensionsWithinTolerance(
        pngRead.width,
        pngRead.height,
        sc.width,
        sc.height,
      );
      if (consistent) {
        verifiedClaims.add(sc);
      } else {
        const hasSelfReportedDims = typeof sc.width === "number" && typeof sc.height === "number";
        addFinding(
          "invalid_screenshot_size",
          "error",
          hasSelfReportedDims
            ? `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims custom viewport '${claimedViewport}' with self-reported dimensions ${sc.width}x${sc.height}, but its real measured pixel dimensions (${pngRead.width}x${pngRead.height}) are not a consistent match at any 1x-${MAX_DEVICE_SCALE_FACTOR}x device pixel ratio.`
            : `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims non-canonical viewport '${claimedViewport}' with real measured pixel dimensions (${pngRead.width}x${pngRead.height}) but supplies no self-reported width/height to cross-check the claim against. A custom viewport whose correctness cannot be established must not count as captured evidence.`,
          "Provide self-reported width/height metadata that matches the real captured pixel dimensions for custom, non-canonical viewports, or capture at one of the canonical viewport presets.",
          undefined,
          sc.viewport,
        );
      }
      continue;
    }

    const scaleFactor = canonical.deviceScaleFactor === undefined ? 1 : canonical.deviceScaleFactor;
    const widthOk =
      pngRead.width >= canonical.width && pngRead.width <= canonical.width * scaleFactor;
    const heightOk =
      pngRead.height >= canonical.height && pngRead.height <= canonical.height * scaleFactor;
    const matches = widthOk && heightOk;
    if (matches) {
      verifiedClaims.add(sc);
    } else {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) claims viewport '${claimedViewport}' but its real pixel dimensions (${pngRead.width}x${pngRead.height}) do not match the canonical '${claimedViewport}' viewport (${canonical.width}x${canonical.height}, up to ${scaleFactor}x device pixel ratio).`,
        `Capture genuine '${claimedViewport}' viewport evidence at ${canonical.width}x${canonical.height} (or an integer device-pixel-ratio multiple of it) rather than a placeholder image.`,
        undefined,
        sc.viewport,
      );
    }
  }
  return { reads, verifiedClaims };
}

export interface ManifestCriteriaValidationResult {
  readonly valid: boolean;
  readonly evaluatedCriteriaCount: number;
  readonly passedCriteriaCount: number;
  readonly pillarsPresent: readonly string[];
}

export interface ValidateCompanionManifestOptions {
  readonly requireSemanticDepth?: boolean | undefined;
}

export const SUPERFICIAL_BOILERPLATE_PATTERNS: ReadonlySet<string> = new Set([
  "ok",
  "pass",
  "passed",
  "true",
  "yes",
  "n/a",
  "na",
  "none",
  "looks good",
  "test passed",
  "checked",
  "valid",
  "verified",
  "all good",
  "placeholder",
  "tbd",
  "as expected",
  "no issues",
  "done",
  "fine",
  "null",
  "undefined",
]);

const METRIC_PATTERN = /\b\d+(\.\d+)?(px|%|rem|em|ms|s|B|KB|MB|Lc|fps|:\d+)?\b/i;

export function validateCompanionManifestCriteria(
  manifest: unknown,
  addFinding: FindingAdder,
  indexOrOptions: number | ValidateCompanionManifestOptions = 0,
  maybeOptions?: ValidateCompanionManifestOptions,
): ManifestCriteriaValidationResult {
  const index = typeof indexOrOptions === "number" ? indexOrOptions : 0;
  const options =
    typeof indexOrOptions === "object" && indexOrOptions !== null ? indexOrOptions : maybeOptions;
  const requireSemanticDepth = options?.requireSemanticDepth ?? false;
  let hasErrors = false;
  const reportError: FindingAdder = (
    category,
    severity,
    message,
    remediation,
    affectedSelector,
    viewport,
  ) => {
    if (severity === "error") {
      hasErrors = true;
    }
    addFinding(category, severity, message, remediation, affectedSelector, viewport);
  };

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    reportError(
      "invalid_manifest",
      "error",
      `Companion Manifest #${index + 1} Violation: Manifest is not a valid JSON object.`,
      "Ensure companion manifest is a structured JSON object with metadata and evaluated criteria.",
    );
    return { valid: false, evaluatedCriteriaCount: 0, passedCriteriaCount: 0, pillarsPresent: [] };
  }

  const m = manifest as Record<string, unknown>;
  const screenId =
    typeof m.screenId === "string"
      ? m.screenId
      : typeof m.screen_id === "string"
        ? m.screen_id
        : undefined;
  const viewport = typeof m.viewport === "string" ? m.viewport : undefined;
  const manifestLabel =
    screenId && viewport ? `${screenId}-${viewport}.manifest.json` : `Manifest #${index + 1}`;

  if (!screenId || !viewport) {
    reportError(
      "invalid_manifest",
      "error",
      `Companion Manifest '${manifestLabel}' Violation: Missing required screenId or viewport fields.`,
      "Companion manifests must identify screenId and viewport.",
      undefined,
      viewport,
    );
  }

  // Extract criteria
  const rawCriteria: unknown[] = [];
  if (Array.isArray(m.criteria)) {
    rawCriteria.push(...m.criteria);
  } else if (Array.isArray(m.evaluatedCriteria)) {
    rawCriteria.push(...m.evaluatedCriteria);
  } else if (Array.isArray(m.allCriteria)) {
    rawCriteria.push(...m.allCriteria);
  } else if (typeof m.pillars === "object" && m.pillars !== null) {
    const p = m.pillars as Record<string, unknown>;
    for (const pillarKey of ["mechanical", "cognitive", "product", "ux", "custom"]) {
      const pObj = p[pillarKey];
      if (typeof pObj === "object" && pObj !== null) {
        const critList =
          (pObj as Record<string, unknown>).criteria ??
          (pObj as Record<string, unknown>).evaluatedCriteria;
        if (Array.isArray(critList)) {
          rawCriteria.push(...critList);
        }
      }
    }
  }

  if (rawCriteria.length === 0) {
    reportError(
      "missing_manifest_criteria",
      "error",
      `Companion Manifest '${manifestLabel}' Violation: Manifest contains no evaluated criteria records.`,
      "Companion manifests must evaluate and record criteria across all 4 mandatory pillars: Mechanical (CRIT-MECH-*), Cognitive (CRIT-COGN-*), Product Heuristics (CRIT-PROD-*/CRIT-CUST-*), UX Ergonomics (CRIT-UX-*).",
      undefined,
      viewport,
    );
    return { valid: false, evaluatedCriteriaCount: 0, passedCriteriaCount: 0, pillarsPresent: [] };
  }

  const pillarsFound = new Set<string>();
  let passedCount = 0;

  for (let i = 0; i < rawCriteria.length; i++) {
    const item = rawCriteria[i];
    if (typeof item !== "object" || item === null) {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion #${i + 1} Violation: Criterion entry is not a valid object.`,
        "Each criterion must be an object with id, pillar, passed, and details/evidence.",
        undefined,
        viewport,
      );
      continue;
    }
    const c = item as Record<string, unknown>;
    const critId = typeof c.id === "string" ? c.id.trim() : `CRIT-UNKNOWN-${i + 1}`;
    const pillar = typeof c.pillar === "string" ? c.pillar.toLowerCase() : "";

    const upperId = critId.toUpperCase();
    if (upperId.startsWith("CRIT-MECH-") || pillar === "mechanical") {
      pillarsFound.add("mechanical");
    } else if (upperId.startsWith("CRIT-COGN-") || pillar === "cognitive") {
      pillarsFound.add("cognitive");
    } else if (
      upperId.startsWith("CRIT-PROD-") ||
      upperId.startsWith("CRIT-CUST-") ||
      pillar === "product" ||
      pillar === "custom"
    ) {
      pillarsFound.add("product");
    } else if (upperId.startsWith("CRIT-UX-") || pillar === "ux") {
      pillarsFound.add("ux");
    }

    // 1. Explicit boolean passed
    if (typeof c.passed !== "boolean") {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing explicit boolean 'passed' property.`,
        "Every criterion must specify an explicit boolean 'passed: true' or 'passed: false'.",
        undefined,
        viewport,
      );
    }

    // 2. Details and Evidence validation
    const detailsStr = typeof c.details === "string" ? c.details.trim() : "";
    const evidenceStr = typeof c.evidence === "string" ? c.evidence.trim() : "";
    const hasDetails = detailsStr.length > 0;
    const hasEvidence = evidenceStr.length > 0;

    if (!hasDetails && !hasEvidence) {
      reportError(
        "invalid_manifest_criterion",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing non-empty 'details' or 'evidence' string.`,
        "Every criterion must provide non-empty diagnostic details or quantitative evidence.",
        undefined,
        viewport,
      );
    }

    // 3. Strict Semantic Depth Audits (when requireSemanticDepth is enabled)
    if (requireSemanticDepth) {
      // Details audit
      if (!hasDetails) {
        reportError(
          "boilerplate_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing or empty details.`,
          "Provide non-empty qualitative details for the evaluated criterion.",
          undefined,
          viewport,
        );
      } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(detailsStr.toLowerCase())) {
        reportError(
          "boilerplate_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Contains superficial boilerplate details: '${detailsStr}'.`,
          "Provide non-boilerplate qualitative diagnosis for the evaluated criterion.",
          undefined,
          viewport,
        );
      } else if (detailsStr.length < 12) {
        reportError(
          "superficial_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Details ('${detailsStr}') is too brief (< 12 characters).`,
          "Expand qualitative details to provide meaningful diagnosis.",
          undefined,
          viewport,
        );
      }

      // Evidence audit
      if (!hasEvidence) {
        reportError(
          "boilerplate_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Missing or empty evidence.`,
          "Provide non-empty empirical proof for the evaluated criterion.",
          undefined,
          viewport,
        );
      } else if (SUPERFICIAL_BOILERPLATE_PATTERNS.has(evidenceStr.toLowerCase())) {
        reportError(
          "boilerplate_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Contains superficial boilerplate evidence: '${evidenceStr}'.`,
          "Provide non-boilerplate empirical proof for the evaluated criterion.",
          undefined,
          viewport,
        );
      } else if (evidenceStr.length < 12) {
        reportError(
          "superficial_evidence",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Evidence ('${evidenceStr}') is too brief (< 12 characters).`,
          "Provide detailed empirical measurement proof with specific quantitative values.",
          undefined,
          viewport,
        );
      } else if (!METRIC_PATTERN.test(evidenceStr)) {
        reportError(
          "missing_evidence_metrics",
          "error",
          `Companion Manifest '${manifestLabel}' Criterion '${critId}' Violation: Evidence lacks quantitative measurements (numbers, pixel dimensions, counts, or units).`,
          "Include specific quantitative measurements and metric numbers in evidence.",
          undefined,
          viewport,
        );
      }
    }

    // 4. Pass verification
    if (c.passed === true) {
      passedCount++;
    } else if (c.passed === false) {
      const detailsMsg = hasDetails ? detailsStr : hasEvidence ? evidenceStr : "Criterion failed";
      reportError(
        "manifest_criterion_failed",
        "error",
        `Companion Manifest '${manifestLabel}' Criterion Failed: [${critId}] ${detailsMsg}`,
        `Remediate the underlying violation for criterion '${critId}' and re-evaluate companion manifest.`,
        undefined,
        viewport,
      );
    }
  }

  // 4 Mandatory Pillars
  const mandatoryPillars = [
    { key: "mechanical", label: "Mechanical Criteria (CRIT-MECH-*)" },
    { key: "cognitive", label: "Cognitive Criteria (CRIT-COGN-*)" },
    { key: "product", label: "Product Heuristics (CRIT-PROD-* / CRIT-CUST-*)" },
    { key: "ux", label: "UX Ergonomics (CRIT-UX-*)" },
  ];

  for (const pillar of mandatoryPillars) {
    if (!pillarsFound.has(pillar.key)) {
      reportError(
        "missing_pillar_criteria",
        "error",
        `Companion Manifest '${manifestLabel}' 4-Pillar Mandate Violation: Missing evaluated criteria for ${pillar.label}.`,
        `Ensure companion manifest evaluates criteria across all 4 mandatory pillars: Mechanical (CRIT-MECH-*), Cognitive (CRIT-COGN-*), Product Heuristics (CRIT-PROD-*/CRIT-CUST-*), UX Ergonomics (CRIT-UX-*).`,
        undefined,
        viewport,
      );
    }
  }

  // 5. Cognitive Analysis Questionnaire Verification (if present)
  if (typeof m.cognitiveAnalysis === "object" && m.cognitiveAnalysis !== null) {
    const cog = m.cognitiveAnalysis as Record<string, unknown>;
    if (Array.isArray(cog.questions)) {
      for (const q of cog.questions) {
        if (typeof q === "object" && q !== null) {
          const qObj = q as Record<string, unknown>;
          const qId = typeof qObj.id === "string" ? qObj.id : "Q-UNKNOWN";
          if (qObj.passed === false) {
            const obs =
              typeof qObj.observation === "string"
                ? qObj.observation
                : "Cognitive heuristic violated";
            reportError(
              "manifest_criterion_failed",
              "error",
              `Companion Manifest '${manifestLabel}' Cognitive Question Defect: [${qId}] ${obs}`,
              `Address cognitive / ergonomic defect identified in question '${qId}'.`,
              undefined,
              viewport,
            );
          } else if (requireSemanticDepth) {
            const obs = typeof qObj.observation === "string" ? qObj.observation.trim() : "";
            const ev = typeof qObj.evidence === "string" ? qObj.evidence.trim() : "";

            if (obs.length === 0 || SUPERFICIAL_BOILERPLATE_PATTERNS.has(obs.toLowerCase())) {
              reportError(
                "boilerplate_evidence",
                "error",
                `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Contains boilerplate observation: '${obs}'.`,
                "Provide detailed qualitative observation for cognitive questionnaire question.",
                undefined,
                viewport,
              );
            } else if (obs.length < 12) {
              reportError(
                "superficial_evidence",
                "error",
                `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Observation ('${obs}') is too brief (< 12 characters).`,
                "Expand qualitative observation for cognitive questionnaire question to articulate UX rationale.",
                undefined,
                viewport,
              );
            }

            if (ev.length === 0 || SUPERFICIAL_BOILERPLATE_PATTERNS.has(ev.toLowerCase())) {
              reportError(
                "boilerplate_evidence",
                "error",
                `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Contains boilerplate evidence: '${ev}'.`,
                "Provide empirical proof for cognitive questionnaire question.",
                undefined,
                viewport,
              );
            } else if (ev.length < 12) {
              reportError(
                "superficial_evidence",
                "error",
                `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Evidence ('${ev}') is too brief (< 12 characters).`,
                "Provide detailed empirical measurement proof for cognitive questionnaire question.",
                undefined,
                viewport,
              );
            } else if (!METRIC_PATTERN.test(ev)) {
              reportError(
                "missing_evidence_metrics",
                "error",
                `Companion Manifest '${manifestLabel}' Cognitive Question '${qId}' Violation: Evidence lacks quantitative metrics: '${ev}'.`,
                "Include quantitative metrics in cognitive questionnaire evidence.",
                undefined,
                viewport,
              );
            }
          }
        }
      }
    }
  }

  const allPillarsPresent = mandatoryPillars.every((p) => pillarsFound.has(p.key));
  return {
    valid: !hasErrors && allPillarsPresent && passedCount === rawCriteria.length,
    evaluatedCriteriaCount: rawCriteria.length,
    passedCriteriaCount: passedCount,
    pillarsPresent: Array.from(pillarsFound),
  };
}

export function analyzeDualChannel(input: DualChannelInput): DualChannelAuditResult {
  const allPaths = [...(input.taskFiles ?? []), ...(input.writeScope ?? [])];
  const isUi = isUiScope(allPaths);

  if (!isUi) {
    return {
      isUiTask: false,
      passed: true,
      mode: "non_ui_skipped",
      findings: [],
      proofs: [],
      summary: "Task does not touch UI or frontend scopes. Visual validation bypassed.",
    };
  }

  const findings: StructuredFinding[] = [];
  const proofs: CrossChannelProof[] = [];
  let findingCounter = 1;

  const addFinding: FindingAdder = (
    category,
    severity,
    message,
    remediation,
    affectedSelector,
    viewport,
  ) => {
    findings.push({
      id: `VF-${String(findingCounter++).padStart(3, "0")}`,
      severity,
      category,
      message,
      remediation,
      ...(affectedSelector ? { affectedSelector } : {}),
      ...(viewport ? { viewport } : {}),
    });
  };

  const hasDomReport = Boolean(
    input.domReport && input.domReport.viewports && input.domReport.viewports.length > 0,
  );
  const screenshots = input.screenshots ?? [];
  const manifests = input.manifests ?? [];
  const hasScreenshots = screenshots.length > 0;
  const hasManifests = manifests.length > 0;

  if (!hasDomReport && !hasScreenshots && !hasManifests) {
    addFinding(
      "missing_channel",
      "error",
      "Automated UI Task Mandate Violation: Task modifies UI scope but provided neither DOM metrics (visual-report.json) nor visual screenshots (.png).",
      "Execute visual validation tests via Playwright or headless visual metrics extraction to produce visual-report.json and screenshots.",
    );
    return {
      isUiTask: true,
      passed: false,
      mode: "rejected",
      findings,
      proofs: [],
      summary:
        "Rejected: Automated UI Task Mandate requires dual-channel visual validation, but all evidence channels are missing.",
    };
  }

  // Validate screenshots: Reject < 1024 bytes
  for (const sc of screenshots) {
    if (!sc.sizeBytes || sc.sizeBytes < 1024 || isNaN(sc.sizeBytes)) {
      addFinding(
        "invalid_screenshot_size",
        "error",
        `Anti-Mocking Invariant Violation: Screenshot '${sc.name}' (${sc.path}) is too small (${typeof sc.sizeBytes === "number" ? sc.sizeBytes : 0} bytes < 1024 bytes) or stubbed.`,
        "Ensure real browser rendering pipeline outputs valid non-empty PNG rasterizations (minimum 1024 bytes).",
        undefined,
        sc.viewport,
      );
    }
  }

  const sizeValidScreenshots = screenshots.filter(
    (sc) => typeof sc.sizeBytes === "number" && !isNaN(sc.sizeBytes) && sc.sizeBytes >= 1024,
  );
  const { reads: pngReads, verifiedClaims } = verifyScreenshotPixelDimensions(
    sizeValidScreenshots,
    addFinding,
    input.runRoot,
  );

  // Validate manifests: 4 Pillars & Criteria
  let manifestProofsValid = false;
  if (hasManifests) {
    let validCount = 0;
    for (let i = 0; i < manifests.length; i++) {
      const res = validateCompanionManifestCriteria(manifests[i], addFinding, i, {
        requireSemanticDepth: input.requireSemanticDepth,
      });
      if (res.valid) validCount++;
    }
    manifestProofsValid = validCount === manifests.length && manifests.length > 0;
  }

  const requiredVps = input.requiredViewports ?? DEFAULT_REQUIRED_VIEWPORTS;
  const coveredVps = new Set<string>();
  const coveredRawNames = new Set<string>();

  if (input.domReport) {
    for (const vp of input.domReport.viewports) {
      const norm = normalizeViewportName(vp.viewport, vp.width);
      const hasMeasuredWidth =
        typeof vp.width === "number" && Number.isFinite(vp.width) && vp.width > 0;
      const isUnverifiedCustomFallback = !PROTECTED_VIEWPORT_BANDS.has(norm);
      if (!isUnverifiedCustomFallback || hasMeasuredWidth) {
        coveredVps.add(norm);
      }
      if (hasMeasuredWidth) {
        coveredRawNames.add(vp.viewport.trim().toLowerCase());
      }
    }
    extractDomViolations(input.domReport, addFinding, input.subpixelTolerance);
  }

  const validScreenshots = screenshots.filter((s) => {
    if (typeof s.sizeBytes !== "number" || isNaN(s.sizeBytes) || s.sizeBytes < 1024) return false;
    const read = pngReads.get(s);
    return read !== undefined && read.status === "measured";
  });

  for (const sc of validScreenshots) {
    const rawLabel = sc.viewport === undefined ? sc.name : sc.viewport;
    coveredVps.add(normalizeViewportName(rawLabel, measuredWidthOf(pngReads, sc)));
    if (verifiedClaims.has(sc)) {
      coveredRawNames.add(rawLabel.trim().toLowerCase());
    }
  }

  for (const reqVp of requiredVps) {
    const normReq = normalizeViewportName(reqVp);
    const rawReq = reqVp.trim().toLowerCase();
    const isStandardBand = PROTECTED_VIEWPORT_BANDS.has(normReq);
    const customNameCovered = !isStandardBand && coveredRawNames.has(rawReq);
    const isMissing = !coveredVps.has(normReq) && !customNameCovered;
    if (isMissing) {
      addFinding(
        "missing_viewport",
        "error",
        `Missing Viewport Matrix Violation: Required viewport '${reqVp}' is missing across both DOM metrics and screenshots.`,
        "Execute visual test coverage across the full multi-viewport matrix: mobile (375x667), tablet (768x1024), desktop (1280x800).",
        undefined,
        reqVp,
      );
    }
  }

  let mode: DualChannelAuditResult["mode"];

  if (hasDomReport && validScreenshots.length > 0) {
    mode = "dual_channel_corroborated";
    const consistency = validateCrossChannelConsistency(input.domReport!, validScreenshots);
    if (!consistency.consistent) {
      for (const disc of consistency.discrepancies) {
        addFinding(
          "cross_channel_mismatch",
          "warning",
          `Cross-Channel Discrepancy: ${disc}`,
          "Harmonize viewport configurations and capture settings between DOM metrics and Playwright screenshots.",
        );
      }
    }

    for (const vp of input.domReport!.viewports) {
      const norm = normalizeViewportName(vp.viewport, vp.width);
      const sc = validScreenshots.find(
        (s) => normalizeViewportName(s.viewport ?? s.name, measuredWidthOf(pngReads, s)) === norm,
      );
      const hasViolations = findings.some(
        (f) => f.viewport === vp.viewport && f.severity === "error",
      );
      const inspected = domInvariantsInspected(vp, input.domReport!);
      const verifiedInvariants =
        sc === undefined ? inspected : [...inspected, SCREENSHOT_INVARIANT];
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }

      proofs.push({
        viewport: vp.viewport,
        ...(sc === undefined ? {} : { screenshotPath: sc.path, screenshotSizeBytes: sc.sizeBytes }),
        domMetricsPresent: true,
        verifiedInvariants,
        status: hasViolations
          ? "violation_detected"
          : sc === undefined
            ? "dom_only_gap_filled"
            : "corroborated",
      });
    }
  } else if (hasDomReport) {
    mode = "dom_gap_filled";
    for (const vp of input.domReport!.viewports) {
      const hasViolations = findings.some(
        (f) => f.viewport === vp.viewport && f.severity === "error",
      );
      const verifiedInvariants = domInvariantsInspected(vp, input.domReport!);
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }
      proofs.push({
        viewport: vp.viewport,
        domMetricsPresent: true,
        verifiedInvariants,
        status: hasViolations ? "violation_detected" : "dom_only_gap_filled",
      });
    }
  } else {
    mode = "screenshot_gap_filled";
    for (const sc of validScreenshots) {
      const vpName = sc.viewport ?? normalizeViewportName(sc.name, measuredWidthOf(pngReads, sc));
      const hasViolations = findings.some((f) => f.viewport === vpName && f.severity === "error");
      const verifiedInvariants = [SCREENSHOT_INVARIANT];
      if (manifestProofsValid) {
        verifiedInvariants.push(MANIFEST_INVARIANT);
      }
      proofs.push({
        viewport: vpName,
        screenshotPath: sc.path,
        domMetricsPresent: false,
        screenshotSizeBytes: sc.sizeBytes,
        verifiedInvariants,
        status: hasViolations ? "violation_detected" : "screenshot_only_gap_filled",
      });
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  const passed = !hasErrors;
  if (!passed) {
    mode = "rejected";
  }

  const summary = passed
    ? `Dual-channel visual validation passed in mode '${mode}'. ${proofs.length} viewport proofs generated.`
    : `Dual-channel visual validation failed with ${findings.length} findings (${findings.filter((f) => f.severity === "error").length} errors).`;

  return {
    isUiTask: true,
    passed,
    mode,
    findings,
    proofs,
    summary,
  };
}
